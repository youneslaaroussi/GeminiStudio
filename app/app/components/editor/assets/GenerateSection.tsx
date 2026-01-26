"use client";

import { Video, ImageIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GenerateSectionProps {
  onOpenVeo: () => void;
  onOpenBanana: () => void;
}

export function GenerateSection({ onOpenVeo, onOpenBanana }: GenerateSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        <span>AI Generate</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-2 flex-col gap-1"
          onClick={onOpenVeo}
        >
          <Video className="size-4" />
          <span className="text-xs">Veo 3 Video</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-2 flex-col gap-1"
          onClick={onOpenBanana}
        >
          <ImageIcon className="size-4" />
          <span className="text-xs">Banana Image</span>
        </Button>
      </div>
    </div>
  );
}
