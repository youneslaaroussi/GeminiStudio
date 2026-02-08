/**
 * Verify that each component template compiles cleanly with the scene-compiler.
 * Run from app directory: pnpm run verify:templates
 * Requires scene-compiler to be built first: pnpm --filter @gemini-studio/scene-compiler build
 *
 * Ensures template string interpolation in component-templates.tsx doesn't
 * produce invalid TSX (e.g. broken backticks or ${}).
 */

import path from "path";
import { fileURLToPath } from "url";
import { COMPONENT_TEMPLATES } from "../app/lib/component-templates";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sceneDir = path.resolve(__dirname, "..", "..", "scene");
  const { compileScene } = await import("@gemini-studio/scene-compiler/compiler");
  const config = {
    port: 4001,
    logLevel: "warn",
    baseSceneDir: sceneDir,
    maxInputBytes: 204800,
    buildTimeoutMs: 60000,
    maxOutputBytes: 2097152,
  };

  let failed = 0;
  for (const template of COMPONENT_TEMPLATES) {
    const files: Record<string, string> = {
      [`src/components/custom/${template.componentName}.tsx`]: template.code,
    };
    try {
      const result = await compileScene(config, { files });
      if (!result.js || result.js.length === 0) {
        console.error(`❌ ${template.name} (${template.componentName}): compiled empty output`);
        failed++;
      } else {
        console.log(`✓ ${template.name} (${template.componentName})`);
      }
    } catch (err) {
      console.error(`❌ ${template.name} (${template.componentName}):`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
  console.log(`\nAll ${COMPONENT_TEMPLATES.length} templates compile successfully.`);
}

main();
