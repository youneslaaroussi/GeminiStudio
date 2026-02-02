"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, memo } from "react";
import { Loader2, Image, Video, Music, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MentionListProps, MentionListRef, MentionSuggestionItem } from "./types";
import type { AssetType } from "@/app/types/assets";

function getAssetIcon(type: AssetType) {
  switch (type) {
    case "image":
      return Image;
    case "video":
      return Video;
    case "audio":
      return Music;
    default:
      return FileText;
  }
}

/** Thumbnail matching console Assets tab AssetRow - images use url, videos use video element */
const MentionThumbnail = memo(function MentionThumbnail({
  type,
  url,
  thumbnailUrl,
}: {
  type: AssetType;
  url?: string;
  thumbnailUrl?: string;
}) {
  const [showFallback, setShowFallback] = useState(false);
  const Icon = getAssetIcon(type);

  if (!url && !thumbnailUrl) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted overflow-hidden">
        <Icon className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (type === "image") {
    return (
      <div className="size-8 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
        {showFallback ? (
          <Icon className="size-4 text-muted-foreground" />
        ) : (
          <img
            src={thumbnailUrl || url}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setShowFallback(true)}
          />
        )}
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="size-8 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
        {showFallback ? (
          <Icon className="size-4 text-muted-foreground" />
        ) : (
          <video
            src={url}
            className="size-full object-cover"
            muted
            preload="metadata"
            onError={() => setShowFallback(true)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted overflow-hidden">
      <Icon className="size-4 text-muted-foreground" />
    </div>
  );
});

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, isLoading, selectedIndex, onSelect }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Scroll selected item into view
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const selectedItem = container.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        // Keyboard handling is done in the parent suggestion config
        return false;
      },
    }));

    if (isLoading) {
      return (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="p-3 text-sm text-muted-foreground text-center">
          No assets found
        </div>
      );
    }

    return (
      <div ref={containerRef} className="max-h-48 overflow-y-auto">
        {items.map((item, index) => (
            <button
              key={item.id}
              data-index={index}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                "hover:bg-muted/50",
                index === selectedIndex && "bg-accent text-accent-foreground"
              )}
            >
              <MentionThumbnail
                type={item.type}
                url={item.url}
                thumbnailUrl={item.thumbnailUrl}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{item.name}</div>
                {item.description && (
                  <div className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground capitalize">
                {item.type}
              </span>
            </button>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
