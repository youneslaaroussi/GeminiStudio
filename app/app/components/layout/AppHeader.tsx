"use client";

import { useRouter, usePathname } from "next/navigation";
import { Settings, LogOut, CreditCard, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { User } from "firebase/auth";

interface AppHeaderProps {
  user: User;
  onLogout: () => void;
}

export function AppHeader({ user, onLogout }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const navItems = [
    { label: "Projects", href: "/app", icon: FolderOpen },
  ];

  const getInitials = (email: string | null, name: string | null) => {
    if (name) {
      return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "U";
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800 bg-[#0f0f12]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0f0f12]/80">
      <div className="flex h-14 items-center px-6">
        {/* Logo and Brand: on projects page go to landing; on settings (and elsewhere) go to projects */}
        <div
          className="flex items-center gap-3 cursor-pointer mr-8"
          onClick={() => router.push(pathname === "/app" ? "/" : "/app")}
        >
          <img src="/gemini-logo.png" alt="Gemini" className="size-8" />
          <span className="font-semibold text-white text-lg hidden sm:inline-block">
            Gemini Studio
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Button
                key={item.href}
                variant="ghost"
                size="sm"
                onClick={() => router.push(item.href)}
                className={cn(
                  "gap-2 text-sm font-medium transition-colors",
                  isActive 
                    ? "text-white bg-slate-800" 
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Button>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="relative h-9 w-9 rounded-full hover:bg-slate-800"
            >
              <Avatar className="size-8">
                {user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName || ""} />}
                <AvatarFallback className="bg-slate-700 text-slate-200 text-xs">
                  {getInitials(user.email, user.displayName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-slate-900 border-slate-700" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                {user.displayName && (
                  <p className="text-sm font-medium text-white">{user.displayName}</p>
                )}
                <p className="text-xs text-slate-400 truncate">
                  {user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-700" />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => router.push("/settings/profile")}
                className="cursor-pointer text-slate-300 focus:text-white focus:bg-slate-800"
              >
                <Settings className="mr-2 size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push("/settings/billing")}
                className="cursor-pointer text-slate-300 focus:text-white focus:bg-slate-800"
              >
                <CreditCard className="mr-2 size-4" />
                Billing
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-slate-700" />
            <DropdownMenuItem 
              onClick={onLogout}
              variant="destructive"
              className="cursor-pointer"
            >
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
