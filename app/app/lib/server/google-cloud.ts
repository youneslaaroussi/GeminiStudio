import { GoogleAuth } from "google-auth-library";

const SERVICE_ACCOUNT_KEY =
  process.env.ASSET_SERVICE_ACCOUNT_KEY ||
  process.env.SPEECH_SERVICE_ACCOUNT_KEY ||
  process.env.VEO_SERVICE_ACCOUNT_KEY ||
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

export function assertGoogleCredentials() {
  if (!SERVICE_ACCOUNT_KEY) {
    throw new Error(
      "A Google Cloud service account JSON is required (set ASSET_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY)"
    );
  }
}

export function parseGoogleServiceAccount() {
  assertGoogleCredentials();
  try {
    return JSON.parse(SERVICE_ACCOUNT_KEY!);
  } catch {
    throw new Error("Invalid Google Cloud service account JSON");
  }
}

export async function getGoogleAccessToken(scopes: string[] | string) {
  const auth = new GoogleAuth({
    credentials: parseGoogleServiceAccount(),
    scopes,
  });
  const client = await auth.getClient();
  const response = await client.getAccessToken();
  const token = response.token;
  if (!token) {
    throw new Error("Unable to acquire Google Cloud access token");
  }
  return token;
}
