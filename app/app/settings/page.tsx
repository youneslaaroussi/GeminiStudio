"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { updateProfile } from "firebase/auth";
import { ArrowLeft, MessageCircle, Copy, Check, Loader2, Unlink, RefreshCw, User, CreditCard, LogOut, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/app/lib/hooks/useAuth";
import {
  getUserIntegrations,
  createTelegramLinkCode,
  unlinkTelegram,
  getPendingLinkCode,
  type UserIntegrations,
} from "@/app/lib/services/user-settings";
import { subscribeToBilling, SUBSCRIPTION_TIERS, type BillingData } from "@/app/lib/services/billing";
import {
  listPacks,
  createCheckout,
  createPortalSession,
  type CreditPack,
  type PackId,
} from "@/app/lib/services/billing-api";
import { auth, db } from "@/app/lib/server/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { toast } from "sonner";

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, logout } = useAuth();
  const [integrations, setIntegrations] = useState<UserIntegrations>({});
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  // Profile
  const [profileName, setProfileName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  // Billing (from Firebase)
  const [billing, setBilling] = useState<BillingData>({ credits: 0 });
  const [fillUpOpen, setFillUpOpen] = useState(false);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<PackId | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      setProfileName(user.displayName || "");
    }
  }, [user?.uid, user?.displayName]);

  // Real-time credits from Firebase
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToBilling(user.uid, setBilling);
    return () => unsub();
  }, [user]);

  // Toast on return from Stripe checkout; open fill-up dialog when ?billing=fill
  useEffect(() => {
    const billing = searchParams.get("billing");
    if (billing === "success") {
      toast.success("Subscription set up. Your R-Credits have been added.");
      router.replace("/settings", { scroll: false });
    } else if (billing === "cancel") {
      toast.info("Checkout cancelled.");
      router.replace("/settings", { scroll: false });
    } else if (billing === "fill") {
      setFillUpOpen(true);
      router.replace("/settings", { scroll: false });
    }
  }, [searchParams, router]);

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

  const handleSaveName = async () => {
    if (!user || !auth.currentUser) return;
    const name = profileName.trim() || user.displayName || "";
    setIsSavingName(true);
    try {
      await updateProfile(auth.currentUser, { displayName: name });
      setProfileName(name);
    } catch (error) {
      console.error("Failed to update profile name:", error);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/auth/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const loadPacks = useCallback(async () => {
    setPacksLoading(true);
    setCheckoutError(null);
    try {
      const data = await listPacks();
      setPacks(data);
    } catch (e) {
      console.error("Failed to load packs:", e);
      setPacks([]);
    } finally {
      setPacksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fillUpOpen) loadPacks();
  }, [fillUpOpen, loadPacks]);

  const handleSubscribe = async (packId: PackId) => {
    setCheckoutError(null);
    setCheckoutLoading(packId);
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const { url } = await createCheckout({
        packId,
        successUrl: `${base}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/settings?billing=cancel`,
      });
      if (url) window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Checkout failed";
      setCheckoutError(msg);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const { url } = await createPortalSession();
      if (url) window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
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
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>

        {/* Profile Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Profile</h2>
          <div className="border border-slate-700 rounded-lg bg-slate-900/50 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-slate-700/50 rounded-lg">
                <User className="size-6 text-slate-400" />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Display name</label>
                  <div className="flex gap-2">
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Your name"
                      className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 max-w-xs"
                    />
                    <Button
                      onClick={handleSaveName}
                      disabled={isSavingName}
                      className="bg-slate-700 hover:bg-slate-600 text-white"
                    >
                      {isSavingName ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
                  <p className="text-sm text-slate-400">{user.email}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  className="text-red-400 border-red-400/30 hover:bg-red-400/10 hover:text-red-300"
                >
                  <LogOut className="size-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Billing Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Billing</h2>
          <div className="border border-slate-700 rounded-lg bg-slate-900/50 p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/10 rounded-lg">
                <CreditCard className="size-6 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-white mb-1">R-Credits & subscription</h3>
                <p className="text-sm text-slate-400 mb-4">
                  Your balance and plan. Use R-Credits for renders and other usage. Subscriptions renew monthly with credits added each cycle.
                </p>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="text-2xl font-bold text-white">{billing.credits}</span>
                  <span className="text-slate-400">R-Credits</span>
                  {billing.tier && (
                    <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-xs font-medium">
                      {SUBSCRIPTION_TIERS[billing.tier].name}
                    </span>
                  )}
                </div>
                {billing.tier && billing.currentPeriodEnd && (
                  <p className="text-sm text-slate-400 mb-3">
                    {billing.cancelAtPeriodEnd ? (
                      <>
                        <span className="text-amber-400/90 font-medium">Cancelled</span>
                        {" — "}
                        R-Credits and access until{" "}
                        {new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </>
                    ) : (
                      <>
                        {SUBSCRIPTION_TIERS[billing.tier].creditsPerMonth} credits/month · Renews{" "}
                        {new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setFillUpOpen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {billing.customerId ? "Change plan" : "Subscribe"}
                  </Button>
                  {billing.customerId && (
                    <Button
                      variant="outline"
                      onClick={handleManageSubscription}
                      disabled={portalLoading}
                      className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                    >
                      {portalLoading ? <Loader2 className="size-4 animate-spin" /> : "Manage subscription"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

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

        {/* Subscribe / change plan dialog */}
        <Dialog open={fillUpOpen} onOpenChange={(open) => { setFillUpOpen(open); setCheckoutError(null); }}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{billing.customerId ? "Change plan" : "Subscribe"}</DialogTitle>
              <DialogDescription className="text-slate-400">
                Choose a plan. You get R-Credits every month; unused credits roll over until the next cycle.
              </DialogDescription>
            </DialogHeader>
            {checkoutError && (
              <p className="text-sm text-red-400 bg-red-400/10 rounded-lg p-2">{checkoutError}</p>
            )}
            {packsLoading ? (
              <div className="flex items-center gap-2 text-slate-400 py-4">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">Loading plans…</span>
              </div>
            ) : packs.length === 0 ? (
              <div className="flex gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-4 py-5">
                <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-200">Plans unavailable</p>
                  <p className="text-sm text-red-300/90 mt-1">
                    Plans are not available at the moment. Please try again later.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 py-2">
                {packs.map((pack) => {
                  const loading = checkoutLoading === pack.id;
                  const isCurrentPlan = billing.tier === pack.id;
                  return (
                    <div
                      key={pack.id}
                      className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 p-4"
                    >
                      <div>
                        <p className="font-medium text-white">{pack.name}</p>
                        <p className="text-sm text-slate-400">
                          {pack.credits} R-Credits/month · ${pack.amountUsd.toFixed(2)}/{pack.currency}
                        </p>
                      </div>
                      <Button
                        onClick={() => handleSubscribe(pack.id)}
                        disabled={!!checkoutLoading || isCurrentPlan}
                        className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 disabled:opacity-60"
                      >
                        {loading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : isCurrentPlan ? (
                          "Current plan"
                        ) : billing.customerId ? (
                          "Switch"
                        ) : (
                          "Subscribe"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#141417] text-white">
          Loading...
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
