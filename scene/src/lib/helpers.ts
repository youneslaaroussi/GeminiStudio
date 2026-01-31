import { Vector2 } from '@motion-canvas/core';
import type { Transform, RawSegment } from './types';
import type { TranscriptionEntry } from '../components/AnimatedCaptions';

export const toVector = (transform: Transform) => new Vector2(transform.x, transform.y);

export function parseTimeToMs(time: string | number | undefined): number {
  if (typeof time === 'number') return time;
  if (typeof time === 'string') {
    const numeric = parseFloat(time.replace(/[^0-9.]/g, ''));
    return Number.isFinite(numeric) ? numeric * 1000 : 0;
  }
  return 0;
}

export function normalizeRawSegments(segments: RawSegment[] | undefined): TranscriptionEntry[] {
  if (!segments?.length) return [];
  return segments.flatMap(seg => {
    if (typeof seg.start === 'number' && seg.speech) {
      return [{ start: seg.start, speech: seg.speech }];
    }
    if (seg.text && seg.startTime) {
      const startMs = parseTimeToMs(seg.startTime);
      return [{ start: startMs, speech: seg.text }];
    }
    return [];
  }).filter(s => s.speech.trim().length > 0);
}

export function makeTransitionKey(from: string, to: string): string {
  return `${from}->${to}`;
}
