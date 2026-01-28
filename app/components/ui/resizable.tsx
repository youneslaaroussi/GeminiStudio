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
  handleClassName,
  handleIconClassName,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
  handleClassName?: string;
  handleIconClassName?: string;
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "bg-border relative flex shrink-0 items-center justify-center focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 after:pointer-events-none after:absolute after:bg-border after:content-[''] data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-px data-[orientation=horizontal]:after:inset-y-0 data-[orientation=horizontal]:after:left-1/2 data-[orientation=horizontal]:after:w-1 data-[orientation=horizontal]:after:-translate-x-1/2 data-[orientation=vertical]:w-full data-[orientation=vertical]:py-1.5 data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:top-1/2 data-[orientation=vertical]:after:h-px data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2",
        className
      )}
      {...props}
    >
      {withHandle && (
        <span
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-4 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xs border bg-border",
            handleClassName
          )}
        >
          <GripVerticalIcon
            className={cn("size-2.5", handleIconClassName)}
          />
        </span>
      )}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
