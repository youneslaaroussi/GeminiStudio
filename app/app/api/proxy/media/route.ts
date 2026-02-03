/**
 * Secure media proxy route with streaming and Range request support.
 *
 * Proxies media files from allowed domains to avoid CORS issues.
 * Supports Range requests for video seeking and streaming playback.
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

/**
 * HEAD request for browsers to check file size before Range requests.
 */
export async function HEAD(request: NextRequest) {
  const userId = await verifyAuth(request);
  if (!userId) {
    return new NextResponse(null, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url || !isAllowedUrl(url)) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
        "Content-Length": response.headers.get("Content-Length") || "0",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
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
    // Forward Range header for partial content / seeking support
    const rangeHeader = request.headers.get("Range");
    const fetchHeaders: HeadersInit = {
      Accept: "*/*",
    };
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    const response = await fetch(url, { headers: fetchHeaders });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: `Failed to fetch media: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType =
      response.headers.get("Content-Type") || "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes", // Tell browser we support Range requests
    };

    // Forward content length
    const contentLength = response.headers.get("Content-Length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // Forward Content-Range for partial responses (206)
    const contentRange = response.headers.get("Content-Range");
    if (contentRange) {
      headers["Content-Range"] = contentRange;
    }

    // Stream the response body directly without buffering
    return new NextResponse(response.body, {
      status: response.status, // 200 for full, 206 for partial
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
