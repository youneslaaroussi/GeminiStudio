"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cookie-notice-dismissed";

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      setVisible(!dismissed);
    } catch {
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      setVisible(false);
    } catch {
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className={cn(
        "fixed bottom-4 left-4 z-50",
        "bg-black/40 backdrop-blur-md",
        "rounded-full",
        "px-4 py-2 flex items-center gap-3",
        "animate-in slide-in-from-bottom duration-300"
      )}
    >
      <p className="text-xs text-white/90 whitespace-nowrap">
        We use cookies for analytics.{" "}
        <Link
          href="/privacy"
          className="text-white underline underline-offset-2 hover:no-underline"
        >
          Privacy
        </Link>
        {" · "}
        <Link
          href="/tos"
          className="text-white underline underline-offset-2 hover:no-underline"
        >
          Terms
        </Link>
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDismiss}
        className="h-6 px-2 text-xs text-white/90 hover:bg-white/10 hover:text-white rounded-full"
      >
        Dismiss
      </Button>
    </div>
  );
}
