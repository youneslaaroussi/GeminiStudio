import { z } from 'zod';
import type { Project } from '../types/index.js';

export const outputFormatEnum = z.enum(['mp4', 'webm', 'gif']);

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
    destination: z.string(),
    range: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
    toClipboard: z.boolean().optional(),
    includeAudio: z.boolean().optional(),
    uploadUrl: z.string().url().optional(),
  }),
  variables: z
    .object({
      duration: z.number().positive().optional(),
      transitions: z.record(z.any()).optional(),
      layers: z.any().optional(),
      transcriptions: z.record(z.any()).optional(),
    })
    .optional(),
  assets: z
    .object({
      baseUrl: z.string().url().optional(),
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
    })
    .optional(),
});

export type RenderJobData = z.infer<typeof renderJobSchema>;
