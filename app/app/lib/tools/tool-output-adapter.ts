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
