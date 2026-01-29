import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getBilling } from "@/app/lib/server/credits";

async function verifyToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * GET /api/credits – return current user billing (credits, tier).
 * Requires Authorization: Bearer <firebase-id-token>.
 */
export async function GET(request: NextRequest) {
  const uid = await verifyToken(request);
  if (!uid) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  try {
    const billing = await getBilling(uid);
    return NextResponse.json(billing);
  } catch (e) {
    console.error("Credits API error:", e);
    return NextResponse.json(
      { error: "Failed to load credits" },
      { status: 500 }
    );
  }
}
