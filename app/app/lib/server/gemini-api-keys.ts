/**
 * Gemini API key rotation: support multiple keys via GOOGLE_GENERATIVE_AI_API_KEYS
 * (comma-separated). On 429 quota errors we rotate to the next key and retry.
 */

const KEYS_ENV = process.env.GOOGLE_GENERATIVE_AI_API_KEYS;
const SINGLE_KEY_ENV = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

function getKeysList(): string[] {
  if (KEYS_ENV?.trim()) {
    const keys = KEYS_ENV.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length) return keys;
  }
  if (SINGLE_KEY_ENV?.trim()) return [SINGLE_KEY_ENV.trim()];
  return [];
}

let currentIndex = 0;
const keys = getKeysList();

export function getGeminiApiKeys(): string[] {
  return [...keys];
}

export function getCurrentGeminiKey(): string | null {
  if (keys.length === 0) return null;
  return keys[currentIndex % keys.length] ?? null;
}

export function rotateGeminiKey(): void {
  if (keys.length <= 1) return;
  const prev = currentIndex;
  currentIndex = (currentIndex + 1) % keys.length;
  if (process.env.NODE_ENV !== "test") {
    console.warn(`[gemini-api-keys] 429 quota exceeded, rotated to key index ${currentIndex} (was ${prev})`);
  }
}

export function is429Error(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toUpperCase();
    return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("QUOTA");
  }
  return false;
}

/**
 * Run an async function that uses a Gemini API key. On 429, rotate to the next key and retry.
 * The function receives the current key and should throw (or return a rejected promise) on 429
 * so that we can rotate and retry.
 */
export async function runWithGeminiKeyRotation<T>(
  fn: (apiKey: string) => Promise<T>
): Promise<T> {
  const n = Math.max(1, keys.length);
  let lastError: unknown;
  for (let i = 0; i < n; i++) {
    const key = getCurrentGeminiKey();
    if (!key) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEYS is not configured");
    }
    try {
      return await fn(key);
    } catch (e) {
      lastError = e;
      if (is429Error(e) && keys.length > 1) {
        rotateGeminiKey();
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

/**
 * Run a fetch to a Gemini API URL that uses ?key=KEY. On 429 response, rotate and retry.
 */
export async function fetchWithGeminiKeyRotation(
  urlWithoutKey: string,
  init: RequestInit
): Promise<Response> {
  return runWithGeminiKeyRotation(async (apiKey) => {
    const sep = urlWithoutKey.includes("?") ? "&" : "?";
    const url = `${urlWithoutKey}${sep}key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, init);
    if (res.status === 429) {
      throw new Error(`Gemini API 429 RESOURCE_EXHAUSTED: ${res.statusText}`);
    }
    return res;
  });
}
