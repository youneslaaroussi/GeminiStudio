import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy route for media files (images/videos) to avoid CORS issues.
 * Usage: /api/proxy/media?url=<encoded-url>
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch media: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");
    const buffer = await response.arrayBuffer();

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    };

    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Media proxy error:", error);
    return NextResponse.json(
      { error: "Failed to proxy media" },
      { status: 500 }
    );
  }
}
