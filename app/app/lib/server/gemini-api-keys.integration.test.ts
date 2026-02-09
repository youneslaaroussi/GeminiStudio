/**
 * Real-API integration test for Gemini key rotation and model helpers.
 * Loads .env from project root. Skips when no API key is set.
 * Run from app/: pnpm exec vitest run app/app/lib/server/gemini-api-keys.integration.test.ts
 */

import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), ".env") });

import { describe, it, expect } from "vitest";
import {
  getCurrentGeminiKey,
  fetchWithGeminiKeyRotation,
  getGeminiApiKeys,
} from "./gemini-api-keys";
import { getChatModelIds } from "../model-ids";

describe("Gemini API keys and model IDs (integration, real API)", () => {
  const hasKey = () => !!getCurrentGeminiKey();

  it("returns at least one key when env is set", () => {
    if (!hasKey()) return;
    const keys = getGeminiApiKeys();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(getCurrentGeminiKey()).toBeTruthy();
  });

  it("getChatModelIds returns at least one model", () => {
    const ids = getChatModelIds();
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids[0]).toBeTruthy();
  });

  it("fetchWithGeminiKeyRotation calls real Gemini generateContent", async () => {
    if (!hasKey()) return;
    const modelIds = getChatModelIds();
    const modelId = modelIds[0]!;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
    const res = await fetchWithGeminiKeyRotation(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    expect(data.candidates).toBeDefined();
    expect(data.candidates!.length).toBeGreaterThan(0);
    const text = data.candidates![0]?.content?.parts?.[0]?.text ?? "";
    expect(text.trim().toUpperCase()).toBe("OK");
  }, 30000);
});
