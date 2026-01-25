import { UIMessage, UIDataTypes } from "ai";

export type ChatMode = "ask" | "agent" | "plan";

export interface ChatMessageMetadata {
  mode: ChatMode;
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

type ToolMap = {
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
