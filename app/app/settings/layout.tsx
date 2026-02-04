"use client";

import { Suspense } from "react";
import { useRouter, usePathname } from "next/navigation";
import { User, CreditCard, Plug, ChevronRight } from "lucide-react";
import { AppShell } from "@/app/components/layout";
import { cn } from "@/lib/utils";

type SettingsSection = "profile" | "billing" | "integrations";

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ElementType; href: string }[] = [
  { id: "profile", label: "Profile", icon: User, href: "/settings/profile" },
  { id: "billing", label: "Billing", icon: CreditCard, href: "/settings/billing" },
  { id: "integrations", label: "Integrations", icon: Plug, href: "/settings/integrations" },
];

function SettingsLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Determine active section from pathname
  const getActiveSection = (): SettingsSection => {
    if (pathname.includes("/billing")) return "billing";
    if (pathname.includes("/integrations")) return "integrations";
    return "profile";
  };

  const activeSection = getActiveSection();

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-3.5rem)]">
      {/* Sidebar: horizontal nav on mobile, vertical on desktop */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/50 p-4 shrink-0">
        <div className="mb-4 md:mb-6">
          <h1 className="text-lg font-semibold text-white px-0 md:px-3">Settings</h1>
        </div>
        <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => router.push(item.href)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 md:w-full",
                activeSection === item.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
              {activeSection === item.id && (
                <ChevronRight className="size-4 ml-auto text-slate-500 hidden md:block" />
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-auto min-w-0">
        <div className="max-w-2xl w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#0f0f12] text-white">
          <div className="flex items-center gap-3">
            <div className="size-8 border-2 border-slate-600 border-t-white rounded-full animate-spin" />
            <span className="text-slate-400">Loading...</span>
          </div>
        </div>
      }
    >
      <AppShell>
        <SettingsLayoutContent>{children}</SettingsLayoutContent>
      </AppShell>
    </Suspense>
  );
}
