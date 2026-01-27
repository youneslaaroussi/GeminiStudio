/**
 * Thumbnail capture and compression utilities for project previews
 */

export async function captureThumbnail(
  sourceCanvas: HTMLCanvasElement
): Promise<string | null> {
  try {
    // Create 480x270 offscreen canvas (16:9 aspect ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('Failed to get canvas context');
      return null;
    }

    // Draw scaled source onto thumbnail canvas
    ctx.drawImage(sourceCanvas, 0, 0, 480, 270);

    // Compress to JPEG, starting at quality 0.7
    let quality = 0.7;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);

    // Reduce quality if too large (>50KB)
    while (dataUrl.length > 50000 && quality > 0.3) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    return dataUrl;
  } catch (error) {
    console.error('Failed to capture thumbnail:', error);
    return null;
  }
}
