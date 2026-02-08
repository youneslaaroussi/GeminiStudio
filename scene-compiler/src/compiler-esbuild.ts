/**
 * Fast scene compiler using esbuild instead of Vite/Rollup.
 *
 * Replaces the Vite-based compiler with esbuild for ~10-100x faster builds.
 * Key differences from the Vite compiler:
 *   - No temp directory or file copying (all overrides via in-memory plugin)
 *   - esbuild builds in ~50-200ms vs Vite's 3-10s
 *   - Server-side LRU cache for instant repeated compiles
 *   - Same public API (CompileRequest → CompileResult)
 *
 * The Motion Canvas Vite plugin behavior is replicated via a custom esbuild
 * plugin that handles: ?scene queries, .meta files, .glsl includes,
 * virtual:settings.meta, and the project bootstrap wrapper.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve, relative } from 'path';
import { spawnSync } from 'child_process';
import { logger } from './logger.js';
import type { CompilerConfig } from './config.js';
import type { CompileRequest, CompileResult, CompileDiagnostic } from './compiler.js';

// Re-use parseTscDiagnostics from compiler.ts — duplicated here to avoid circular deps.
function parseTscDiagnostics(stderr: string): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)?:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    diagnostics.push({
      file: m[1].trim(),
      line: parseInt(m[2], 10),
      column: parseInt(m[3], 10),
      message: m[6].trim(),
      code: m[5] ?? undefined,
      severity: m[4] === 'warning' ? 'warning' : 'error',
    });
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Server-side compile cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: CompileResult;
  cachedAt: number;
}

const compileCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 50;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function computeInputHash(
  baseSceneDir: string,
  files?: Record<string, string>,
): string {
  const h = createHash('sha256');
  // Include base scene project.ts mtime as a proxy for base changes
  try {
    const stat = statSync(join(baseSceneDir, 'src', 'project.ts'));
    h.update(String(stat.mtimeMs));
  } catch {
    h.update('no-project');
  }
  if (files && Object.keys(files).length > 0) {
    const sorted = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of sorted) {
      h.update(k);
      h.update(v);
    }
  } else {
    h.update('no-files');
  }
  return h.digest('hex');
}

function getCached(hash: string): CompileResult | null {
  const entry = compileCache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    compileCache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCache(hash: string, result: CompileResult): void {
  if (compileCache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest (first inserted)
    const oldest = compileCache.keys().next().value;
    if (oldest) compileCache.delete(oldest);
  }
  compileCache.set(hash, { result, cachedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Version detection (cached per process)
// ---------------------------------------------------------------------------

let cachedVersions: Record<string, string | null> | null = null;

function getVersions(nodeModulesDir: string): Record<string, string | null> {
  if (cachedVersions) return cachedVersions;

  const loadVersion = (pkg: string): string | null => {
    try {
      const pkgJson = JSON.parse(
        readFileSync(join(nodeModulesDir, pkg, 'package.json'), 'utf8'),
      );
      return pkgJson.version ?? null;
    } catch {
      return null;
    }
  };

  cachedVersions = {
    core: loadVersion('@motion-canvas/core'),
    two: loadVersion('@motion-canvas/2d'),
    ui: loadVersion('@motion-canvas/ui'),
    vitePlugin: loadVersion('@motion-canvas/vite-plugin'),
  };
  return cachedVersions;
}

// ---------------------------------------------------------------------------
// Find usable node_modules
// ---------------------------------------------------------------------------

function findNodeModules(baseSceneDir: string): string | null {
  const candidates = [
    join(baseSceneDir, 'node_modules'),
    join(baseSceneDir, '..', 'node_modules'),
    join(baseSceneDir, '..', '..', 'node_modules'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const probe = join(candidate, '@motion-canvas', 'core', 'package.json');
    if (existsSync(probe)) return resolve(candidate);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GLSL #include resolution
// ---------------------------------------------------------------------------

function resolveGlslIncludes(
  code: string,
  filePath: string,
  nodeModulesDir: string,
  visited: Set<string> = new Set(),
): string {
  if (visited.has(filePath)) return ''; // circular guard
  visited.add(filePath);

  const INCLUDE_REGEX = /^#include\s+"([^"]+)"/;
  const lines = code.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(INCLUDE_REGEX);
    if (match) {
      const includePath = match[1];
      let resolvedPath: string;

      if (includePath.startsWith('.')) {
        resolvedPath = resolve(dirname(filePath), includePath);
      } else {
        // Package include (e.g. "@motion-canvas/core/shaders/common.glsl")
        resolvedPath = resolve(nodeModulesDir, includePath);
      }

      if (existsSync(resolvedPath)) {
        const includeCode = readFileSync(resolvedPath, 'utf8');
        result.push(resolveGlslIncludes(includeCode, resolvedPath, nodeModulesDir, visited));
      } else {
        logger.warn({ includePath, resolvedPath }, 'GLSL #include not found, keeping directive');
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Component source normalisation (same transforms as compiler.ts)
// ---------------------------------------------------------------------------

const DECORATORS_FROM_2D = new Set(['signal', 'initial', 'colorSignal']);

function normalizeComponentSource(content: string): string {
  let out = content;

  // 1) Fix: import { signal } from "@motion-canvas/core/lib/signals"
  const coreSignalsImport =
    /import\s*\{([^}]*)\}\s*from\s*['"](@motion-canvas\/core\/lib\/signals)['"]\s*;?\s*\n?/g;
  out = out.replace(coreSignalsImport, (_, namesStr) => {
    const names = namesStr.split(',').map((n: string) => n.trim());
    const signalKey = (n: string) => n.split(/\s+as\s+/)[0]?.trim() ?? n;
    const signalNames = names.filter((n: string) => signalKey(n) === 'signal');
    const rest = names.filter((n: string) => signalKey(n) !== 'signal');
    const lines: string[] = [];
    if (signalNames.length > 0) {
      lines.push(`import { ${signalNames.join(', ')} } from '@motion-canvas/2d';`);
    }
    if (rest.length > 0) {
      lines.push(`import { ${rest.join(', ')} } from '@motion-canvas/core';`);
    }
    return lines.length ? lines.join('\n') + '\n' : '';
  });

  // 2) Fix: import { makeComponent, random, signal, ... } from "@motion-canvas/core"
  const coreMainImport = /import\s*\{([^}]*)\}\s*from\s*['"]@motion-canvas\/core['"]\s*;?\s*\n?/g;
  out = out.replace(coreMainImport, (_, namesStr) => {
    const names = namesStr.split(',').map((n: string) => n.trim());
    const nameKey = (n: string) => n.split(/\s+as\s+/)[0]?.trim() ?? n;
    let outNames = names.filter((n: string) => nameKey(n) !== 'makeComponent');
    const decoratorsFrom2d = outNames.filter((n: string) => DECORATORS_FROM_2D.has(nameKey(n)));
    outNames = outNames.filter((n: string) => !DECORATORS_FROM_2D.has(nameKey(n)));
    const hadRandom = outNames.some((n: string) => nameKey(n) === 'random');
    const hasUseRandom = outNames.some((n: string) => nameKey(n) === 'useRandom');
    if (hadRandom && !hasUseRandom) {
      outNames = outNames.filter((n: string) => nameKey(n) !== 'random');
      outNames.push('useRandom');
    }
    const twoDLine =
      decoratorsFrom2d.length > 0
        ? `import { ${decoratorsFrom2d.join(', ')} } from '@motion-canvas/2d';\n`
        : '';
    const coreLine =
      outNames.length > 0
        ? `import { ${outNames.join(', ')} } from '@motion-canvas/core';\n`
        : '';
    const makeComponentLine = names.some((n: string) => nameKey(n) === 'makeComponent')
      ? "import { makeComponent } from '../../lib/makeComponent';\n"
      : '';
    return twoDLine + coreLine + makeComponentLine;
  });

  // 3) Fix: random. → this._random. with class field injection
  if (/\brandom\./.test(out)) {
    if (!out.includes('_random = useRandom()')) {
      const classBraceMatch = out.match(
        /(export\s+class\s+\w+\s+extends\s+(?:Layout|Node|Rect|Circle|Txt|Line|Path|Spline|[\w.]+)\s*\{)/,
      );
      if (classBraceMatch) {
        out = out.replace(
          classBraceMatch[0],
          classBraceMatch[0] + '\n  private readonly _random = useRandom();',
        );
      }
    }
    out = out.replace(/\brandom\./g, 'this._random.');
  }

  return out;
}

// ---------------------------------------------------------------------------
// Barrel file generation
// ---------------------------------------------------------------------------

const ALLOWED_FILE_PATH_REGEX = /^src\/components\/custom\/[a-zA-Z0-9_-]+\.tsx$/;

function generateBarrelContent(
  baseSceneDir: string,
  fileOverrides?: Record<string, string>,
): string {
  const customDir = join(baseSceneDir, 'src', 'components', 'custom');

  // Collect component names from disk + overrides
  const componentNames = new Set<string>();

  // From disk
  if (existsSync(customDir)) {
    for (const f of readdirSync(customDir)) {
      if (f.endsWith('.tsx') && f !== 'index.tsx' && f !== 'index.ts') {
        componentNames.add(basename(f, '.tsx'));
      }
    }
  }

  // From overrides
  if (fileOverrides) {
    for (const relPath of Object.keys(fileOverrides)) {
      if (ALLOWED_FILE_PATH_REGEX.test(relPath)) {
        componentNames.add(basename(relPath, '.tsx'));
      }
    }
  }

  if (componentNames.size === 0) {
    return "import { registerComponent } from '../../lib/clips';\n";
  }

  const lines: string[] = [
    "import { registerComponent } from '../../lib/clips';",
    '',
  ];

  const sorted = [...componentNames].sort();

  for (const name of sorted) {
    lines.push(`import * as ${name}Module from './${name}';`);
    lines.push(
      `const ${name} = (${name}Module as { default?: unknown; [k: string]: unknown }).default ?? ${name}Module.${name};`,
    );
    lines.push('');
  }

  for (const name of sorted) {
    lines.push(
      `registerComponent('${name}', ${name} as unknown as new (props?: Record<string, unknown>) => import('@motion-canvas/2d').Node);`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Post-build patches
// ---------------------------------------------------------------------------

function applyPostBuildPatches(js: string): string {
  let patched = js;

  // Add crossOrigin="anonymous" on Video elements for CORS
  const videoCreatePattern =
    /(video = document\.createElement\("video"\);)\s*(video\.src = src;)/;
  if (videoCreatePattern.test(patched)) {
    patched = patched.replace(
      videoCreatePattern,
      '$1\n      video.crossOrigin = "anonymous";\n      $2',
    );
  }

  return patched;
}

// ---------------------------------------------------------------------------
// esbuild Motion Canvas plugin
// ---------------------------------------------------------------------------

/**
 * Regex to find `?scene` imports in source code. We rewrite them at load time
 * because esbuild's default file resolver can silently strip URL query params,
 * preventing `onResolve` from ever seeing the `?scene` suffix.
 */
const SCENE_IMPORT_RE =
  /from\s+['"]([^'"]+)\?scene['"]/g;

/**
 * Rewrite `import x from './foo?scene'` → `import x from './foo__mc_scene__'`.
 * This custom suffix is then picked up by a reliable `onResolve` handler.
 */
function rewriteSceneImports(code: string): string {
  return code.replace(SCENE_IMPORT_RE, (_match, path) => `from '${path}__mc_scene__'`);
}

function createMotionCanvasPlugin(opts: {
  baseSceneDir: string;
  nodeModulesDir: string;
  fileOverrides: Map<string, string>;
  barrelContent: string;
}): esbuild.Plugin {
  const { baseSceneDir, nodeModulesDir, fileOverrides, barrelContent } = opts;
  const customDir = resolve(baseSceneDir, 'src', 'components', 'custom');
  const barrelPath = join(customDir, 'index.ts');

  // Build a set of override absolute paths for quick lookup
  const overrideAbsPaths = new Map<string, string>();
  for (const [relPath, content] of fileOverrides) {
    overrideAbsPaths.set(resolve(baseSceneDir, relPath), content);
  }

  return {
    name: 'motion-canvas',
    setup(build) {
      // ---- Resolve __mc_scene__ imports (scene wrapper) ----
      // The entry code rewrites `?scene` → `__mc_scene__` because esbuild
      // strips URL query suffixes before plugin callbacks can see them.
      build.onResolve({ filter: /__mc_scene__$/ }, (args) => {
        const cleanPath = args.path.replace('__mc_scene__', '');
        const base = resolve(args.resolveDir, cleanPath);
        for (const ext of ['', '.tsx', '.ts', '.jsx', '.js']) {
          const candidate = base + ext;
          if (existsSync(candidate)) {
            return { path: candidate, namespace: 'mc-scene' };
          }
        }
        return { path: base, namespace: 'mc-scene' };
      });

      build.onLoad({ filter: /.*/, namespace: 'mc-scene' }, (args) => {
        const dir = dirname(args.path);
        const name = basename(args.path).replace(/\.(tsx?|jsx?)$/, '');
        const metaFile = `${name}.meta`;

        return {
          contents: `\
import {ValueDispatcher} from '@motion-canvas/core';
import metaFile from './${metaFile}';
import description from './${name}';
description.name = '${name}';
metaFile.attach(description.meta);
description.onReplaced ??= new ValueDispatcher(description.config);
export default description;
`,
          resolveDir: dir,
          loader: 'ts',
        };
      });

      // ---- virtual:settings.meta ----
      build.onResolve({ filter: /^virtual:settings\.meta$/ }, () => ({
        path: 'settings',
        namespace: 'mc-settings',
      }));

      build.onLoad({ filter: /.*/, namespace: 'mc-settings' }, () => ({
        contents: `\
import {MetaFile} from '@motion-canvas/core';
const meta = new MetaFile('settings', false);
meta.loadData({});
export default meta;
`,
        resolveDir: nodeModulesDir, // needed so esbuild can resolve @motion-canvas/core
        loader: 'ts',
      }));

      // ---- .meta files ----
      build.onLoad({ filter: /\.meta$/ }, (args) => {
        let content: string;
        try {
          content = readFileSync(args.path, 'utf8');
        } catch {
          content = '{"version":0}';
        }
        const fileName = basename(args.path, '.meta');
        return {
          contents: `\
import {MetaFile} from '@motion-canvas/core';
const meta = new MetaFile('${fileName}', false);
meta.loadData(${content});
export default meta;
`,
          loader: 'ts',
        };
      });

      // ---- .glsl files ----
      build.onLoad({ filter: /\.glsl$/ }, (args) => {
        const code = readFileSync(args.path, 'utf8');
        const resolved = resolveGlslIncludes(code, args.path, nodeModulesDir);
        // Escape backticks and backslashes for template literal
        const escaped = resolved.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        return {
          contents: `export default \`${escaped}\`;`,
          loader: 'js',
        };
      });

      // ---- File overrides (custom components) ----
      // Intercept resolution from within the custom components directory
      // to handle components that exist only as overrides (not on disk).
      build.onResolve({ filter: /^\./ }, (args) => {
        // Only handle relative imports from within the custom dir
        if (!args.resolveDir.startsWith(customDir)) return undefined;

        for (const ext of ['.tsx', '.ts']) {
          const candidate = resolve(args.resolveDir, args.path + ext);
          // If the file exists in overrides but not on disk, return it
          if (overrideAbsPaths.has(candidate) && !existsSync(candidate)) {
            return { path: candidate, namespace: 'file' };
          }
        }
        return undefined;
      });

      // Intercept loads of files in the custom components directory
      build.onLoad({ filter: /[\\/]src[\\/]components[\\/]custom[\\/]/ }, (args) => {
        // Barrel file
        if (args.path === barrelPath || args.path === barrelPath.replace('.ts', '.tsx')) {
          return {
            contents: barrelContent,
            loader: 'ts',
            resolveDir: customDir,
          };
        }

        // Override file
        const overrideContent = overrideAbsPaths.get(args.path);
        if (overrideContent !== undefined) {
          return {
            contents: overrideContent,
            loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
            resolveDir: customDir,
          };
        }

        // Fall through to default disk read
        return undefined;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Main compile function
// ---------------------------------------------------------------------------

export async function compileSceneEsbuild(
  config: CompilerConfig,
  request: CompileRequest,
): Promise<CompileResult> {
  const startTime = Date.now();

  // --- Check cache ---
  const cacheHash = computeInputHash(config.baseSceneDir, request.files);
  const cached = getCached(cacheHash);
  if (cached) {
    // When diagnostics were requested and the cached result has them, or
    // when diagnostics were NOT requested, we can return the cached result.
    const wantDiagnostics = request.includeDiagnostics !== false;
    if (!wantDiagnostics || cached.diagnostics !== undefined) {
      logger.info({ elapsed: Date.now() - startTime, cached: true }, 'Scene compilation complete (cache hit)');
      return cached;
    }
  }

  // --- Find node_modules ---
  const nodeModulesDir = findNodeModules(config.baseSceneDir);
  if (!nodeModulesDir) {
    throw new Error('No usable node_modules found for scene compilation');
  }

  // --- Normalize file overrides ---
  const fileOverrides = new Map<string, string>();
  if (request.files) {
    for (const [relativePath, content] of Object.entries(request.files)) {
      const normalizedPath = relativePath.replace(/\.\./g, '').replace(/^\//, '');
      if (!ALLOWED_FILE_PATH_REGEX.test(normalizedPath)) {
        throw new Error(
          `File path not allowed: "${relativePath}". Only src/components/custom/<name>.tsx is permitted.`,
        );
      }
      fileOverrides.set(normalizedPath, normalizeComponentSource(content));
    }
  }

  logger.info(
    { fileOverrides: [...fileOverrides.keys()] },
    'Starting esbuild scene compilation',
  );

  // --- Generate barrel file ---
  const barrelContent = generateBarrelContent(config.baseSceneDir, request.files);

  // --- Generate entry code ---
  // We build the entry by reading project.ts and rewriting `?scene` imports
  // inline, because esbuild strips URL query suffixes (`?scene`) from import
  // paths before plugin onResolve/onLoad callbacks can see them.
  const versions = getVersions(nodeModulesDir);
  const versionsJson = JSON.stringify(versions);
  const srcDir = join(config.baseSceneDir, 'src');

  const projectTsPath = join(srcDir, 'project.ts');
  let projectTsCode = readFileSync(projectTsPath, 'utf8');

  // Rewrite `?scene` imports → `__mc_scene__` suffix so the esbuild plugin
  // onResolve handler can intercept them. esbuild strips URL query suffixes
  // before plugin callbacks see them, so we need this transformation.
  SCENE_IMPORT_RE.lastIndex = 0;
  projectTsCode = rewriteSceneImports(projectTsCode);

  // Replace `export default makeProject(...)` → `const __mc_config = makeProject(...)`
  // so we can wrap it with the bootstrap() call.
  projectTsCode = projectTsCode.replace(
    /export\s+default\s+/,
    'const __mc_config = ',
  );

  const projectMetaContent = readFileSync(join(srcDir, 'project.meta'), 'utf8');

  const entryCode = `\
import {bootstrap} from '@motion-canvas/core';
import {MetaFile} from '@motion-canvas/core';
import settings from 'virtual:settings.meta';

// --- Inlined project.ts (with ?scene rewritten) ---
${projectTsCode}
// --- End inlined project.ts ---

// Project meta
const __metaFile = new MetaFile('project', false);
__metaFile.loadData(${projectMetaContent});

// Bootstrap
const project = bootstrap(
  'project',
  ${versionsJson},
  [],
  __mc_config,
  __metaFile,
  settings,
);

if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
  globalThis.__SCENE_PROJECT__ = project;
}

export { project as default };
`;

  // --- Run esbuild ---
  const plugin = createMotionCanvasPlugin({
    baseSceneDir: config.baseSceneDir,
    nodeModulesDir,
    fileOverrides,
    barrelContent,
  });

  const buildResult = await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir: srcDir,
      loader: 'ts',
      sourcefile: 'project.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    treeShaking: true,
    write: false,
    outfile: 'project.js',
    jsx: 'automatic',
    jsxImportSource: '@motion-canvas/2d/lib',
    tsconfig: join(config.baseSceneDir, 'tsconfig.json'),
    plugins: [plugin],
    nodePaths: [nodeModulesDir],
    logLevel: 'warning',
  });

  if (buildResult.errors.length > 0) {
    const errorMessages = buildResult.errors
      .map((e) => e.text)
      .join('\n');
    throw new Error(`esbuild compilation failed:\n${errorMessages}`);
  }

  const outputFile = buildResult.outputFiles?.[0];
  if (!outputFile) {
    throw new Error('esbuild produced no output');
  }

  let js = outputFile.text;

  // Check output size
  if (Buffer.byteLength(js) > config.maxOutputBytes) {
    throw new Error(`Compiled output exceeds maximum size (${config.maxOutputBytes} bytes)`);
  }

  // Apply post-build patches (crossOrigin fix)
  js = applyPostBuildPatches(js);

  // --- Diagnostics (optional, runs tsc separately) ---
  let diagnostics: CompileDiagnostic[] | undefined;
  const includeDiagnostics = request.includeDiagnostics !== false;
  if (includeDiagnostics) {
    diagnostics = runTscDiagnostics(config, fileOverrides, barrelContent);
  }

  const result: CompileResult = diagnostics ? { js, diagnostics } : { js };

  // --- Cache result ---
  setCache(cacheHash, result);

  const elapsed = Date.now() - startTime;
  logger.info(
    { elapsed, outputSize: Buffer.byteLength(js), cached: false },
    'Scene compilation complete (esbuild)',
  );

  return result;
}

// ---------------------------------------------------------------------------
// tsc diagnostics (optional — runs only when requested)
// ---------------------------------------------------------------------------

function runTscDiagnostics(
  config: CompilerConfig,
  fileOverrides: Map<string, string>,
  barrelContent: string,
): CompileDiagnostic[] {
  // tsc requires files on disk. Create a minimal temp directory with only the
  // override files and a symlink to everything else from the base scene.
  const tmpDir = mkdtempSync(join(tmpdir(), 'scene-diag-'));

  try {
    // Symlink the base scene's src, tsconfig, and node_modules
    const baseSceneDir = config.baseSceneDir;

    // Copy src directory structure — symlink everything except custom dir
    const srcDir = join(baseSceneDir, 'src');
    const tmpSrcDir = join(tmpDir, 'src');
    mkdirSync(tmpSrcDir, { recursive: true });

    // Symlink everything in src/ except components/custom
    for (const entry of readdirSync(srcDir)) {
      if (entry === 'components') continue;
      const src = join(srcDir, entry);
      const dst = join(tmpSrcDir, entry);
      try {
        symlinkSync(src, dst);
      } catch {
        // fallback: ignore
      }
    }

    // Symlink components dir except custom
    const compDir = join(srcDir, 'components');
    const tmpCompDir = join(tmpSrcDir, 'components');
    mkdirSync(tmpCompDir, { recursive: true });

    if (existsSync(compDir)) {
      for (const entry of readdirSync(compDir)) {
        if (entry === 'custom') continue;
        try {
          symlinkSync(join(compDir, entry), join(tmpCompDir, entry));
        } catch {
          // ignore
        }
      }
    }

    // Create custom dir with overrides
    const tmpCustomDir = join(tmpCompDir, 'custom');
    mkdirSync(tmpCustomDir, { recursive: true });

    // Copy existing custom files from base
    const baseCustomDir = join(compDir, 'custom');
    if (existsSync(baseCustomDir)) {
      for (const f of readdirSync(baseCustomDir)) {
        if (f === 'index.ts' || f === 'index.tsx') continue;
        try {
          symlinkSync(join(baseCustomDir, f), join(tmpCustomDir, f));
        } catch {
          // ignore
        }
      }
    }

    // Write override files
    for (const [relPath, content] of fileOverrides) {
      const absPath = join(tmpDir, relPath);
      const parentDir = dirname(absPath);
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
      writeFileSync(absPath, content, 'utf8');
    }

    // Write barrel
    writeFileSync(join(tmpCustomDir, 'index.ts'), barrelContent, 'utf8');

    // Symlink tsconfig.json and package.json
    const tsconfig = join(baseSceneDir, 'tsconfig.json');
    if (existsSync(tsconfig)) {
      try {
        symlinkSync(tsconfig, join(tmpDir, 'tsconfig.json'));
      } catch {
        // ignore
      }
    }

    // Symlink node_modules
    const candidates = [
      join(baseSceneDir, 'node_modules'),
      join(baseSceneDir, '..', 'node_modules'),
      join(baseSceneDir, '..', '..', 'node_modules'),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const probe = join(candidate, '@motion-canvas', 'core', 'package.json');
      if (existsSync(probe)) {
        try {
          symlinkSync(candidate, join(tmpDir, 'node_modules'), 'junction');
        } catch {
          // ignore
        }
        break;
      }
    }

    // Run tsc
    const tscResult = spawnSync('npx', ['tsc', '--noEmit'], {
      cwd: tmpDir,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000, // 15s max for diagnostics
    });

    const tscOutput = (tscResult.stderr ?? '') + (tscResult.stdout ?? '');
    if (tscOutput) {
      const diags = parseTscDiagnostics(tscOutput);
      if (diags.length > 0) {
        logger.info(
          { count: diags.length, files: [...new Set(diags.map((d) => d.file))] },
          'Type-check reported diagnostics',
        );
      }
      return diags;
    }
    return [];
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
