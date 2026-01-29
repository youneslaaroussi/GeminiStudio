"use client";

import React, { useCallback, useRef, useState } from "react";
import { Video, Music, Type, Image as ImageIcon, Trash2, GripVertical } from "lucide-react";
import type { Layer } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";
import { TransitionHandle } from "./TransitionHandle";
import { cn } from "@/lib/utils";
import { assetMatchesLayer, createClipFromAsset, hasAssetDragData, readDraggedAsset } from "@/app/lib/assets/drag";
import { makeTransitionKey } from "@/app/types/timeline";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface LayerTrackProps {
  layer: Layer;
  layerIndex: number;
  width: number;
  labelWidth: number;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, position: "above" | "below") => void;
  onDrop: (targetIndex: number, position: "above" | "below") => void;
  onDragEnd: () => void;
  isDragTarget: boolean;
  dropPosition: "above" | "below" | null;
}

const typeIcon: Record<Layer["type"], React.JSX.Element> = {
  video: <Video className="size-3.5 text-blue-400" />,
  audio: <Music className="size-3.5 text-green-400" />,
  text: <Type className="size-3.5 text-purple-400" />,
  image: <ImageIcon className="size-3.5 text-orange-400" />,
};

/** Fixed left column: layer label only (for two-column timeline layout) */
export interface LayerTrackLabelProps {
  layer: Layer;
  layerIndex: number;
  labelWidth: number;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, position: "above" | "below") => void;
  onDrop: (targetIndex: number, position: "above" | "below") => void;
  onDragEnd: () => void;
  isDragTarget: boolean;
  dropPosition: "above" | "below" | null;
}

export function LayerTrackLabel({
  layer,
  layerIndex,
  labelWidth,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragTarget,
  dropPosition,
}: LayerTrackLabelProps) {
  const deleteLayer = useProjectStore((s) => s.deleteLayer);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleOpenDeleteDialog = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      setShowDeleteDialog(true);
    },
    []
  );

  const handleConfirmDelete = useCallback(() => {
    deleteLayer(layer.id);
    setShowDeleteDialog(false);
  }, [deleteLayer, layer.id]);

  const handleLayerDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `layer:${layerIndex}`);
      onDragStart(layerIndex);
    },
    [layerIndex, onDragStart]
  );

  const handleLayerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer.types.includes("text/plain");
      if (!data) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position = y < rect.height / 2 ? "above" : "below";
      onDragOver(layerIndex, position);
    },
    [layerIndex, onDragOver]
  );

  const handleLayerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer.getData("text/plain");
      if (!data?.startsWith("layer:")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position = y < rect.height / 2 ? "above" : "below";
      onDrop(layerIndex, position);
    },
    [layerIndex, onDrop]
  );

  return (
    <>
      <div
        className="relative flex items-stretch border-b border-border transition-colors"
        data-layer-id={layer.id}
        onDragOver={handleLayerDragOver}
        onDrop={handleLayerDrop}
        onDragEnd={onDragEnd}
      >
        {isDragTarget && dropPosition === "above" && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        {isDragTarget && dropPosition === "below" && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        <div
          className="flex shrink-0 items-center justify-between gap-1 bg-muted/30 px-2 py-2"
          style={{ width: labelWidth }}
        >
          <div className="flex items-center gap-1.5">
            <div
              draggable
              onDragStart={handleLayerDragStart}
              onDragEnd={onDragEnd}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Drag to reorder"
            >
              <GripVertical className="size-3.5" />
            </div>
            {typeIcon[layer.type]}
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground">{layer.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{layer.type}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenDeleteDialog}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            title="Delete layer"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete layer?</DialogTitle>
            <DialogDescription>
              {layer.clips.length > 0 ? (
                <>
                  This will delete <strong>{layer.name}</strong> and remove its {layer.clips.length} clip
                  {layer.clips.length === 1 ? "" : "s"}.
                </>
              ) : (
                <>This will delete <strong>{layer.name}</strong>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Scrollable right column: track content only (for two-column timeline layout) */
export interface LayerTrackBodyProps {
  layer: Layer;
  trackWidth: number;
}

export function LayerTrackBody({ layer, trackWidth }: LayerTrackBodyProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const project = useProjectStore((s) => s.project);
  const selectedTransitionKey = useProjectStore((s) => s.selectedTransitionKey);
  const setSelectedTransition = useProjectStore((s) => s.setSelectedTransition);
  const addClip = useProjectStore((s) => s.addClip);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      const asset = readDraggedAsset(event);
      if (!asset || !assetMatchesLayer(asset.type, layer.type)) return;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const start = Math.max(0, x / zoom);
      const clip = createClipFromAsset(asset, start);
      addClip(clip, layer.id);
    },
    [addClip, layer.id, layer.type, zoom]
  );

  const sortedClips = [...layer.clips].sort((a, b) => a.start - b.start);

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-12 border-b border-border bg-muted/10 transition-colors",
        isDragOver && "bg-muted/20 ring-2 ring-primary/40 ring-inset"
      )}
      style={{ width: trackWidth }}
      data-layer-id={layer.id}
      data-layer-type={layer.type}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {sortedClips.map((clip, index) => {
        const nextClip = sortedClips[index + 1];
        const isAdjacent =
          nextClip &&
          Math.abs(nextClip.start - (clip.start + clip.duration / clip.speed)) < 0.1;
        return (
          <div key={clip.id}>
            <Clip clip={clip} layerId={layer.id} />
            {isAdjacent && (
              <TransitionHandle
                prevClip={clip}
                nextClip={nextClip}
                zoom={zoom}
                transition={project.transitions?.[makeTransitionKey(clip.id, nextClip.id)]}
                selected={selectedTransitionKey === makeTransitionKey(clip.id, nextClip.id)}
                onSelect={() => setSelectedTransition(makeTransitionKey(clip.id, nextClip.id))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LayerTrack({ layer, layerIndex, width, labelWidth, onDragStart, onDragOver, onDrop, onDragEnd, isDragTarget, dropPosition }: LayerTrackProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const project = useProjectStore((s) => s.project);
  const selectedTransitionKey = useProjectStore((s) => s.selectedTransitionKey);
  const setSelectedTransition = useProjectStore((s) => s.setSelectedTransition);
  const duration = useProjectStore((s) => s.getDuration());
  const addClip = useProjectStore((s) => s.addClip);
  const deleteLayer = useProjectStore((s) => s.deleteLayer);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleOpenDeleteDialog = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      setShowDeleteDialog(true);
    },
    []
  );

  const handleConfirmDelete = useCallback(() => {
    deleteLayer(layer.id);
    setShowDeleteDialog(false);
  }, [deleteLayer, layer.id]);

  const handleLayerDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `layer:${layerIndex}`);
      onDragStart(layerIndex);
    },
    [layerIndex, onDragStart]
  );

  const handleLayerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer.types.includes("text/plain");
      if (!data) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position = y < rect.height / 2 ? "above" : "below";
      onDragOver(layerIndex, position);
    },
    [layerIndex, onDragOver]
  );

  const handleLayerDragEnd = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  const handleLayerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const data = event.dataTransfer.getData("text/plain");
      if (!data?.startsWith("layer:")) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position = y < rect.height / 2 ? "above" : "below";
      onDrop(layerIndex, position);
    },
    [layerIndex, onDrop]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragOver) {
        setIsDragOver(true);
      }
    },
    [isDragOver]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      const asset = readDraggedAsset(event);
      if (!asset || !assetMatchesLayer(asset.type, layer.type)) {
        return;
      }
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const start = Math.max(0, x / zoom);
      const clip = createClipFromAsset(asset, start);
      addClip(clip, layer.id);
    },
    [addClip, layer.id, layer.type, zoom]
  );

  const sortedClips = [...layer.clips].sort((a, b) => a.start - b.start);

  return (
    <>
      <div
        className="relative flex items-stretch border-b border-border transition-colors"
        data-layer-id={layer.id}
        data-layer-type={layer.type}
        onDragOver={handleLayerDragOver}
        onDrop={handleLayerDrop}
        onDragEnd={handleLayerDragEnd}
      >
        {isDragTarget && dropPosition === "above" && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        {isDragTarget && dropPosition === "below" && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10" />
        )}
        <div
          className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1 border-r border-border bg-muted/30 px-2 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
          style={{ width: labelWidth }}
        >
          <div className="flex items-center gap-1.5">
            <div
              draggable
              onDragStart={handleLayerDragStart}
              onDragEnd={handleLayerDragEnd}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Drag to reorder"
            >
              <GripVertical className="size-3.5" />
            </div>
            {typeIcon[layer.type]}
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground">
                {layer.name}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {layer.type}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenDeleteDialog}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            title="Delete layer"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      <div
        ref={trackRef}
        className={cn(
          "relative h-12 bg-muted/10 transition-colors",
          isDragOver && "bg-muted/20 ring-2 ring-primary/40 ring-inset"
        )}
        style={{ width: Math.max(width - labelWidth, duration * zoom) }}
        data-layer-id={layer.id}
        data-layer-type={layer.type}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {sortedClips.map((clip, index) => {
          const nextClip = sortedClips[index + 1];
          const isAdjacent = nextClip && 
            Math.abs(nextClip.start - (clip.start + clip.duration / clip.speed)) < 0.1;
          
          return (
            <div key={clip.id}>
              <Clip clip={clip} layerId={layer.id} />
              {isAdjacent && (
                <TransitionHandle
                  prevClip={clip}
                  nextClip={nextClip}
                  zoom={zoom}
                  transition={project.transitions?.[makeTransitionKey(clip.id, nextClip.id)]}
                  selected={selectedTransitionKey === makeTransitionKey(clip.id, nextClip.id)}
                  onSelect={() => setSelectedTransition(makeTransitionKey(clip.id, nextClip.id))}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete layer?</DialogTitle>
            <DialogDescription>
              {layer.clips.length > 0 ? (
                <>
                  This will delete <strong>{layer.name}</strong> and remove its{" "}
                  {layer.clips.length} clip{layer.clips.length === 1 ? "" : "s"}.
                </>
              ) : (
                <>
                  This will delete <strong>{layer.name}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
