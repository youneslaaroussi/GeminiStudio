"use client";

import { ReactNode, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardClassName } from "./utils";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Custom header content (replaces icon + title) */
  header?: ReactNode;
  /** Whether to wrap content in the card style */
  withCard?: boolean;
}

export function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = true,
  header,
  withCard = true,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors">
        {header ?? (
          <div className="flex items-center gap-2">
            {icon && (
              <span className="shrink-0 text-muted-foreground">{icon}</span>
            )}
            <span className="text-sm font-medium">{title}</span>
          </div>
        )}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {withCard ? (
          <div className={cn(cardClassName, "mt-2")}>{children}</div>
        ) : (
          <div className="mt-2">{children}</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
