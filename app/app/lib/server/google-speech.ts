import { getGoogleAccessToken, parseGoogleServiceAccount } from "./google-cloud";

const PROJECT_ID = process.env.SPEECH_PROJECT_ID || process.env.VEO_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.SPEECH_LOCATION || "global";
const RECOGNIZER_ID = process.env.SPEECH_RECOGNIZER_ID || "_";
const MODEL = process.env.SPEECH_MODEL || "chirp_3";
const SERVICE_ACCOUNT_KEY =
  process.env.SPEECH_SERVICE_ACCOUNT_KEY ||
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
  process.env.VEO_SERVICE_ACCOUNT_KEY ||
  process.env.ASSET_SERVICE_ACCOUNT_KEY;
const LANGUAGE_CODES = (process.env.SPEECH_LANGUAGE_CODES || "en-US")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean);
const BUCKET = process.env.SPEECH_GCS_BUCKET;

export interface SpeechEnv {
  projectId: string;
  location: string;
  recognizerId: string;
  model: string;
  languageCodes: string[];
  bucket: string;
}

function assertSpeechEnv(): asserts PROJECT_ID is string & NonNullable<unknown> {
  if (!PROJECT_ID) {
    throw new Error("SPEECH_PROJECT_ID (or VEO_PROJECT_ID / GOOGLE_CLOUD_PROJECT) is not configured");
  }
  if (!SERVICE_ACCOUNT_KEY) {
    throw new Error("SPEECH_SERVICE_ACCOUNT_KEY (or GOOGLE_SERVICE_ACCOUNT_KEY / VEO_SERVICE_ACCOUNT_KEY) is not configured");
  }
  if (!BUCKET) {
    throw new Error("SPEECH_GCS_BUCKET is not configured");
  }
}

export async function getSpeechAccessToken() {
  assertSpeechEnv();
  return getGoogleAccessToken("https://www.googleapis.com/auth/cloud-platform");
}

export function getSpeechEnv(): SpeechEnv {
  assertSpeechEnv();
  return {
    projectId: PROJECT_ID!,
    location: LOCATION,
    recognizerId: RECOGNIZER_ID,
    model: MODEL,
    languageCodes: LANGUAGE_CODES.length ? LANGUAGE_CODES : ["en-US"],
    bucket: BUCKET!,
  };
}
