"use client";

import { useCallback } from "react";
import { useAnalyticsContext } from "@/app/lib/analytics/AnalyticsProvider";
import { ANALYTICS_EVENTS, type AnalyticsEventParams } from "@/app/lib/analytics/events";

/**
 * Hook to access Firebase Analytics. Returns a no-op if analytics is not ready (SSR or disabled).
 */
export function useAnalytics() {
  const ctx = useAnalyticsContext();

  const logEvent = useCallback(
    (eventName: string, params?: AnalyticsEventParams) => {
      ctx?.logEvent(eventName, params);
    },
    [ctx]
  );

  return {
    logEvent,
    isReady: !!ctx?.isReady,
    /** Typed helpers for common events */
    events: {
      pageView: (params?: AnalyticsEventParams) =>
        logEvent(ANALYTICS_EVENTS.PAGE_VIEW, params),
      projectCreated: (params?: { project_id?: string; project_name?: string }) =>
        logEvent(ANALYTICS_EVENTS.PROJECT_CREATED, params),
      projectOpened: (params?: { project_id?: string; project_name?: string }) =>
        logEvent(ANALYTICS_EVENTS.PROJECT_OPENED, params),
      projectDeleted: (params?: { project_id?: string }) =>
        logEvent(ANALYTICS_EVENTS.PROJECT_DELETED, params),
      projectImported: (params?: { project_id?: string }) =>
        logEvent(ANALYTICS_EVENTS.PROJECT_IMPORTED, params),
      editorOpened: (params?: { project_id?: string }) =>
        logEvent(ANALYTICS_EVENTS.EDITOR_OPENED, params),
      renderStarted: (params?: { project_id?: string; format?: string; quality?: string }) =>
        logEvent(ANALYTICS_EVENTS.RENDER_STARTED, params),
      renderCompleted: (params?: { project_id?: string; format?: string }) =>
        logEvent(ANALYTICS_EVENTS.RENDER_COMPLETED, params),
      renderFailed: (params?: { project_id?: string }) =>
        logEvent(ANALYTICS_EVENTS.RENDER_FAILED, params),
      assetUploaded: (params?: { asset_type?: string }) =>
        logEvent(ANALYTICS_EVENTS.ASSET_UPLOADED, params),
      chatMessageSent: () => logEvent(ANALYTICS_EVENTS.CHAT_MESSAGE_SENT),
      videoEffectApplied: (params?: { effect_name?: string }) =>
        logEvent(ANALYTICS_EVENTS.VIDEO_EFFECT_APPLIED, params),
      shortcutsOpened: () => logEvent(ANALYTICS_EVENTS.SHORTCUTS_OPENED),
    },
  };
}
