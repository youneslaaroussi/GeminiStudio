'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/lib/hooks/useAuth';
import { claimSignupBonus } from '@/app/lib/services/billing-api';
import { auth } from '@/app/lib/server/firebase';
import Image from 'next/image';
import { GradientCtaButtonAsButton } from '@/components/landing/gradient-cta-button';
import { Loader2, Mail, Sparkles, CheckCircle2 } from 'lucide-react';

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading, sendVerificationEmail } = useAuth();
  const [bonusGranted, setBonusGranted] = useState(false);
  const [emailJustVerified, setEmailJustVerified] = useState(false);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Require auth
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/auth/login');
      return;
    }
  }, [user, authLoading, router]);

  // Poll for email verification and claim bonus when verified
  useEffect(() => {
    if (!user || user.emailVerified || emailJustVerified) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const poll = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      try {
        await currentUser.reload();
        const updated = auth.currentUser;
        if (updated?.emailVerified) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setEmailJustVerified(true);
          setClaimingBonus(true);
          try {
            const result = await claimSignupBonus();
            setBonusGranted(result.granted);
          } finally {
            setClaimingBonus(false);
          }
        }
      } catch {
        // ignore
      }
    };

    poll();
    pollIntervalRef.current = setInterval(poll, 2500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [user?.uid, user?.emailVerified, emailJustVerified]);

  const handleGetStarted = () => {
    router.push('/app');
  };

  const handleResendVerification = async () => {
    if (!user || user.emailVerified) return;
    setResendLoading(true);
    try {
      await sendVerificationEmail();
    } finally {
      setResendLoading(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-slate-500" />
      </div>
    );
  }

  const showVerificationPending = !user.emailVerified && !emailJustVerified;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo and title */}
          <div className="text-center mb-10">
            <Image
              src="/gemini-logo.png"
              alt="Gemini Studio"
              width={56}
              height={56}
              className="mx-auto mb-5"
            />
            <h1 className="text-2xl font-semibold text-white mb-1">
              Welcome to Gemini Studio
            </h1>
            <p className="text-slate-400 text-sm">
              Your account is ready. Here’s what’s next.
            </p>
          </div>

          {/* Content card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 space-y-5">
            {showVerificationPending ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-800 p-2 shrink-0">
                    <Mail className="size-5 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-medium text-white mb-1">
                      Verify your email for 30 free R-Credits
                    </h2>
                    <p className="text-sm text-slate-400">
                      We sent a verification link to <strong className="text-slate-300">{user.email}</strong>. Click it and we’ll add your credits automatically.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="size-3.5 animate-spin shrink-0" />
                  <span>Checking for verification…</span>
                </div>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendLoading}
                  className="text-sm text-slate-400 hover:text-white disabled:opacity-50"
                >
                  {resendLoading ? 'Sending…' : 'Resend verification email'}
                </button>
              </>
            ) : emailJustVerified ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-800 p-2 shrink-0">
                    {claimingBonus ? (
                      <Loader2 className="size-5 text-slate-400 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-5 text-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-medium text-white mb-1">
                      {claimingBonus
                        ? 'Adding your 30 free credits…'
                        : bonusGranted
                          ? "You've received 30 free R-Credits"
                          : 'Email verified'}
                    </h2>
                    <p className="text-sm text-slate-400">
                      {claimingBonus
                        ? 'One moment.'
                        : bonusGranted
                          ? 'Create your first project and start making videos.'
                          : 'Claim your 30 free R-Credits in Settings → Claims & bonuses.'}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-800 p-2 shrink-0">
                    <Sparkles className="size-5 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-medium text-white mb-1">
                      {bonusGranted
                        ? "You've got 30 free R-Credits"
                        : 'Your account is ready'}
                    </h2>
                    <p className="text-sm text-slate-400">
                      {bonusGranted
                        ? 'Create your first project and start making AI-assisted videos.'
                        : 'Create your first project and start making videos.'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <GradientCtaButtonAsButton
              onClick={handleGetStarted}
              className="w-full max-w-xs h-11 justify-center"
            >
              {showVerificationPending ? 'Continue without verifying' : 'Get started'}
            </GradientCtaButtonAsButton>
            <p className="text-xs text-slate-500">
              You can claim credits later in Settings → Claims & bonuses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
