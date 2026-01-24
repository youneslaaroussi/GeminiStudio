import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const filteredMessages = messages.filter(
    (message) => typeof message.role === "string" && message.role.length > 0
  );

  const result = streamText({
    model: google("gemini-3-pro-preview"),
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    },
    messages: await convertToModelMessages(filteredMessages),
    stopWhen: stepCountIs(5),
    tools: {
      getDate: tool({
        description: "Get the current date in ISO format.",
        inputSchema: z.object({
          locale: z
            .string()
            .optional()
            .describe("Optional locale for formatting"),
        }),
        async execute({ locale }) {
          const now = new Date();
          return locale
            ? now.toLocaleDateString(locale)
            : now.toISOString().split("T")[0];
        },
      }),
      getTime: tool({
        description: "Get the current time in HH:MM:SS format.",
        inputSchema: z.object({
          locale: z
            .string()
            .optional()
            .describe("Optional locale or time zone identifier."),
        }),
        async execute({ locale }) {
          const now = new Date();
          return locale
            ? now.toLocaleTimeString(locale, { hour12: false })
            : now.toISOString().split("T")[1].split(".")[0];
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (err) => {
      if (err == null) {
        return "Unknown error while contacting Gemini.";
      }
      if (typeof err === "string") {
        return err;
      }
      if (err instanceof Error) {
        return err.message;
      }
      return JSON.stringify(err);
    },
  });
}
