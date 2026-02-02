import type { ToolExecutionResult } from "@/app/lib/tools/types";
import { logger } from "@/app/lib/server/logger";

type PendingClientTool = {
  toolCallId: string;
  toolName: string;
  resolve: (result: ToolExecutionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT_MS = 45_000;

const globalBridge = globalThis as typeof globalThis & {
  __clientToolPendingMap?: Map<string, PendingClientTool>;
};

const pending =
  globalBridge.__clientToolPendingMap ??
  (globalBridge.__clientToolPendingMap = new Map<string, PendingClientTool>());

export function waitForClientToolResult(options: {
  toolCallId: string;
  toolName: string;
  timeoutMs?: number;
}): Promise<ToolExecutionResult> {
  const { toolCallId, toolName, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (pending.has(toolCallId)) {
    throw new Error(`Tool call ${toolCallId} is already pending.`);
  }

  logger.info({ toolCallId, toolName }, "Waiting for client tool callback");

  return new Promise<ToolExecutionResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(toolCallId);
      logger.error({ toolCallId, toolName }, "Client tool callback timed out");
      reject(
        new Error(
          `Client-side tool "${toolName}" timed out after ${timeoutMs}ms.`
        )
      );
    }, timeoutMs);

    pending.set(toolCallId, {
      toolCallId,
      toolName,
      resolve: (result) => {
        clearTimeout(timeout);
        pending.delete(toolCallId);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        pending.delete(toolCallId);
        reject(error);
      },
      timeout,
    });
  });
}

export function resolveClientToolResult(payload: {
  toolCallId: string;
  result: ToolExecutionResult;
}) {
  const entry = pending.get(payload.toolCallId);
  if (!entry) {
    return false;
  }
  logger.info(
    {
      toolCallId: payload.toolCallId,
      toolName: entry.toolName,
      status: payload.result.status,
    },
    "Received client tool callback"
  );
  entry.resolve(payload.result);
  return true;
}

export function rejectClientTool(toolCallId: string, error: Error) {
  const entry = pending.get(toolCallId);
  if (!entry) {
    return false;
  }
  entry.reject(error);
  return true;
}
