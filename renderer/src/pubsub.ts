import { PubSub } from '@google-cloud/pubsub';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import type { RenderJobData } from './jobs/render-job.js';
import type { RenderResult } from './services/render-runner.js';

const cfg = loadConfig();

const pubsub = new PubSub({
  projectId: cfg.gcpProjectId || undefined,
});
const topic = pubsub.topic(cfg.renderEventTopic);

type JobMetadata = RenderJobData['metadata'];
type AgentMetadata = JobMetadata extends { agent?: infer Agent }
  ? Agent
  : Record<string, unknown>;

export interface RenderEventMetadata extends Record<string, unknown> {
  agent?: AgentMetadata;
}

interface RenderEventBase {
  type: 'render.completed' | 'render.failed';
  jobId: string;
  metadata?: RenderEventMetadata;
  timestamp?: string;
}

export interface RenderCompletedEvent extends RenderEventBase {
  type: 'render.completed';
  result: RenderResult | null;
}

export interface RenderFailedEvent extends RenderEventBase {
  type: 'render.failed';
  error: string;
  failedReason?: string | null;
  stacktrace?: string[] | null;
}

export type RenderEvent = RenderCompletedEvent | RenderFailedEvent;

export const publishRenderEvent = async (event: RenderEvent) => {
  const payload: RenderEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  try {
    await topic.publishMessage({ json: payload });
    logger.info(
      { jobId: payload.jobId, type: payload.type, topic: cfg.renderEventTopic },
      'Published render event',
    );
  } catch (err) {
    logger.error({ err, jobId: payload.jobId }, 'Failed to publish render event');
  }
};
