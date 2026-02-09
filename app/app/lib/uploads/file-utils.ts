const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".wmv",
  ".flv",
  ".m4v",
  ".mpeg",
  ".mpg",
  ".3gp",
];

const HEIC_EXTENSIONS = [".heic", ".heif"];

function getExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  return lastDot === -1 ? "" : name.slice(lastDot).toLowerCase();
}

export function isVideoFile(mimeType: string, fileName: string) {
  if (mimeType?.startsWith("video/")) {
    return true;
  }
  const ext = getExtension(fileName);
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isHeicFile(mimeType: string, fileName: string) {
  if (!fileName) return false;
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized.startsWith("image/heic") || normalized.startsWith("image/heif")) {
    return true;
  }
  const ext = getExtension(fileName);
  return HEIC_EXTENSIONS.includes(ext);
}

export function sanitizeObjectNameSegment(name: string) {
  return name.replace(/[\\]/g, "_").replace(/\//g, "_");
}

export { VIDEO_EXTENSIONS, HEIC_EXTENSIONS };
