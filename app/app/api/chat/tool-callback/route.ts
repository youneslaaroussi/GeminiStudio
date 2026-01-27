import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveClientToolResult } from "@/app/lib/server/tools/client-tool-bridge";
import { logger } from "@/app/lib/server/logger";

export const runtime = "nodejs";

const callbackSchema = z.object({
  toolCallId: z.string().min(1, "toolCallId is required"),
  result: z.union([
    z.object({
      status: z.literal("success"),
      outputs: z.array(z.any()),
      meta: z.record(z.any()).optional(),
    }),
    z.object({
      status: z.literal("error"),
      error: z.string(),
      details: z.any().optional(),
    }),
  ]),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = callbackSchema.safeParse(json);
  if (!parsed.success) {
    logger.error({ error: parsed.error.flatten() }, "Invalid tool callback payload");
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const didResolve = resolveClientToolResult(parsed.data);
  if (!didResolve) {
    logger.warn(
      { toolCallId: parsed.data.toolCallId },
      "Received callback for unknown tool call"
    );
    return NextResponse.json(
      { error: "Unknown or expired tool call." },
      { status: 404 }
    );
  }

  logger.info({ toolCallId: parsed.data.toolCallId }, "Client tool callback accepted");
  return NextResponse.json({ ok: true });
}
