"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { FaApple, FaWindows, FaSlack, FaGithub, FaFigma } from "react-icons/fa";
import { SiDiscord, SiNotion, SiLinear } from "react-icons/si";
import { BsMicrosoftTeams } from "react-icons/bs";

/** Vidova ATF (above-the-fold) hero demo video embed ID from vidova/new-site hero */
const VIDOVA_ATF_EMBED_ID = "0b9c9b43-bafb-4327-b928-698ca6e7772b";

const VIDOVA_BASE_URL =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_VIDOVA_URL
    ? process.env.NEXT_PUBLIC_VIDOVA_URL.replace(/\/$/, "")
    : "https://vidova.com";

function embedUrl(id: string, options?: { muted?: boolean; autoplay?: boolean; loop?: boolean; controls?: boolean }) {
  const params = new URLSearchParams();
  if (options?.muted !== false) params.set("muted", "1");
  if (options?.autoplay) params.set("autoplay", "1");
  if (options?.loop) params.set("loop", "1");
  if (options?.controls !== false) params.set("controls", "1");
  return `${VIDOVA_BASE_URL}/embed/${id}?${params.toString()}`;
}

const PLATFORMS = [
  { name: "Slack", Icon: FaSlack },
  { name: "Discord", Icon: SiDiscord },
  { name: "Teams", Icon: BsMicrosoftTeams },
  { name: "Notion", Icon: SiNotion },
  { name: "GitHub", Icon: FaGithub },
  { name: "Linear", Icon: SiLinear },
  { name: "Figma", Icon: FaFigma },
];

interface VidovaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VidovaModal({ open, onOpenChange }: VidovaModalProps) {
  const demoEmbedUrl = embedUrl(VIDOVA_ATF_EMBED_ID, {
    muted: true,
    autoplay: true,
    loop: true,
    controls: true,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] gap-0 p-0 overflow-hidden">
        {/* Header with gradient accent */}
        <div className="relative px-6 pt-6 pr-12 pb-4 bg-gradient-to-br from-rose-500/10 via-violet-500/10 to-blue-500/10 border-b border-border">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                Screen & camera recorder
              </span>
            </div>
            <DialogTitle className="text-xl">Record with Vidova</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground max-w-xl">
              Record your screen and camera in 4K, add webcam, trim, and share. Use Vidova to capture clips and bring
              them straight into your project.
            </DialogDescription>
          </DialogHeader>
          {/* Platforms: macOS / Windows */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Available on</span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-sm font-medium">
                <FaApple className="size-4" />
                macOS
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-2.5 py-1.5 text-sm font-medium">
                <FaWindows className="size-4" />
                Windows
              </span>
            </div>
          </div>
        </div>

        {/* Video with glow */}
        <div className="relative px-6 py-6">
          <div className="absolute -inset-4 bg-gradient-to-br from-rose-500/15 via-violet-500/15 to-blue-500/15 blur-2xl rounded-2xl opacity-70 pointer-events-none" />
          <div className="relative rounded-xl overflow-hidden border border-border/80 shadow-xl bg-zinc-900/50 ring-1 ring-white/5">
            <div className="aspect-video w-full">
              <iframe
                src={demoEmbedUrl}
                title="Vidova demo"
                className="w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        {/* Works with */}
        <div className="px-6 pb-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Works with</p>
          <div className="flex flex-wrap items-center gap-5 text-muted-foreground">
            {PLATFORMS.map(({ name, Icon }) => (
              <span key={name} title={name} className="transition-colors hover:text-foreground">
                <Icon className="size-5" />
              </span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 pt-2 flex flex-col gap-3 border-t border-border">
          <Button asChild size="lg" className="w-full text-base font-semibold h-11">
            <a href={VIDOVA_BASE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 mr-2" />
              Open Vidova
            </a>
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Opens in a new tab. Record your video, then upload the file here or drag it into Assets.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
