/**
 * Secure media proxy route.
 *
 * Proxies media files from allowed domains to avoid CORS issues.
 * Requires authentication and only allows specific trusted domains.
 *
 * Usage: /api/proxy/media?url=<encoded-url>
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/app/lib/server/auth";

export const runtime = "nodejs";

// Allowed domains for proxying (to prevent SSRF attacks)
const ALLOWED_DOMAINS = [
  "storage.googleapis.com",
  "storage.cloud.google.com",
  // Add other trusted CDN domains here if needed
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_DOMAINS.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "url parameter is required" },
      { status: 400 }
    );
  }

  // Validate URL is from allowed domains
  if (!isAllowedUrl(url)) {
    return NextResponse.json(
      { error: "URL domain not allowed" },
      { status: 403 }
    );
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "*/*",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch media: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
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
