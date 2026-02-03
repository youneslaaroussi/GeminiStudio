"use client";

import { Sparkles, PenTool, Tv, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type EditorLayoutPreset = "agentic" | "manual" | "review" | "timeline";

export interface LayoutConfig {
  // Horizontal split: main content vs right panel
  mainPanelSize: number;
  rightPanelSize: number;
  // Top row (Assets | Preview | Settings)
  assetsPanelSize: number;
  previewPanelSize: number;
  settingsPanelSize: number;
  // Vertical split: top area vs timeline
  topAreaSize: number;
  timelineSize: number;
  // Panel visibility
  showRightPanel: boolean;
  // Default right panel tab
  defaultRightTab?: "toolbox" | "effects" | "chat";
}

export const LAYOUT_PRESETS: Record<EditorLayoutPreset, LayoutConfig> = {
  agentic: {
    mainPanelSize: 70,
    rightPanelSize: 22,
    assetsPanelSize: 36,
    previewPanelSize: 49,
    settingsPanelSize: 15,
    topAreaSize: 65,
    timelineSize: 35,
    showRightPanel: true,
    defaultRightTab: "chat",
  },
  manual: {
    mainPanelSize: 82,
    rightPanelSize: 15,
    assetsPanelSize: 40,
    previewPanelSize: 38,
    settingsPanelSize: 22,
    topAreaSize: 55,
    timelineSize: 45,
    showRightPanel: true,
    defaultRightTab: "toolbox",
  },
  review: {
    mainPanelSize: 100,
    rightPanelSize: 0,
    assetsPanelSize: 34,
    previewPanelSize: 51,
    settingsPanelSize: 15,
    topAreaSize: 75,
    timelineSize: 25,
    showRightPanel: false,
  },
  timeline: {
    mainPanelSize: 85,
    rightPanelSize: 12,
    assetsPanelSize: 38,
    previewPanelSize: 42,
    settingsPanelSize: 20,
    topAreaSize: 45,
    timelineSize: 55,
    showRightPanel: true,
    defaultRightTab: "toolbox",
  },
};

const LAYOUT_INFO: Record<EditorLayoutPreset, { label: string; description: string; icon: typeof Sparkles }> = {
  agentic: {
    label: "Agentic",
    description: "AI-first with expanded chat panel",
    icon: Sparkles,
  },
  manual: {
    label: "Manual",
    description: "Balanced for hands-on editing",
    icon: PenTool,
  },
  review: {
    label: "Review",
    description: "Large preview, no side panel",
    icon: Tv,
  },
  timeline: {
    label: "Timeline",
    description: "Expanded timeline for clip work",
    icon: Layers,
  },
};

interface LayoutSelectorProps {
  currentLayout: EditorLayoutPreset;
  onLayoutChange: (layout: EditorLayoutPreset) => void;
}

const PRESET_ORDER: EditorLayoutPreset[] = ["agentic", "manual", "review", "timeline"];

export function LayoutSelector({ currentLayout, onLayoutChange }: LayoutSelectorProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
        role="tablist"
        aria-label="Workspace layout"
      >
        {PRESET_ORDER.map((preset) => {
          const { label, description, icon: Icon } = LAYOUT_INFO[preset];
          const isActive = currentLayout === preset;
          return (
            <Tooltip key={preset}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={label}
                  onClick={() => onLayoutChange(preset)}
                  className={cn(
                    "rounded-[5px] p-1.5 transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[200px]">
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
