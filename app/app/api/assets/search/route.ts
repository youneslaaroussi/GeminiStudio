import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/app/lib/server/auth";
import { searchAssetsFromService } from "@/app/lib/server/asset-service-client";

export async function POST(request: NextRequest) {
  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { query, type, limit } = body as {
      query: string;
      type?: string;
      limit?: number;
    };

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const results = await searchAssetsFromService(userId, projectId, query, {
      type,
      limit,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const query = searchParams.get("q");
  const type = searchParams.get("type") || undefined;
  const limit = searchParams.get("limit")
    ? parseInt(searchParams.get("limit")!, 10)
    : undefined;

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  if (!query) {
    return NextResponse.json(
      { error: "q query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const results = await searchAssetsFromService(userId, projectId, query, {
      type,
      limit,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
