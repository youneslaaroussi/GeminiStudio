import { UIMessage, UIDataTypes } from "ai";
import type { ToolExecutionResult } from "@/app/lib/tools/types";
import type { AssetType } from "@/app/types/assets";

export type ChatMode = "ask" | "agent" | "plan";

/**
 * Represents an asset mentioned in the chat input via @ mention
 */
export interface AssetMention {
  id: string;
  name: string;
  type: AssetType;
  url?: string;
  thumbnailUrl?: string;
  description?: string;
  /** Starting character offset (in plain text) where @mention begins */
  start?: number;
  /** Ending character offset (exclusive) for the @mention */
  end?: number;
  /** Plain text slice for the mention (e.g., "@Asset Name") */
  plainText?: string;
}

/**
 * Media category for attachments
 */
export type AttachmentCategory = "image" | "video" | "audio" | "document" | "unknown";

/**
 * Attachment metadata stored with chat messages
 */
export interface ChatAttachment {
  /** Unique identifier */
  id: string;
  /** Original filename */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Media category */
  category: AttachmentCategory;
  /** GCS URI if uploaded to cloud storage */
  gcsUri?: string;
  /** Signed URL for temporary access (use for display/playback) */
  signedUrl?: string;
  /** Base64 data for small inline files (for display) */
  inlineData?: string;
  /** Thumbnail URL for preview */
  thumbnailUrl?: string;
  /** Upload timestamp */
  uploadedAt: string;
}

export interface ChatMessageMetadata {
  mode: ChatMode;
  /** Attachments included with this message */
  attachments?: ChatAttachment[];
  /** Assets mentioned via @ in the message */
  assetMentions?: AssetMention[];
}

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskListItem {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
}

export interface TaskListSnapshot {
  id: string;
  title?: string;
  updatedAt: string;
  tasks: TaskListItem[];
}

export interface PlanningToolTaskInput {
  id?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
}

export interface PlanningToolResponse {
  action: string;
  message?: string;
  taskList: TaskListSnapshot;
}

type BaseToolMap = {
  "tool-getDate": {
    input: { locale?: string };
    output: string;
  };
  "tool-getTime": {
    input: { locale?: string };
    output: string;
  };
  "tool-planCreateTaskList": {
    input: {
      title?: string;
      tasks: PlanningToolTaskInput[];
    };
    output: PlanningToolResponse;
  };
  "tool-planAddTask": {
    input: {
      task: PlanningToolTaskInput;
    };
    output: PlanningToolResponse;
  };
  "tool-planUpdateTask": {
    input: {
      id: string;
      title?: string;
      description?: string;
      status?: TaskStatus;
    };
    output: PlanningToolResponse;
  };
  "tool-planRemoveTask": {
    input: {
      id: string;
    };
    output: PlanningToolResponse;
  };
  "tool-planResetTaskList": {
    input: {
      title?: string;
    };
    output: PlanningToolResponse;
  };
};

type ToolboxToolMap = Record<
  string,
  {
    input: Record<string, unknown>;
    output: ToolExecutionResult;
  }
>;

export type ToolMap = BaseToolMap & ToolboxToolMap;

export type TimelineChatMessage = UIMessage<
  ChatMessageMetadata,
  UIDataTypes,
  ToolMap
>;

export interface AssistantChatSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentMode: ChatMode;
  messages: TimelineChatMessage[];
}
