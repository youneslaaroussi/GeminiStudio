'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/app/lib/server/firebase';
import Image from 'next/image';

/**
 * Magic link demo page for reviewers.
 * Auto-authenticates and redirects to the demo project.
 *
 * Usage: /demo?token=YOUR_SECRET
 * Optional: /demo?token=YOUR_SECRET&project=CUSTOM_PROJECT_ID
 */
function DemoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const projectOverride = searchParams.get('project');

    if (!token) {
      setStatus('error');
      setError('Missing access token');
      return;
    }

    async function authenticate() {
      try {
        setStatus('loading');

        // Call magic link API to get Firebase custom token
        const response = await fetch(`/api/magic-link?token=${encodeURIComponent(token!)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to authenticate');
        }

        const { customToken, projectId } = data;

        // Sign in with the custom token
        await signInWithCustomToken(auth, customToken);

        setStatus('success');

        // Redirect to the project editor
        const targetProject = projectOverride || projectId;
        if (targetProject) {
          router.replace(`/app/editor/${targetProject}`);
        } else {
          // Fallback to projects list if no project specified
          router.replace('/app');
        }
      } catch (err: unknown) {
        console.error('Demo auth failed:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    }

    authenticate();
  }, [searchParams, router]);

  return (
    <div className="text-center">
      <Image
        src="/gemini-logo.png"
        alt="Gemini Studio"
        width={64}
        height={64}
        className="mx-auto mb-6"
      />

      {status === 'loading' && (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4" />
          <p className="text-slate-400">Setting up your demo session...</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="text-green-400 text-2xl mb-4">✓</div>
          <p className="text-slate-400">Redirecting to project...</p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="text-red-400 text-2xl mb-4">✗</div>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push('/auth/login')}
            className="px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors"
          >
            Go to Login
          </button>
        </>
      )}
    </div>
  );
}

function DemoFallback() {
  return (
    <div className="text-center">
      <Image
        src="/gemini-logo.png"
        alt="Gemini Studio"
        width={64}
        height={64}
        className="mx-auto mb-6"
      />
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4" />
      <p className="text-slate-400">Loading...</p>
    </div>
  );
}

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <Suspense fallback={<DemoFallback />}>
        <DemoContent />
      </Suspense>
    </div>
  );
}
