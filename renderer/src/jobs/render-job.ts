import { z } from 'zod';
import { resolve, normalize } from 'path';
import type { Project } from '../types/index.js';

export const outputFormatEnum = z.enum(['mp4', 'webm', 'gif']);

// Allowed domains for upload URLs (GCS signed URLs only)
const ALLOWED_UPLOAD_DOMAINS = [
  'storage.googleapis.com',
  'storage.cloud.google.com',
];

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
 * Custom validator for upload URLs - must be GCS signed URLs only.
 */
const safeUploadUrl = z.string().url().refine(
  (url) => isAllowedDomain(url, ALLOWED_UPLOAD_DOMAINS),
  { message: 'Upload URL must be a Google Cloud Storage signed URL' }
);

/**
 * Minimal render job schema.
 *
 * Callers send only identifiers + render settings.
 * The renderer fetches all project data, assets, components, and transcriptions itself.
 */
export const renderJobSchema = z.object({
  /** Project owner user ID (trusted — verified by caller). */
  userId: z.string().min(1),
  /** Project ID. */
  projectId: z.string().min(1),
  /** Branch ID (e.g. "main"). */
  branchId: z.string().min(1),

  output: z.object({
    format: outputFormatEnum,
    /** FPS override. If not provided, uses project fps. */
    fps: z.number().positive().optional(),
    quality: z.string().default('web'),
    /** Time range [start, end] in seconds. If not provided, renders full timeline. */
    range: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
    includeAudio: z.boolean().optional(),
    /** Pre-signed GCS upload URL. */
    uploadUrl: safeUploadUrl,
  }),

  options: z
    .object({
      /** Resolution scale factor (0.1-1.0). Used for preview renders to reduce resolution. */
      resolutionScale: z.number().min(0.1).max(1).optional(),
      useDedicatedGpu: z.boolean().optional(),
      segments: z.number().int().positive().optional(),
      segmentDuration: z.number().positive().optional(),
      maxSegmentDuration: z.number().positive().optional(),
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
          branchId: z.string().optional(),
        })
        .optional(),
      tags: z.array(z.string()).optional(),
      extra: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export type RenderJobInput = z.infer<typeof renderJobSchema>;

/**
 * Internal hydrated render job data — includes the fetched project and computed values.
 * This is what gets passed to the render runner after the project-fetcher runs.
 */
export interface RenderJobData {
  project: Project;
  timelineDuration?: number;
  output: {
    format: 'mp4' | 'webm' | 'gif';
    fps: number;
    size: { width: number; height: number };
    quality: string;
    destination: string;
    range?: [number, number];
    toClipboard?: boolean;
    includeAudio?: boolean;
    uploadUrl?: string;
  };
  variables?: {
    duration?: number;
    transitions?: Record<string, unknown>;
    layers?: unknown;
    transcriptions?: Record<string, unknown>;
    captionSettings?: unknown;
    textClipSettings?: unknown;
  };
  assets?: {
    baseUrl?: string;
    token?: string;
    headers?: Record<string, string>;
  };
  options?: {
    useDedicatedGpu?: boolean;
    segments?: number;
    segmentDuration?: number;
    maxSegmentDuration?: number;
    resolutionScale?: number;
  };
  componentFiles?: Record<string, string>;
  metadata?: {
    agent?: {
      threadId?: string;
      projectId?: string;
      userId?: string;
      requestId?: string;
      branchId?: string;
    };
    tags?: string[];
    extra?: Record<string, unknown>;
  };
}
