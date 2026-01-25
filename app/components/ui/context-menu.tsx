"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = ({
  className,
  ...props
}: ContextMenuPrimitive.ContextMenuContentProps) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      className={cn(
        "z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
);

const ContextMenuSeparator = ({
  className,
  ...props
}: ContextMenuPrimitive.ContextMenuSeparatorProps) => (
  <ContextMenuPrimitive.Separator
    className={cn("-mx-1 my-1 border-t border-border", className)}
    {...props}
  />
);

const ContextMenuItem = ({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.ContextMenuItemProps & { inset?: boolean }) => (
  <ContextMenuPrimitive.Item
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
);

const ContextMenuLabel = ({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.ContextMenuLabelProps & { inset?: boolean }) => (
  <ContextMenuPrimitive.Label
    className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", inset && "pl-8", className)}
    {...props}
  />
);

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuItem,
  ContextMenuLabel,
};
