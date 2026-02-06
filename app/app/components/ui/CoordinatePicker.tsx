'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { X, Plus, MousePointer2, Loader2 } from 'lucide-react';
import { useAssetFrames, getFrameAtTimestamp } from '@/app/hooks/use-asset-frames';

export interface Point {
  x: number;
  y: number;
  label?: string;
}

/** Supported media types */
export type MediaType = 'image' | 'video';

export interface CoordinatePickerProps {
  /** URL of the image or video to display */
  src: string;
  /** Media type - 'image' or 'video' (default: auto-detect from URL) */
  mediaType?: MediaType;
  /** Asset ID for video - when provided with projectId, uses sampled frames for preview */
  assetId?: string;
  /** Project ID for video - when provided with assetId, uses sampled frames for preview */
  projectId?: string;
  /** Alt text for the image */
  alt?: string;
  /** Current points */
  points: Point[];
  /** Callback when points change */
  onChange: (points: Point[]) => void;
  /** Maximum number of points allowed (default: unlimited) */
  maxPoints?: number;
  /** Whether to allow multiple points (default: true) */
  multiple?: boolean;
  /** Custom point color (default: primary) */
  pointColor?: string;
  /** Size of point markers in pixels (default: 12) */
  pointSize?: number;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Aspect ratio to maintain (e.g., "16/9") */
  aspectRatio?: string;
  /** Class name for the container */
  className?: string;
}

/**
 * Detect media type from URL or MIME type
 */
function detectMediaType(url: string): MediaType {
  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.includes('.mp4') ||
    lowerUrl.includes('.webm') ||
    lowerUrl.includes('.mov') ||
    lowerUrl.includes('.avi') ||
    lowerUrl.includes('.m4v') ||
    lowerUrl.includes('video/')
  ) {
    return 'video';
  }
  return 'image';
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * A reusable component for picking coordinates on an image or video.
 * Supports single or multiple point selection with visual markers.
 */
export function CoordinatePicker({
  src,
  mediaType: mediaTypeProp,
  assetId,
  projectId,
  alt = 'Click to select points',
  points,
  onChange,
  maxPoints,
  multiple = true,
  pointColor = 'rgb(var(--primary))',
  pointSize = 12,
  disabled = false,
  aspectRatio = '16/9',
  className = '',
}: CoordinatePickerProps) {
  // Auto-detect media type if not provided
  const mediaType = mediaTypeProp ?? detectMediaType(src);

  const mediaSrc = src;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number } | null>(null);

  // Video-specific state - use sampled frames when assetId+projectId provided
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const { frames, duration: framesDuration, isLoading: framesLoading } = useAssetFrames(
    mediaType === 'video' && assetId && projectId ? assetId : undefined,
    mediaType === 'video' && assetId ? projectId ?? null : null
  );
  const duration = framesDuration || 0;
  const frame = getFrameAtTimestamp(frames, duration, currentTimestamp);
  const frameDataUrl = frame?.url ?? null;
  const isExtractingFrame = mediaType === 'video' && assetId && framesLoading;

  // Track the natural dimensions of the loaded media
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setMediaDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // Set dimensions from first frame when using sampled frames
  useEffect(() => {
    if (mediaType === 'video' && frameDataUrl && !mediaDimensions) {
      const img = new Image();
      img.onload = () => setMediaDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = frameDataUrl;
    }
  }, [mediaType, frameDataUrl, mediaDimensions]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const time = parseFloat(e.target.value);
    setCurrentTimestamp(time);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (maxPoints && points.length >= maxPoints && !multiple) return;

      // Don't place points when clicking on controls
      const target = e.target as HTMLElement;
      if (target.closest('.video-controls')) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Convert to percentage-based coordinates (0-1 range)
      const relativeX = x / rect.width;
      const relativeY = y / rect.height;

      // Convert to actual pixel coordinates based on media dimensions
      // If we don't know dimensions, use percentage * 1000 as a reasonable default
      const actualX = mediaDimensions
        ? Math.round(relativeX * mediaDimensions.width)
        : Math.round(relativeX * 1000);
      const actualY = mediaDimensions
        ? Math.round(relativeY * mediaDimensions.height)
        : Math.round(relativeY * 1000);

      const newPoint: Point = { x: actualX, y: actualY };

      if (multiple) {
        if (maxPoints && points.length >= maxPoints) {
          // Replace the oldest point
          onChange([...points.slice(1), newPoint]);
        } else {
          onChange([...points, newPoint]);
        }
      } else {
        onChange([newPoint]);
      }
    },
    [disabled, maxPoints, multiple, points, onChange, mediaDimensions]
  );

  const handleRemovePoint = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      onChange(points.filter((_, i) => i !== index));
    },
    [disabled, points, onChange]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setHoverPosition({ x, y });
    },
    [disabled]
  );

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setHoverPosition(null);
  }, []);

  // Convert point coordinates back to percentage for display
  const getPointPosition = useCallback(
    (point: Point) => {
      if (mediaDimensions) {
        return {
          x: (point.x / mediaDimensions.width) * 100,
          y: (point.y / mediaDimensions.height) * 100,
        };
      }
      // Fallback: assume 1000x1000 if no dimensions
      return {
        x: (point.x / 1000) * 100,
        y: (point.y / 1000) * 100,
      };
    },
    [mediaDimensions]
  );

  const canAddMore = !maxPoints || points.length < maxPoints;

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-md border border-border bg-black ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair'
        }`}
        style={{ aspectRatio }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >
        {/* Media element - Image or Video Frame */}
        {mediaType === 'video' ? (
          <>
            {isExtractingFrame ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="size-8 animate-spin text-white/60" />
              </div>
            ) : frameDataUrl ? (
              <img
                src={frameDataUrl}
                alt={alt}
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-black text-white/60 text-sm">
                Loading frame...
              </div>
            )}
          </>
        ) : (
          <img
            src={mediaSrc}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={handleImageLoad}
            draggable={false}
            crossOrigin="anonymous"
          />
        )}

        {/* Video Frame Slider */}
        {mediaType === 'video' && (
          <div className="video-controls absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTimestamp}
                onChange={handleSeek}
                onClick={(e) => e.stopPropagation()}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/30 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <span className="min-w-[60px] text-right text-[10px] text-white/80">
                {formatTime(currentTimestamp)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Hover crosshair indicator */}
        {isHovering && hoverPosition && canAddMore && !disabled && (
          <div
            className="pointer-events-none absolute z-10"
            style={{
              left: `${hoverPosition.x}%`,
              top: `${hoverPosition.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="flex items-center justify-center">
              <Plus className="size-5 text-primary opacity-50" strokeWidth={2} />
            </div>
          </div>
        )}

        {/* Point markers */}
        {points.map((point, index) => {
          const pos = getPointPosition(point);
          return (
            <div
              key={index}
              className="absolute z-20 group"
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Point marker */}
              <div
                className="relative flex items-center justify-center rounded-full border-2 border-white shadow-lg transition-transform hover:scale-110"
                style={{
                  width: pointSize,
                  height: pointSize,
                  backgroundColor: pointColor,
                }}
              >
                {/* Point number */}
                {multiple && points.length > 1 && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
                    {index + 1}
                  </span>
                )}
              </div>

              {/* Remove button */}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => handleRemovePoint(index, e)}
                  className="absolute -right-2 -top-2 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground shadow-md group-hover:block"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Empty state hint */}
        {points.length === 0 && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
            <div className="flex items-center gap-1.5 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
              <MousePointer2 className="size-3.5" />
              <span>Click to place a point</span>
            </div>
          </div>
        )}
      </div>

      {/* Point count and coordinates display */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {points.length} point{points.length !== 1 ? 's' : ''} selected
          {maxPoints && ` (max ${maxPoints})`}
        </span>
        {points.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-destructive hover:underline disabled:opacity-50"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Helper function to convert Point array to the format expected by SAM-2:
 * "[x1,y1],[x2,y2],..."
 */
export function pointsToCoordinateString(points: Point[]): string {
  return points.map((p) => `[${p.x},${p.y}]`).join(',');
}

/**
 * Helper function to parse a coordinate string back to Point array.
 * Supports formats: "[x,y],[x,y]" or "x,y;x,y"
 */
export function parseCoordinateString(str: string): Point[] {
  if (!str.trim()) return [];

  const points: Point[] = [];

  // Try parsing bracket format: [x,y],[x,y]
  const bracketMatches = str.matchAll(/\[(\d+),\s*(\d+)\]/g);
  for (const match of bracketMatches) {
    points.push({
      x: parseInt(match[1], 10),
      y: parseInt(match[2], 10),
    });
  }

  if (points.length > 0) return points;

  // Fallback: try parsing simple format: x,y or x,y;x,y
  const parts = str.split(/[;\n]/);
  for (const part of parts) {
    const [xStr, yStr] = part.split(',').map((s) => s.trim());
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    if (!isNaN(x) && !isNaN(y)) {
      points.push({ x, y });
    }
  }

  return points;
}
