import crypto from "crypto";
import { parseGoogleServiceAccount } from "./google-cloud";

const MAX_EXPIRATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MIN_EXPIRATION_SECONDS = 1;
const GCS_HOST = "storage.googleapis.com";

function formatTimestamp(date: Date) {
  const pad = (value: number, length = 2) => value.toString().padStart(length, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function encodeUriPathComponent(objectName: string) {
  return objectName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toCanonicalQueryString(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

interface SignedUrlOptions {
  bucket: string;
  objectName: string;
  method?: string;
  expiresInSeconds?: number;
}

export function createV4SignedUrl({ bucket, objectName, expiresInSeconds = MAX_EXPIRATION_SECONDS, method = "GET" }: SignedUrlOptions) {
  const credentials = parseGoogleServiceAccount() as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Service account JSON must include client_email and private_key to sign URLs");
  }

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const datestamp = timestamp.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;

  const normalizedExpiration = Math.min(
    MAX_EXPIRATION_SECONDS,
    Math.max(MIN_EXPIRATION_SECONDS, Math.floor(expiresInSeconds))
  );

  const canonicalUri = `/${bucket}/${encodeUriPathComponent(objectName)}`;
  const queryParams = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${credentials.client_email}/${credentialScope}`,
    "X-Goog-Date": timestamp,
    "X-Goog-Expires": normalizedExpiration.toString(),
    "X-Goog-SignedHeaders": "host",
  };
  const canonicalQueryString = toCanonicalQueryString(queryParams);
  const canonicalHeaders = `host:${GCS_HOST}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const hashedCanonicalRequest = crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = ["GOOG4-RSA-SHA256", timestamp, credentialScope, hashedCanonicalRequest].join("\n");

  const signature = crypto.createSign("RSA-SHA256").update(stringToSign).sign(credentials.private_key, "hex");
  const signedQueryString = `${canonicalQueryString}&X-Goog-Signature=${signature}`;

  return `https://${GCS_HOST}${canonicalUri}?${signedQueryString}`;
}
