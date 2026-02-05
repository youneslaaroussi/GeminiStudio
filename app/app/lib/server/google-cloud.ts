import fs from "fs";
import path from "path";
import { GoogleAuth } from "google-auth-library";

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const DEFAULT_SERVICE_ACCOUNT_ENV_ORDER = [
  "ASSET_SERVICE_ACCOUNT_KEY",
  "SPEECH_SERVICE_ACCOUNT_KEY",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
] as const;

type ServiceAccountEnvVar = (typeof DEFAULT_SERVICE_ACCOUNT_ENV_ORDER)[number];

interface ServiceAccountCacheEntry {
  raw: string;
  parsed?: Record<string, unknown>;
  filePath: string | null;
  sourceValue: string;
}

const keyCache = new Map<ServiceAccountEnvVar, ServiceAccountCacheEntry>();

function getServiceAccountSource(preferred?: string[]) {
  const order = (preferred?.length ? preferred : DEFAULT_SERVICE_ACCOUNT_ENV_ORDER) as string[];
  for (const envName of order) {
    const value = process.env[envName];
    if (value) {
      return { envName: envName as ServiceAccountEnvVar, value };
    }
  }
  return null;
}

export function assertGoogleCredentials(options?: { preferredEnvVars?: string[] }) {
  const source = getServiceAccountSource(options?.preferredEnvVars);
  if (!source) {
    throw new Error(
      "A Google Cloud service account JSON is required (set ASSET_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY)"
    );
  }
}

function expandHomePath(filePath: string) {
  if (filePath.startsWith("~")) {
    const home = process.env.HOME;
    if (!home) {
      throw new Error("Cannot expand ~ in service account path because HOME is not set");
    }
    return path.join(home, filePath.slice(1));
  }
  return filePath;
}

function resolveServiceAccountKey(options?: { preferredEnvVars?: string[] }) {
  const source = getServiceAccountSource(options?.preferredEnvVars);
  if (!source) {
    throw new Error(
      "A Google Cloud service account JSON is required (set ASSET_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY)"
    );
  }
  const cached = keyCache.get(source.envName);
  if (cached && cached.sourceValue === source.value) {
    return { raw: cached.raw, filePath: cached.filePath ?? undefined, envName: source.envName, sourceValue: source.value };
  }
  const trimmed = source.value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    keyCache.set(source.envName, { raw: trimmed, sourceValue: source.value, filePath: null });
    return { raw: trimmed, envName: source.envName, sourceValue: source.value };
  }
  const expanded = expandHomePath(trimmed);
  const resolvedPath = path.isAbsolute(expanded) ? expanded : path.resolve(PROJECT_ROOT, expanded);
  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    keyCache.set(source.envName, { raw, sourceValue: source.value, filePath: resolvedPath });
    return { raw, filePath: resolvedPath, envName: source.envName, sourceValue: source.value };
  } catch (error) {
    throw new Error(
      `Unable to read Google Cloud service account key file at ${resolvedPath}: ${(error as Error).message}`
    );
  }
}

export function parseGoogleServiceAccount(options?: { preferredEnvVars?: string[] }) {
  const source = resolveServiceAccountKey(options);
  const cacheEntry = source.envName ? keyCache.get(source.envName) : undefined;
  if (cacheEntry?.parsed && cacheEntry.sourceValue === source.sourceValue) {
    return cacheEntry.parsed;
  }
  try {
    const parsed = JSON.parse(source.raw);
    if (source.envName) {
      keyCache.set(source.envName, {
        raw: source.raw,
        filePath: cacheEntry?.filePath ?? source.filePath ?? null,
        parsed,
        sourceValue: source.sourceValue,
      });
    }
    return parsed;
  } catch {
    const filePath = cacheEntry?.filePath ?? source.filePath;
    if (filePath) {
      throw new Error(`Invalid Google Cloud service account JSON in ${filePath}`);
    }
    throw new Error("Invalid Google Cloud service account JSON");
  }
}

export async function getGoogleAccessToken(scopes: string[] | string, options?: { preferredEnvVars?: string[] }) {
  const auth = new GoogleAuth({
    credentials: parseGoogleServiceAccount(options),
    scopes,
  });
  const client = await auth.getClient();
  const response = await client.getAccessToken();
  const tokenValue =
    typeof response === "string"
      ? response
      : typeof response === "object" && response !== null
        ? response.token || (response as { access_token?: string }).access_token
        : undefined;
  if (!tokenValue) {
    throw new Error("Unable to acquire Google Cloud access token");
  }
  if (process.env.NODE_ENV !== "production") {
    console.log("[google-cloud] minted token prefix", tokenValue.slice(0, 10));
  }
  return tokenValue;
}
