/**
 * Scene compiler: builds Motion Canvas projects using the Vite programmatic API.
 *
 * Each compile request:
 *   1. Copies the base scene source to a temporary directory
 *   2. Applies any file overrides (e.g. custom component code)
 *   3. Runs a Vite build with the Motion Canvas plugin
 *   4. Applies post-build patches (globalThis export, CORS fix)
 *   5. Returns the compiled project.js content
 *   6. Cleans up the temporary directory
 */

import { build, type InlineConfig, type PluginOption } from 'vite';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import { logger } from './logger.js';
import type { CompilerConfig } from './config.js';

/**
 * Dynamically import the Motion Canvas Vite plugin.
 * Handles both default and named export styles.
 */
async function loadMotionCanvasPlugin(): Promise<(opts?: Record<string, unknown>) => PluginOption[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mcp: any = await import('@motion-canvas/vite-plugin');
  if (typeof mcp === 'function') return mcp;
  if (typeof mcp.default === 'function') return mcp.default;
  if (typeof mcp.default?.default === 'function') return mcp.default.default;
  throw new Error('Could not resolve Motion Canvas Vite plugin export');
}

/** Patches applied after Vite build (same as scene/scripts/postbuild.js). */
function applyPostBuildPatches(js: string): string {
  let patched = js;

  // 1. Inject globalThis.__SCENE_PROJECT__ assignment before the export
  const GLOBAL_PATCH =
    "if (typeof globalThis !== 'undefined' && 'window' in globalThis) { globalThis.__SCENE_PROJECT__ = project; }\n";
  const exportRegex = /export \{\s*project as default\s*\};?/;
  if (exportRegex.test(patched)) {
    patched = patched.replace(exportRegex, (m) => GLOBAL_PATCH + m);
  } else {
    logger.warn('Post-build: could not find "export { project as default }" in compiled output');
  }

  // 2. Add crossOrigin="anonymous" on Video elements for CORS
  const videoCreatePattern = /(video = document\.createElement\("video"\);)\s*(video\.src = src;)/;
  if (videoCreatePattern.test(patched)) {
    patched = patched.replace(videoCreatePattern, '$1\n      video.crossOrigin = "anonymous";\n      $2');
  }

  return patched;
}

export interface CompileRequest {
  /** File overrides: path relative to scene root (e.g. "src/components/Foo.tsx") mapped to file content. */
  files?: Record<string, string>;
}

export interface CompileResult {
  /** The compiled project.js content. */
  js: string;
}

/**
 * Compile a Motion Canvas scene project.
 *
 * @param config - Compiler configuration
 * @param request - Compile request with optional file overrides
 * @returns The compiled project.js
 */
export async function compileScene(
  config: CompilerConfig,
  request: CompileRequest,
): Promise<CompileResult> {
  const startTime = Date.now();
  const tmpDir = mkdtempSync(join(tmpdir(), 'scene-compile-'));

  logger.info({ tmpDir, fileOverrides: Object.keys(request.files ?? {}) }, 'Starting scene compilation');

  try {
    // 1. Copy the base scene to the temp directory
    const baseSceneSrc = join(config.baseSceneDir, 'src');
    const baseSceneRoot = config.baseSceneDir;

    if (!existsSync(baseSceneSrc)) {
      throw new Error(`Base scene source not found at ${baseSceneSrc}`);
    }

    // Copy the entire scene directory structure (src/, package.json, tsconfig, etc.)
    cpSync(baseSceneRoot, tmpDir, { recursive: true, force: true });

    // Remove dist/ from copy if present (stale build artifacts)
    const tmpDistDir = join(tmpDir, 'dist');
    if (existsSync(tmpDistDir)) {
      rmSync(tmpDistDir, { recursive: true, force: true });
    }

    // Remove node_modules from copy if present, then symlink from the original location
    // so Vite can resolve @motion-canvas/* and other dependencies.
    const tmpNodeModules = join(tmpDir, 'node_modules');
    if (existsSync(tmpNodeModules)) {
      rmSync(tmpNodeModules, { recursive: true, force: true });
    }

    // Symlink node_modules from a working location.
    //
    // IMPORTANT: In Docker/pnpm deployments the base-scene's own node_modules
    // may contain broken relative symlinks (pnpm symlinks that pointed at the
    // workspace root .pnpm store, which moved when the scene was copied to
    // base-scene/). We verify the candidate actually contains a resolvable
    // @motion-canvas/core before using it; otherwise fall through.
    const candidates = [
      join(baseSceneRoot, 'node_modules'),           // scene-level
      join(baseSceneRoot, '..', 'node_modules'),     // scene-compiler-level / parent
      join(baseSceneRoot, '..', '..', 'node_modules'), // monorepo root
    ];

    let symlinkTarget: string | null = null;
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      // Verify the candidate has a usable @motion-canvas/core (not a broken symlink)
      const probe = join(candidate, '@motion-canvas', 'core', 'package.json');
      if (existsSync(probe)) {
        symlinkTarget = candidate;
        break;
      }
      logger.debug({ candidate, probe }, 'Skipping node_modules candidate (probe not found)');
    }

    if (symlinkTarget) {
      symlinkSync(symlinkTarget, tmpNodeModules, 'junction');
      logger.debug({ symlinkTarget }, 'Symlinked node_modules');
    } else {
      logger.warn({ candidates }, 'No usable node_modules found for scene compilation');
    }

    // 2. Apply file overrides
    if (request.files) {
      for (const [relativePath, content] of Object.entries(request.files)) {
        // Security: prevent path traversal
        const normalizedPath = relativePath.replace(/\.\./g, '').replace(/^\//, '');
        const targetPath = join(tmpDir, normalizedPath);

        // Ensure target is within tmpDir
        if (!targetPath.startsWith(tmpDir)) {
          logger.warn({ relativePath }, 'Skipping file override with suspicious path');
          continue;
        }

        // Create parent directories if needed
        const parentDir = dirname(targetPath);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }

        writeFileSync(targetPath, content, 'utf8');
        logger.debug({ relativePath }, 'Applied file override');
      }
    }

    // 3. Generate custom component barrel file
    // Scan src/components/custom/ for .tsx files and generate an index.ts
    // that imports each component and registers it with the component registry.
    const customDir = join(tmpDir, 'src', 'components', 'custom');
    if (existsSync(customDir)) {
      const componentFiles = readdirSync(customDir).filter(
        (f) => f.endsWith('.tsx') && f !== 'index.tsx' && f !== 'index.ts'
      );

      if (componentFiles.length > 0) {
        const imports: string[] = [];
        const registrations: string[] = [];

        for (const file of componentFiles) {
          const name = basename(file, '.tsx');
          imports.push(`import { ${name} } from './${name}';`);
          registrations.push(
            `registerComponent('${name}', ${name} as unknown as new (props?: Record<string, unknown>) => import('@motion-canvas/2d').Node);`
          );
        }

        const barrelContent = [
          "import { registerComponent } from '../../lib/clips';",
          '',
          ...imports,
          '',
          ...registrations,
          '',
        ].join('\n');

        writeFileSync(join(customDir, 'index.ts'), barrelContent, 'utf8');
        logger.info({ components: componentFiles.map((f) => basename(f, '.tsx')) }, 'Generated custom component barrel');
      }
    }

    // 4. Run Vite build
    // Pass an absolute project path to the MC plugin so Rollup can resolve
    // the ?project entry without needing process.chdir() (which causes tsx
    // watch to restart the service when Vite creates temp files).
    const motionCanvas = await loadMotionCanvasPlugin();
    const absoluteProjectPath = join(tmpDir, 'src', 'project.ts');

    const viteConfig: InlineConfig = {
      root: tmpDir,
      configFile: false, // don't load the scene's vite.config.ts
      logLevel: 'warn',
      plugins: motionCanvas({
        project: absoluteProjectPath,
        buildForEditor: false,
      } as Record<string, unknown>),
      build: {
        minify: false,
        rollupOptions: {
          output: {
            entryFileNames: 'project.js',
          },
        },
      },
    };

    await build(viteConfig);

    // 5. Read and patch the compiled output
    const outputPath = join(tmpDir, 'dist', 'project.js');
    if (!existsSync(outputPath)) {
      throw new Error('Compilation produced no output (dist/project.js not found)');
    }

    let js = readFileSync(outputPath, 'utf8');

    // Check output size
    if (Buffer.byteLength(js) > config.maxOutputBytes) {
      throw new Error(`Compiled output exceeds maximum size (${config.maxOutputBytes} bytes)`);
    }

    // Apply post-build patches
    js = applyPostBuildPatches(js);

    const elapsed = Date.now() - startTime;
    logger.info({ elapsed, outputSize: Buffer.byteLength(js) }, 'Scene compilation complete');

    return { js };
  } finally {
    // 6. Cleanup temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, tmpDir }, 'Failed to clean up temp directory');
    }
  }
}
