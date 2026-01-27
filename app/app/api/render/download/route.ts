import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    // Validate URL is from Google Cloud Storage
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.endsWith("storage.googleapis.com")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
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
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    // Extract filename from URL path
    const pathParts = parsedUrl.pathname.split("/");
    const filename = pathParts[pathParts.length - 1]?.split("?")[0] || "video.mp4";

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
