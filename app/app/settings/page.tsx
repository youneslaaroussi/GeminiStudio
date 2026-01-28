"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle, Copy, Check, Loader2, Unlink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/app/lib/hooks/useAuth";
import {
  getUserIntegrations,
  createTelegramLinkCode,
  unlinkTelegram,
  getPendingLinkCode,
  type UserIntegrations,
} from "@/app/lib/services/user-settings";
import { db } from "@/app/lib/server/firebase";
import { doc, onSnapshot } from "firebase/firestore";

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [integrations, setIntegrations] = useState<UserIntegrations>({});
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  const loadIntegrations = useCallback(async () => {
    if (!user) return;
    setLoadingIntegrations(true);
    try {
      const data = await getUserIntegrations(user.uid);
      setIntegrations(data);

      // Check for pending link code
      if (!data.telegram) {
        const pendingCode = await getPendingLinkCode(user.uid);
        setLinkCode(pendingCode);
      }
    } catch (error) {
      console.error("Failed to load integrations:", error);
    } finally {
      setLoadingIntegrations(false);
    }
  }, [user]);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  // Listen for changes to integrations (for when telegram gets linked via bot)
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid, "settings", "integrations"),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as UserIntegrations;
          setIntegrations(data);
          // Clear link code if telegram is now linked
          if (data.telegram) {
            setLinkCode(null);
          }
        }
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleGenerateCode = async () => {
    if (!user) return;
    setIsGeneratingCode(true);
    try {
      const code = await createTelegramLinkCode(user.uid, user.email || "");
      setLinkCode(code);
    } catch (error) {
      console.error("Failed to generate link code:", error);
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleUnlink = async () => {
    if (!user) return;
    setIsUnlinking(true);
    try {
      await unlinkTelegram(user.uid);
      setIntegrations({ ...integrations, telegram: undefined });
    } catch (error) {
      console.error("Failed to unlink Telegram:", error);
    } finally {
      setIsUnlinking(false);
    }
  };

  const handleCopyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  if (!user || loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#141417] text-white">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f12] text-foreground px-8 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-12">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="size-5 text-slate-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-sm text-slate-400">{user.email}</p>
          </div>
        </div>

        {/* Integrations Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Integrations</h2>

          {/* Telegram Integration */}
          <div className="border border-slate-700 rounded-lg bg-slate-900/50 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <MessageCircle className="size-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-white mb-1">Telegram</h3>
                <p className="text-sm text-slate-400 mb-4">
                  Connect your Telegram account to interact with your projects via the Gemini Studio bot.
                </p>

                {loadingIntegrations ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : integrations.telegram ? (
                  // Telegram is linked
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-400">
                      <Check className="size-4" />
                      <span className="text-sm font-medium">Connected</span>
                    </div>
                    {integrations.telegram.telegramUsername && (
                      <p className="text-sm text-slate-400">
                        Username: @{integrations.telegram.telegramUsername}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      Linked on {new Date(integrations.telegram.linkedAt).toLocaleDateString()}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnlink}
                      disabled={isUnlinking}
                      className="text-red-400 border-red-400/30 hover:bg-red-400/10 hover:text-red-300"
                    >
                      {isUnlinking ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : (
                        <Unlink className="size-4 mr-2" />
                      )}
                      Unlink Telegram
                    </Button>
                  </div>
                ) : linkCode ? (
                  // Link code generated, waiting for user to use it
                  <div className="space-y-3">
                    <p className="text-sm text-slate-300">
                      Send this code to the Gemini Studio Telegram bot:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="px-4 py-2 bg-slate-800 rounded-lg text-xl font-mono tracking-widest text-white">
                        {linkCode}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyCode}
                        className="text-slate-400 hover:text-white"
                      >
                        {copied ? (
                          <Check className="size-4" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">
                      Send <code className="text-slate-400">/link {linkCode}</code> to the bot. Code expires in 10 minutes.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateCode}
                      disabled={isGeneratingCode}
                      className="text-slate-400 hover:text-white"
                    >
                      <RefreshCw className={`size-4 mr-2 ${isGeneratingCode ? "animate-spin" : ""}`} />
                      Generate new code
                    </Button>
                  </div>
                ) : (
                  // Not linked, no code yet
                  <Button
                    onClick={handleGenerateCode}
                    disabled={isGeneratingCode}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isGeneratingCode ? (
                      <Loader2 className="size-4 animate-spin mr-2" />
                    ) : (
                      <MessageCircle className="size-4 mr-2" />
                    )}
                    Link Telegram Account
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
