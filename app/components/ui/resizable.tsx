"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

type PanelGroupProps = React.ComponentProps<typeof Group> & {
  direction?: "horizontal" | "vertical";
};

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  ...props
}: PanelGroupProps) {
  return (
    <Group
      data-slot="resizable-panel-group"
      data-orientation={direction}
      orientation={direction}
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

type PanelProps = React.ComponentProps<typeof Panel> & {
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
};

function ResizablePanel({
  defaultSize,
  minSize,
  maxSize,
  ...props
}: PanelProps) {
  // react-resizable-panels v4: numbers = px, strings like "18" = 18%
  const toSize = (v: number | string | undefined) =>
    v === undefined ? undefined : typeof v === "number" && v <= 100 ? String(v) : v;

  return (
    <Panel
      data-slot="resizable-panel"
      defaultSize={toSize(defaultSize) ?? defaultSize}
      minSize={toSize(minSize) ?? minSize}
      maxSize={toSize(maxSize) ?? maxSize}
      {...props}
    />
  );
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:-translate-y-1/2 [&[data-orientation=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
