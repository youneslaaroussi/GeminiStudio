'use client';

/**
 * Custom Firebase email action handler (verify email, etc.).
 *
 * Firebase Console setup:
 * 1. Authentication → Templates → Email address verification (or other templates)
 * 2. Click "Customize action URL"
 * 3. Set to: https://YOUR_DOMAIN/auth/action?link=%LINK%
 *    (Firebase replaces %LINK% with the actual action URL; we parse it and apply the code.)
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/app/lib/server/firebase';
import { applyActionCode } from 'firebase/auth';
import Image from 'next/image';

type Status = 'loading' | 'success' | 'error';

function AuthActionContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string>('');
  const [redirectUrl, setRedirectUrl] = useState<string>('/settings/claims');

  const run = useCallback(async () => {
    // Support custom action URL: ?link=%LINK% (Firebase replaces %LINK% with the full action URL, often URL-encoded)
    const linkParam = searchParams.get('link');
    let mode: string | null = searchParams.get('mode');
    let oobCode: string | null = searchParams.get('oobCode');
    let continueUrl: string | null = searchParams.get('continueUrl');

    if (linkParam) {
      try {
        const decoded = decodeURIComponent(linkParam);
        const url = new URL(decoded);
        mode = mode ?? url.searchParams.get('mode');
        oobCode = oobCode ?? url.searchParams.get('oobCode');
        continueUrl = continueUrl ?? url.searchParams.get('continueUrl');
      } catch {
        // ignore parse errors
      }
    }

    if (!mode || !oobCode) {
      setStatus('error');
      setMessage('Invalid or missing verification link. Request a new one from Settings → Claims & bonuses.');
      return;
    }

    if (mode !== 'verifyEmail') {
      // Only handle email verification on this page; other modes could be added or redirect to Firebase default
      setStatus('error');
      setMessage('This link is for a different action. Use the link from your email for password reset or email change.');
      return;
    }

    try {
      await applyActionCode(auth, oobCode);
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const safeContinue = continueUrl && continueUrl.startsWith(base) ? continueUrl : `${base}/settings/claims`;
      setRedirectUrl(safeContinue);
      setStatus('success');
      setMessage('Your email is verified. You can now claim your 30 free R-Credits in Settings.');
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
      setStatus('error');
      if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
        setMessage('This link has expired or was already used. Request a new verification email from Settings → Claims & bonuses.');
      } else {
        setMessage(err instanceof Error ? err.message : 'Verification failed. Try again from Settings → Claims & bonuses.');
      }
    }
  }, [searchParams]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Image
          src="/gemini-logo.png"
          alt="Gemini Studio"
          width={48}
          height={48}
          className="mx-auto mb-4"
        />
        <h1 className="text-xl font-semibold text-white mb-2">Email verification</h1>

        {status === 'loading' && (
          <p className="text-slate-400 text-sm">Verifying your email…</p>
        )}

        {status === 'success' && (
          <>
            <p className="text-slate-300 text-sm mb-6">{message}</p>
            <Link
              href={redirectUrl}
              className="inline-flex items-center justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium h-11 px-6"
            >
              Go to Claims & bonuses
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="text-red-300 text-sm mb-6">{message}</p>
            <Link
              href="/settings/claims"
              className="inline-flex items-center justify-center rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 font-medium h-11 px-6"
            >
              Open Settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthActionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    }>
      <AuthActionContent />
    </Suspense>
  );
}
