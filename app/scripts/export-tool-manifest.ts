import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportManifest() {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-key";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= "localhost";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "demo-project";
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= "demo-bucket";
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= "000000000000";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= "1:000000000000:web:demo";

  const { toolRegistry } = await import("../app/lib/tools/tool-registry");
  const tools = toolRegistry.list();
  const entries = tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    runLocation: tool.runLocation ?? "server",
    fields: tool.fields,
    inputSchema: zodToJsonSchema(tool.inputSchema, `${tool.name}Input`),
  }));

  const manifest = {
    generatedAt: new Date().toISOString(),
    tools: entries.reduce<Record<string, (typeof entries)[number]>>(
      (acc, tool) => {
        acc[tool.name] = tool;
        return acc;
      },
      {}
    ),
  };

  const outputDir = path.resolve(__dirname, "../../shared/tools");
  const outputPath = path.join(outputDir, "manifest.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`Exported ${entries.length} tools to ${outputPath}`);
}

exportManifest().catch((error) => {
  console.error("Failed to export tool manifest:", error);
  process.exitCode = 1;
});
