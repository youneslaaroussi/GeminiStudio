/**
 * Reads @motion-canvas/2d, @motion-canvas/core, and component plugin packages (.d.ts)
 * and writes app/app/lib/monaco-types-data.ts so Monaco can load them synchronously
 * (avoids "Cannot find module '@motion-canvas/core'" and gives IntelliSense for d3-*, chroma-js, simplex-noise).
 *
 * Run from repo root: pnpm exec tsx app/scripts/generate-motion-canvas-types.ts
 * Or from app: pnpm exec tsx scripts/generate-motion-canvas-types.ts
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const PACKAGES = ["@motion-canvas/2d", "@motion-canvas/core"] as const;

/** Component plugin packages (d3-*, chroma-js, simplex-noise). Types come from @types/pkg or package's own types. */
const PLUGIN_PACKAGES = ["d3-geo", "d3-shape", "d3-scale", "d3-hierarchy", "simplex-noise", "chroma-js"] as const;

function collectDtsFiles(
  dir: string,
  relativeDir: string,
  pkg: string,
  out: { path: string; content: string }[]
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const fullPath = join(dir, name);
    const relativePath = relativeDir ? join(relativeDir, name) : name;
    const monacoPath = join("node_modules", pkg, relativePath).replace(/\\/g, "/");
    try {
      if (statSync(fullPath).isDirectory()) {
        collectDtsFiles(fullPath, relativePath, pkg, out);
      } else if (name.endsWith(".d.ts")) {
        const content = readFileSync(fullPath, "utf-8");
        out.push({ path: monacoPath, content });
      }
    } catch {
      // skip
    }
  }
}

function getPackageTypes(nodeModules: string, pkg: string): { path: string; content: string }[] {
  const libPath = join(nodeModules, pkg, "lib");
  if (!existsSync(libPath)) return [];
  const out: { path: string; content: string }[] = [];
  collectDtsFiles(libPath, "lib", pkg, out);
  return out;
}

/** Collect from @types/pkg and expose as node_modules/pkg/... so import 'pkg' resolves. */
function getPluginTypesFromAtTypes(
  nodeModules: string,
  pkg: string
): { path: string; content: string }[] {
  const typesPath = join(nodeModules, "@types", pkg);
  if (!existsSync(typesPath)) return [];
  const out: { path: string; content: string }[] = [];
  collectDtsFiles(typesPath, "", pkg, out);
  return out;
}

/** Collect from package's own "types" entry (e.g. simplex-noise). */
function getPluginTypesFromPackage(
  nodeModules: string,
  pkg: string
): { path: string; content: string }[] {
  const pkgPath = join(nodeModules, pkg);
  const packageJsonPath = join(pkgPath, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  const pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const typesEntry = pkgJson.types ?? pkgJson.typings;
  if (!typesEntry || typeof typesEntry !== "string") return [];
  const typesFullPath = join(pkgPath, typesEntry);
  if (!existsSync(typesFullPath)) return [];
  const out: { path: string; content: string }[] = [];
  const typesDir = statSync(typesFullPath).isDirectory() ? typesFullPath : dirname(typesFullPath);
  const relativeDir = typesDir.slice(pkgPath.length + 1);
  collectDtsFiles(typesDir, relativeDir, pkg, out);
  if (out.length === 0 && typesEntry.endsWith(".d.ts")) {
    out.push({
      path: join("node_modules", pkg, typesEntry).replace(/\\/g, "/"),
      content: readFileSync(typesFullPath, "utf-8"),
    });
  }
  return out;
}

const cwd = process.cwd();
// When run from repo root: cwd/app/node_modules has @motion-canvas. When run from app: cwd/node_modules has it.
const nodeModulesAtApp = join(cwd, "app", "node_modules");
const nodeModulesHere = join(cwd, "node_modules");
const nodeModules = existsSync(join(nodeModulesAtApp, "@motion-canvas", "2d"))
  ? nodeModulesAtApp
  : nodeModulesHere;
const outPath = nodeModules === nodeModulesAtApp
  ? join(cwd, "app", "app", "lib", "monaco-types-data.ts")
  : join(cwd, "app", "lib", "monaco-types-data.ts");

const files: { path: string; content: string }[] = [];

// Monaco's Node resolver looks for package.json to get "types" entry; add them first.
for (const pkg of PACKAGES) {
  const pkgPath = join(nodeModules, pkg);
  if (!existsSync(pkgPath)) {
    console.warn(`Skip ${pkg}: not found at ${pkgPath}`);
    continue;
  }
  const packageJsonPath = join(pkgPath, "package.json");
  if (existsSync(packageJsonPath)) {
    const pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const types = pkgJson.types ?? pkgJson.typings ?? "./lib/index.d.ts";
    const virtualPath = join("node_modules", pkg, "package.json").replace(/\\/g, "/");
    files.push({
      path: virtualPath,
      content: JSON.stringify({ name: pkg, types }),
    });
  }
  files.push(...getPackageTypes(nodeModules, pkg));
}

// Component plugin packages: use @types/pkg (exposed as node_modules/pkg/...) or package's own types
for (const pkg of PLUGIN_PACKAGES) {
  const fromAtTypes = getPluginTypesFromAtTypes(nodeModules, pkg);
  if (fromAtTypes.length > 0) {
    const virtualPkgJson = join("node_modules", pkg, "package.json").replace(/\\/g, "/");
    files.push({
      path: virtualPkgJson,
      content: JSON.stringify({ name: pkg, types: "./index.d.ts" }),
    });
    files.push(...fromAtTypes);
    continue;
  }
  const fromPkg = getPluginTypesFromPackage(nodeModules, pkg);
  if (fromPkg.length > 0) {
    const pkgPath = join(nodeModules, pkg);
    const packageJsonPath = join(pkgPath, "package.json");
    if (existsSync(packageJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      const types = pkgJson.types ?? pkgJson.typings ?? "./index.d.ts";
      const virtualPkgJson = join("node_modules", pkg, "package.json").replace(/\\/g, "/");
      files.push({
        path: virtualPkgJson,
        content: JSON.stringify({ name: pkg, types }),
      });
    }
    files.push(...fromPkg);
  }
}

console.log(`Collected ${files.length} .d.ts files`);

const lines = files.map(
  (f) => `  { path: ${JSON.stringify(f.path)}, content: ${JSON.stringify(f.content)} }`
);
const ts = `/** Generated by scripts/generate-motion-canvas-types.ts - do not edit manually */\n\nexport const MOTION_CANVAS_TYPES: { path: string; content: string }[] = [\n${lines.join(",\n")}\n];\n`;

mkdirSync(join(outPath, ".."), { recursive: true });
writeFileSync(outPath, ts, "utf-8");
console.log(`Wrote ${outPath}`);
process.exit(0);
