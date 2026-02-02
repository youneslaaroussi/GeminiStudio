"use client";

import { useCallback } from "react";
import { Type, LayoutTemplate } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TEXT_TEMPLATE_PRESETS,
  type TextTemplateType,
} from "@/app/types/timeline";
import {
  TEMPLATE_DRAG_DATA_MIME,
  DEFAULT_TEMPLATE_DURATION,
  type TemplateDragPayload,
} from "@/app/types/templates";

interface TemplatesPanelProps {
  projectId: string | null;
}

export function TemplatesPanel({ projectId }: TemplatesPanelProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LayoutTemplate className="size-4" />
          Text Templates
        </div>
        <p className="text-xs text-muted-foreground">
          Drag templates to the timeline
        </p>

        <div className="grid grid-cols-2 gap-3">
          {TEXT_TEMPLATE_PRESETS.map((preset) => (
            <TemplateCard
              key={preset.id}
              templateType={preset.id}
              name={preset.name}
              description={preset.description}
            />
          ))}
        </div>

        {!projectId && (
          <p className="text-[11px] text-muted-foreground text-center">
            Save your project first to add templates.
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

interface TemplateCardProps {
  templateType: TextTemplateType;
  name: string;
  description: string;
}

function TemplateCard({ templateType, name, description }: TemplateCardProps) {
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const payload: TemplateDragPayload = {
        templateType,
        name,
        duration: DEFAULT_TEMPLATE_DURATION,
      };
      event.dataTransfer.setData(
        TEMPLATE_DRAG_DATA_MIME,
        JSON.stringify(payload)
      );
      event.dataTransfer.effectAllowed = "copy";
    },
    [templateType, name]
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group cursor-grab active:cursor-grabbing rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-muted/30 transition-all overflow-hidden"
    >
      {/* Preview */}
      <div className="aspect-video bg-zinc-950 relative overflow-hidden flex items-center justify-center">
        <TemplatePreview templateType={templateType} />
      </div>

      {/* Info */}
      <div className="p-2 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <Type className="size-3 text-muted-foreground" />
          <span className="text-xs font-medium">{name}</span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-1">
          {description}
        </p>
      </div>
    </div>
  );
}

interface TemplatePreviewProps {
  templateType: TextTemplateType;
}

function TemplatePreview({ templateType }: TemplatePreviewProps) {
  switch (templateType) {
    case "text":
      return <TextPreview />;
    case "title-card":
      return <TitleCardPreview />;
    case "lower-third":
      return <LowerThirdPreview />;
    case "caption-style":
      return <CaptionStylePreview />;
    default:
      return <TextPreview />;
  }
}

function TextPreview() {
  return (
    <span className="text-zinc-400 text-[11px] font-medium tracking-wide">
      Your text here
    </span>
  );
}

function TitleCardPreview() {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="text-zinc-100 text-[11px] font-semibold tracking-tight">
        Title
      </span>
      <span className="w-5 h-px bg-zinc-600 shrink-0" aria-hidden />
      <span className="text-zinc-500 text-[9px]">Subtitle</span>
    </div>
  );
}

function LowerThirdPreview() {
  return (
    <div className="absolute inset-x-0 bottom-0 h-5 bg-zinc-800/90 flex flex-col justify-center px-2">
      <span className="text-zinc-100 text-[9px] font-medium leading-tight truncate">
        Name
      </span>
      <span className="text-zinc-500 text-[7px] leading-tight truncate">
        Title
      </span>
    </div>
  );
}

function CaptionStylePreview() {
  return (
    <div className="absolute inset-x-0 bottom-2 flex justify-center">
      <span className="bg-zinc-800/90 text-zinc-300 text-[8px] px-2 py-1 rounded-sm">
        Caption text
      </span>
    </div>
  );
}
