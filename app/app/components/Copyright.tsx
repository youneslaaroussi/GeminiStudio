import { cn } from "@/lib/utils";

interface CopyrightProps {
  className?: string;
}

const currentYear = new Date().getFullYear();

export function Copyright({ className }: CopyrightProps) {
  return (
    <footer
      role="contentinfo"
      className={cn(
        "fixed bottom-0 left-0 right-0 py-2 text-center text-xs text-muted-foreground pointer-events-none z-10",
        className
      )}
    >
      © {currentYear} Gemini Studio. All rights reserved.
    </footer>
  );
}
