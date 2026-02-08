import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { ToolExecutionResult, ToolOutput } from "@/app/lib/tools/types";

type ContentEntry = Extract<ToolResultOutput, { type: "content" }>["value"][number];

export function toolResultOutputFromExecution(
  result: ToolExecutionResult
): ToolResultOutput {
  if (result.status === "error") {
    return {
      type: "content",
      value: [
        {
          type: "text",
          text: `Tool failed: ${result.error}`,
        },
      ],
    };
  }

  const content: ContentEntry[] = [];
  result.outputs.forEach((output) => {
    appendContentFromToolOutput(content, output);
  });

  // Multi-modal tool results: when a tool sets meta._injectMedia + meta.fileUri, add file-url
  // so the model receives the media (video, image, or audio). Handled by our local @ai-sdk/google (ai-sdk/packages/google).
  const meta = result.meta as
    | { _injectMedia?: boolean; fileUri?: string; mimeType?: string; assetName?: string }
    | undefined;
  if (meta?._injectMedia && meta?.fileUri) {
    content.push({
      type: "file-url",
      url: meta.fileUri,
      ...(meta.mimeType && {
        providerOptions: { google: { mimeType: meta.mimeType } } as Record<string, unknown>,
      }),
    } as ContentEntry);
  }

  if (content.length === 0) {
    content.push({
      type: "text",
      text: "Tool completed with no additional output.",
    });
  }

  return {
    type: "content",
    value: content,
  };
}

function appendContentFromToolOutput(content: ContentEntry[], output: ToolOutput) {
  switch (output.type) {
    case "text": {
      if (output.text.trim().length > 0) {
        content.push({
          type: "text",
          text: output.text,
        });
      }
      break;
    }
    case "json": {
      try {
        const text = JSON.stringify(output.data, null, 2);
        content.push({
          type: "text",
          text,
        });
      } catch {
        content.push({
          type: "text",
          text: String(output.data),
        });
      }
      break;
    }
    case "list": {
      const lines = flattenListOutput(output.items);
      if (lines.length > 0) {
        content.push({
          type: "text",
          text: lines.join("\n"),
        });
      }
      break;
    }
    case "image": {
      if (output.alt) {
        content.push({
          type: "text",
          text: output.alt,
        });
      }

      if (output.url.startsWith("data:")) {
        const match = output.url.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          content.push({
            type: "image-data",
            mediaType: match[1] || "image/png",
            data: match[2],
          });
          break;
        }
      }
      content.push({
        type: "image-url",
        url: output.url,
      });
      break;
    }
    case "code": {
      // Encode as a text entry with a special marker prefix that the ChatPanel can
      // detect and render as a rich CodeToolResultCard component.
      const codePayload = JSON.stringify({
        language: output.language,
        filename: output.filename,
        code: output.code,
        oldCode: output.oldCode,
        summary: output.summary,
      });
      content.push({
        type: "text",
        text: `<!--code:${codePayload}-->`,
      });
      // Also push a plain text summary for the model to read
      if (output.summary) {
        content.push({
          type: "text",
          text: output.summary,
        });
      }
      break;
    }
    case "file": {
      // Return file as multimodal content for the model to process
      // Per AI SDK docs: Gemini Files API URLs (https://generativelanguage.googleapis.com/v1beta/files/...)
      // are passed through directly without downloading
      if (output.displayName) {
        content.push({
          type: "text",
          text: `Asset: ${output.displayName}`,
        });
      }
      // Use 'media' type which has both data (URL) and mediaType
      // The AI SDK should pass Gemini Files API URLs through to the model
      content.push({
        type: "media",
        data: output.fileUri,
        mediaType: output.mimeType,
      });
      break;
    }
    default: {
      content.push({
        type: "text",
        text: `[Unsupported output type: ${output["type"] ?? "unknown"}]`,
      });
      break;
    }
  }
}

function flattenListOutput(items: ToolOutput[], depth = 0): string[] {
  const prefix = `${"  ".repeat(depth)}- `;
  const lines: string[] = [];
  items.forEach((item) => {
    switch (item.type) {
      case "text":
        lines.push(`${prefix}${item.text}`);
        break;
      case "json":
        lines.push(`${prefix}${safeStringify(item.data)}`);
        break;
      case "image":
        lines.push(`${prefix}${item.alt ?? "Image output"}`);
        break;
      case "list":
        lines.push(...flattenListOutput(item.items, depth + 1));
        break;
      case "file":
        lines.push(`${prefix}${item.displayName ?? "File"} (${item.mimeType})`);
        break;
    }
  });
  return lines;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
