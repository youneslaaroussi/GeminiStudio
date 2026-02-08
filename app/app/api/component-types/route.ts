import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

const PACKAGES = ["@motion-canvas/2d", "@motion-canvas/core"] as const;
const PLUGIN_PACKAGES = ["d3-geo", "d3-shape", "d3-scale", "d3-hierarchy", "simplex-noise", "chroma-js"] as const;

/**
 * Recursively collect all .d.ts files under dir. relativeDir is the path from pkg root (e.g. "lib" or "lib/code").
 */
function collectDtsFiles(
  nodeModules: string,
  pkg: string,
  dir: string,
  relativeDir: string,
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
    const monacoPath = join("node_modules", pkg, relativePath);
    try {
      if (statSync(fullPath).isDirectory()) {
        collectDtsFiles(nodeModules, pkg, fullPath, relativePath, out);
      } else if (name.endsWith(".d.ts")) {
        const content = readFileSync(fullPath, "utf-8");
        out.push({ path: monacoPath.replace(/\\/g, "/"), content });
      }
    } catch {
      // skip unreadable
    }
  }
}

/**
 * Get all .d.ts under pkg/lib for Monaco.
 */
function getPackageTypes(
  nodeModules: string,
  pkg: string
): { path: string; content: string }[] {
  const libPath = join(nodeModules, pkg, "lib");
  if (!existsSync(libPath)) return [];
  const out: { path: string; content: string }[] = [];
  collectDtsFiles(nodeModules, pkg, libPath, "lib", out);
  return out;
}

/** Collect .d.ts from @types/pkg; paths as node_modules/pkg/... for resolution. */
function collectDtsFromAtTypes(
  nodeModules: string,
  pkg: string,
  dir: string,
  relativeDir: string,
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
        collectDtsFromAtTypes(nodeModules, pkg, fullPath, relativePath, out);
      } else if (name.endsWith(".d.ts")) {
        out.push({ path: monacoPath, content: readFileSync(fullPath, "utf-8") });
      }
    } catch {
      // skip
    }
  }
}

function getPluginTypes(
  nodeModules: string,
  pkg: string
): { path: string; content: string }[] {
  const typesPath = join(nodeModules, "@types", pkg);
  if (!existsSync(typesPath)) return [];
  const out: { path: string; content: string }[] = [];
  collectDtsFromAtTypes(nodeModules, pkg, typesPath, "", out);
  return out;
}

/**
 * GET /api/component-types
 * Returns .d.ts for @motion-canvas/2d, @motion-canvas/core, and component plugins (d3-*, chroma-js, simplex-noise)
 * so the Monaco editor can load real types.
 */
export async function GET() {
  const nodeModules = join(process.cwd(), "node_modules");
  const files: { path: string; content: string }[] = [];

  for (const pkg of PACKAGES) {
    const pkgPath = join(nodeModules, pkg);
    if (!existsSync(pkgPath)) continue;
    const collected = getPackageTypes(nodeModules, pkg);
    files.push(...collected);
  }

  for (const pkg of PLUGIN_PACKAGES) {
    files.push(...getPluginTypes(nodeModules, pkg));
  }

  return NextResponse.json({ files });
}
