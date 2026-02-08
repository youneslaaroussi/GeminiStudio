"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { AppHeader } from "./AppHeader";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/auth/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (!isClient || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f12] text-white">
        <div className="flex items-center gap-3">
          <div className="size-8 border-2 border-slate-600 border-t-white rounded-full animate-spin" />
          <span className="text-slate-400">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0f0f12] text-foreground flex flex-col pb-12">
      <AppHeader user={user} onLogout={handleLogout} />
      <main className="flex-1">{children}</main>
      <footer className="shrink-0 py-3 px-4 border-t border-slate-800">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-xs text-slate-500">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          <span>Your data is private and secure.</span>
          <a href="/privacy" className="hover:text-slate-300 transition-colors underline underline-offset-2">Privacy</a>
        </p>
      </footer>
    </div>
  );
}
