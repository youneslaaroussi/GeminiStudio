/**
 * Download proxy for rendered videos.
 *
 * Requires authentication and validates that the requested URL
 * belongs to the authenticated user's renders.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/app/lib/server/auth";
import { verifyProjectOwnership } from "@/app/lib/server/firebase-admin";

export async function GET(request: NextRequest) {
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 }
    );
  }

  try {
    // Validate URL is from Google Cloud Storage
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.endsWith("storage.googleapis.com")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Validate that the URL path belongs to a project the user owns
    // Renders are stored at: renders/{projectId}/{filename}
    const pathMatch = parsedUrl.pathname.match(/\/renders\/([^/]+)\//);
    if (!pathMatch) {
      return NextResponse.json({ error: "Invalid render path" }, { status: 403 });
    }

    const projectId = pathMatch[1];
    const ownsProject = await verifyProjectOwnership(userId, projectId);
    if (!ownsProject) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch from GCS
    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch: ${response.status}` },
        { status: response.status }
      );
    }

    // Get content type and length
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    // Extract filename from URL path
    const pathParts = parsedUrl.pathname.split("/");
    const filename =
      pathParts[pathParts.length - 1]?.split("?")[0] || "video.mp4";

    // Stream the response
    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    });

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Download proxy error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed" },
      { status: 500 }
    );
  }
}
