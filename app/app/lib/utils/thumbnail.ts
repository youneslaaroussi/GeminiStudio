/**
 * Thumbnail capture and compression utilities for project previews
 */

const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 270;

export async function captureThumbnail(
  sourceCanvas: HTMLCanvasElement
): Promise<string | null> {
  try {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    if (!sw || !sh) return null;

    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('Failed to get canvas context');
      return null;
    }

    // Scale to COVER 480x270 so aspect ratio is preserved (no stretch)
    const scale = Math.max(THUMB_WIDTH / sw, THUMB_HEIGHT / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (THUMB_WIDTH - dw) / 2;
    const dy = (THUMB_HEIGHT - dh) / 2;
    ctx.drawImage(sourceCanvas, 0, 0, sw, sh, dx, dy, dw, dh);

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
