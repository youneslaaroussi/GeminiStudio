import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

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

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    // Client must be configured with v1alpha for ephemeral tokens
    const client = new GoogleGenAI({ 
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    // Create ephemeral token with 30 minute expiry
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
      },
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
