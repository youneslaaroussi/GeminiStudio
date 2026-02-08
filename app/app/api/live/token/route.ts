import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";
import { getCurrentGeminiKey, runWithGeminiKeyRotation } from "@/app/lib/server/gemini-api-keys";
import { LIVE_MODEL } from "@/app/lib/model-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const userId = await verifyToken(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!getCurrentGeminiKey()) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  // Deduct credits before issuing token
  const cost = getCreditsForAction("live_voice_chat");
  try {
    await deductCredits(userId, cost, "live_voice_chat");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Insufficient credits";
    return NextResponse.json({ error: msg, required: cost }, { status: 402 });
  }

  try {
    const token = await runWithGeminiKeyRotation(async (apiKey) => {
      // Client must be configured with v1alpha for ephemeral tokens
      const client = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" },
      });

      // Create ephemeral token with 30 minute expiry
      const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

      return client.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
        },
      });
    });

    console.log("Created ephemeral token:", token.name?.substring(0, 20) + "...");

    return NextResponse.json({
      token: token.name,
      model: LIVE_MODEL,
      expiresAt: expireTime,
    });
  } catch (error) {
    console.error("Failed to create ephemeral token:", error);
    return NextResponse.json(
      { error: "Failed to create session token" },
      { status: 500 }
    );
  }
}
