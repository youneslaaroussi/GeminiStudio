"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { updateProfile } from "firebase/auth";
import {
  MessageCircle,
  Copy,
  Check,
  Loader2,
  Unlink,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
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
import {
  subscribeToBilling,
  SUBSCRIPTION_TIERS,
  type BillingData,
} from "@/app/lib/services/billing";
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
import { cn } from "@/lib/utils";

type SettingsSection = "profile" | "billing" | "integrations";

function ProfileSection() {
  const { user } = useAuth();
  const [profileName, setProfileName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileName(user.displayName || "");
    }
  }, [user?.uid, user?.displayName]);

  const handleSaveName = async () => {
    if (!user || !auth.currentUser) return;
    const name = profileName.trim() || user.displayName || "";
    setIsSavingName(true);
    try {
      await updateProfile(auth.currentUser, { displayName: name });
      setProfileName(name);
      toast.success("Profile updated");
    } catch (error) {
      console.error("Failed to update profile name:", error);
      toast.error("Failed to update profile");
    } finally {
      setIsSavingName(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Profile</h2>
        <p className="text-sm text-slate-400 mt-1">
          Manage your account information
        </p>
      </div>

      <div className="space-y-6">
        {/* Display Name */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <label className="block text-sm font-medium text-white mb-1">
            Display name
          </label>
          <p className="text-sm text-slate-400 mb-4">
            This is the name that will be displayed across the app.
          </p>
          <div className="flex gap-3">
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Your name"
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 max-w-sm"
            />
            <Button
              onClick={handleSaveName}
              disabled={isSavingName}
              className="bg-white text-black hover:bg-slate-100"
            >
              {isSavingName ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        {/* Email */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <label className="block text-sm font-medium text-white mb-1">
            Email address
          </label>
          <p className="text-sm text-slate-400 mb-4">
            Your email address is used for login and notifications.
          </p>
          <div className="flex items-center gap-3">
            <Input
              value={user.email || ""}
              disabled
              className="bg-slate-800/50 border-slate-700 text-slate-400 max-w-sm"
            />
            <span className="text-xs text-slate-500">Cannot be changed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingData>({ credits: 0 });
  const [fillUpOpen, setFillUpOpen] = useState(false);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<PackId | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  // Real-time credits from Firebase
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToBilling(user.uid, setBilling);
    return () => unsub();
  }, [user]);

  // Toast on return from Stripe checkout; open fill-up dialog when ?billing=fill
  useEffect(() => {
    const billingParam = searchParams.get("billing");
    if (billingParam === "success") {
      toast.success("Subscription set up. Your R-Credits have been added.");
      router.replace("/settings/billing", { scroll: false });
    } else if (billingParam === "cancel") {
      toast.info("Checkout cancelled.");
      router.replace("/settings/billing", { scroll: false });
    } else if (billingParam === "fill") {
      setFillUpOpen(true);
      router.replace("/settings/billing", { scroll: false });
    }
  }, [searchParams, router]);

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
        successUrl: `${base}/settings/billing?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/settings/billing?billing=cancel`,
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

  if (!user) return null;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-slate-400 mt-1">
            Manage your subscription and credits
          </p>
        </div>

        {/* Current Balance */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-2">Current balance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white">{billing.credits}</span>
                <span className="text-slate-400">R-Credits</span>
              </div>
            </div>
            {billing.tier && (
              <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-sm font-medium">
                {SUBSCRIPTION_TIERS[billing.tier].name}
              </span>
            )}
          </div>
          {billing.tier && billing.currentPeriodEnd && (
            <p className="text-sm text-slate-400 mt-4 pt-4 border-t border-slate-800">
              {billing.cancelAtPeriodEnd ? (
                <>
                  <span className="text-amber-400 font-medium">Subscription cancelled</span>
                  {" · "}Access until{" "}
                  {new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </>
              ) : (
                <>
                  {SUBSCRIPTION_TIERS[billing.tier].creditsPerMonth} credits added monthly
                  {" · "}Next renewal{" "}
                  {new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </>
              )}
            </p>
          )}
        </div>

        {/* Subscription Actions */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="text-sm font-medium text-white mb-1">Subscription</h3>
          <p className="text-sm text-slate-400 mb-4">
            Use R-Credits for renders and other premium features. Unused credits roll over
            each month.
          </p>
          <div className="flex flex-wrap gap-3">
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
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {portalLoading ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : null}
                Manage subscription
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Subscribe / change plan dialog */}
      <Dialog
        open={fillUpOpen}
        onOpenChange={(open) => {
          setFillUpOpen(open);
          setCheckoutError(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{billing.customerId ? "Change plan" : "Subscribe"}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Choose a plan. Credits roll over each month until renewal.
            </DialogDescription>
          </DialogHeader>
          {checkoutError && (
            <p className="text-sm text-red-400 bg-red-400/10 rounded-lg p-3">{checkoutError}</p>
          )}
          {packsLoading ? (
            <div className="flex items-center gap-2 text-slate-400 py-6 justify-center">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading plans…</span>
            </div>
          ) : packs.length === 0 ? (
            <div className="flex gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-4">
              <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-200">Plans unavailable</p>
                <p className="text-sm text-red-300/90 mt-1">
                  Please try again later.
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
                    className={cn(
                      "flex items-center justify-between rounded-lg border p-4 transition-colors",
                      isCurrentPlan
                        ? "border-amber-500/50 bg-amber-500/5"
                        : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                    )}
                  >
                    <div>
                      <p className="font-medium text-white">{pack.name}</p>
                      <p className="text-sm text-slate-400">
                        {pack.credits} credits · ${pack.amountUsd.toFixed(2)}/mo
                      </p>
                    </div>
                    <Button
                      onClick={() => handleSubscribe(pack.id)}
                      disabled={!!checkoutLoading || isCurrentPlan}
                      variant={isCurrentPlan ? "outline" : "default"}
                      className={cn(
                        "shrink-0",
                        isCurrentPlan
                          ? "border-slate-600 text-slate-400"
                          : "bg-amber-600 hover:bg-amber-700 text-white"
                      )}
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : isCurrentPlan ? (
                        "Current"
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
    </>
  );
}

function IntegrationsSection() {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<UserIntegrations>({});
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

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

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Integrations</h2>
        <p className="text-sm text-slate-400 mt-1">
          Connect external services to your account
        </p>
      </div>

      {/* Telegram */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg shrink-0">
              <MessageCircle className="size-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium text-white">Telegram</h3>
                {integrations.telegram && (
                  <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs font-medium">
                    Connected
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400">
                Interact with your projects via the Gemini Studio Telegram bot.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-950/50 border-t border-slate-800">
          {loadingIntegrations ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : integrations.telegram ? (
            <div className="flex items-center justify-between">
              <div>
                {integrations.telegram.telegramUsername && (
                  <p className="text-sm text-slate-300">
                    @{integrations.telegram.telegramUsername}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Connected {new Date(integrations.telegram.linkedAt).toLocaleDateString()}
                </p>
              </div>
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
                Disconnect
              </Button>
            </div>
          ) : linkCode ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">
                Send this code to the Gemini Studio bot:
              </p>
              <div className="flex items-center gap-2">
                <code className="px-4 py-2 bg-slate-800 rounded-lg text-lg font-mono tracking-widest text-white">
                  {linkCode}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyCode}
                  className="text-slate-400 hover:text-white size-9"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-4">
                <p className="text-xs text-slate-500">
                  Send <code className="text-slate-400">/link {linkCode}</code> · Expires in 10 min
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateCode}
                  disabled={isGeneratingCode}
                  className="text-slate-400 hover:text-white h-auto py-1 px-2"
                >
                  <RefreshCw
                    className={cn("size-3 mr-1.5", isGeneratingCode && "animate-spin")}
                  />
                  New code
                </Button>
              </div>
            </div>
          ) : (
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
              Connect Telegram
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();

  // Get tab from URL params - [[...tab]] gives us an array or undefined
  const tabParam = params.tab as string[] | undefined;
  const tab = tabParam?.[0] as SettingsSection | undefined;

  // Redirect /settings to /settings/profile
  useEffect(() => {
    if (!tab) {
      router.replace("/settings/profile");
    }
  }, [tab, router]);

  // If no tab yet (redirecting), show nothing
  if (!tab) {
    return null;
  }

  // Render the appropriate section based on URL
  switch (tab) {
    case "billing":
      return <BillingSection />;
    case "integrations":
      return <IntegrationsSection />;
    case "profile":
    default:
      return <ProfileSection />;
  }
}
