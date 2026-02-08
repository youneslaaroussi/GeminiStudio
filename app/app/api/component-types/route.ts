import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

const PACKAGES = ["@motion-canvas/2d", "@motion-canvas/core"] as const;

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

/**
 * GET /api/component-types
 * Returns all .d.ts contents for @motion-canvas/2d and @motion-canvas/core
 * so the Monaco editor can load real types (fixes "add" does not exist, constructor args, etc.).
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

  return NextResponse.json({ files });
}
