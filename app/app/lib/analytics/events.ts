/**
 * Firebase Analytics event names and param types.
 * Use these constants so events are consistent and discoverable.
 */
export const ANALYTICS_EVENTS = {
  PAGE_VIEW: "page_view",
  PROJECT_CREATED: "project_created",
  PROJECT_OPENED: "project_opened",
  PROJECT_DELETED: "project_deleted",
  PROJECT_IMPORTED: "project_imported",
  EDITOR_OPENED: "editor_opened",
  RENDER_STARTED: "render_started",
  RENDER_COMPLETED: "render_completed",
  RENDER_FAILED: "render_failed",
  ASSET_UPLOADED: "asset_uploaded",
  CHAT_MESSAGE_SENT: "chat_message_sent",
  VIDEO_EFFECT_APPLIED: "video_effect_applied",
  SHORTCUTS_OPENED: "shortcuts_opened",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Params for standard GA4 events (snake_case, limited keys). */
export interface AnalyticsEventParams {
  page_title?: string;
  page_location?: string;
  project_id?: string;
  project_name?: string;
  format?: string;
  quality?: string;
  asset_type?: string;
  effect_name?: string;
  [key: string]: string | number | boolean | undefined;
}
