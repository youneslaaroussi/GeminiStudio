import { z } from 'zod';
import { resolve, normalize } from 'path';
import type { Project } from '../types/index.js';

export const outputFormatEnum = z.enum(['mp4', 'webm', 'gif']);

// Allowed domains for upload URLs (GCS signed URLs only)
const ALLOWED_UPLOAD_DOMAINS = [
  'storage.googleapis.com',
  'storage.cloud.google.com',
];

// Allowed domains for asset base URLs
const ALLOWED_ASSET_DOMAINS = [
  'storage.googleapis.com',
  'storage.cloud.google.com',
  'localhost',
  '127.0.0.1',
];

// Safe temp directory for render outputs
const SAFE_OUTPUT_DIR = '/tmp';

/**
 * Validate that a URL is from an allowed domain.
 */
const isAllowedDomain = (url: string, allowedDomains: string[]): boolean => {
  try {
    const parsed = new URL(url);
    return allowedDomains.some(domain => 
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
};

/**
 * Validate that a file path is within the safe output directory.
 * Prevents path traversal attacks.
 */
const isSafePath = (path: string): boolean => {
  const resolved = resolve(normalize(path));
  return resolved.startsWith(SAFE_OUTPUT_DIR + '/') || resolved === SAFE_OUTPUT_DIR;
};

/**
 * Custom validator for upload URLs - must be GCS signed URLs only.
 */
const safeUploadUrl = z.string().url().refine(
  (url) => isAllowedDomain(url, ALLOWED_UPLOAD_DOMAINS),
  { message: 'Upload URL must be a Google Cloud Storage signed URL' }
);

/**
 * Custom validator for asset base URLs - must be from allowed domains.
 */
const safeAssetBaseUrl = z.string().url().refine(
  (url) => isAllowedDomain(url, ALLOWED_ASSET_DOMAINS),
  { message: 'Asset base URL must be from an allowed domain' }
);

/**
 * Custom validator for output destination - must be in /tmp.
 */
const safeDestination = z.string().refine(
  (path) => isSafePath(path),
  { message: 'Output destination must be within /tmp directory' }
);

export const renderJobSchema = z.object({
  project: z.custom<Project>(),
  timelineDuration: z.number().positive().optional(),
  output: z.object({
    format: outputFormatEnum,
    fps: z.number().positive(),
    size: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    quality: z.string().default('web'),
    destination: safeDestination,
    range: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
    toClipboard: z.boolean().optional(),
    includeAudio: z.boolean().optional(),
    uploadUrl: safeUploadUrl.optional(),
  }),
  variables: z
    .object({
      duration: z.number().positive().optional(),
      transitions: z.record(z.any()).optional(),
      layers: z.any().optional(),
      transcriptions: z.record(z.any()).optional(),
      captionSettings: z.any().optional(),
      textClipSettings: z.any().optional(),
    })
    .optional(),
  assets: z
    .object({
      baseUrl: safeAssetBaseUrl.optional(),
      token: z.string().optional(),
      headers: z.record(z.string()).optional(),
    })
    .optional(),
  options: z
    .object({
      useDedicatedGpu: z.boolean().optional(),
      segments: z.number().int().positive().optional(),
      segmentDuration: z.number().positive().optional(),
      maxSegmentDuration: z.number().positive().optional(),
      /** Resolution scale factor (0.1-1.0). Used for preview renders to reduce resolution. */
      resolutionScale: z.number().min(0.1).max(1).optional(),
    })
    .optional(),
  metadata: z
    .object({
      agent: z
        .object({
          threadId: z.string().optional(),
          projectId: z.string().optional(),
          userId: z.string().optional(),
          requestId: z.string().optional(),
        })
        .optional(),
      tags: z.array(z.string()).optional(),
      extra: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export type RenderJobData = z.infer<typeof renderJobSchema>;
