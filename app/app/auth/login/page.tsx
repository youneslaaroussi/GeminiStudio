'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/lib/hooks/useAuth';
import Image from 'next/image';
import { GradientCtaButtonAsButton } from '@/components/landing/gradient-cta-button';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, login, signup, sendVerificationEmail, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Redirect to app if already logged in; new signups go to onboarding
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/app');
    }
  }, [user, authLoading, router]);

  if (authLoading || user) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLocalError(null);

    if (isSignup && !agreedToTerms) {
      setLocalError('You must agree to the Privacy Policy and Terms of Service');
      setLoading(false);
      return;
    }

    try {
      if (isSignup) {
        await signup(email, password);
        try {
          await sendVerificationEmail();
        } catch (verifyErr: any) {
          console.error('Failed to send verification email:', verifyErr);
        }
        router.push('/auth/onboarding');
      } else {
        await login(email, password);
        router.push('/app');
      }
    } catch (err: any) {
      setLocalError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo and name */}
        <div className="text-center mb-10">
          <Image
            src="/gemini-logo.png"
            alt="Gemini Studio"
            width={48}
            height={48}
            className="mx-auto mb-4"
          />
          <h1 className="text-xl font-semibold text-white">Gemini Studio</h1>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {(localError || error) && (
            <p className="text-sm text-red-400 text-center">
              {localError || error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-md text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-600"
              placeholder="Email"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-md text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-600"
              placeholder="Password"
            />
            {isSignup && (
              <div className="flex items-start gap-2 py-2">
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-1 rounded border-slate-700 bg-slate-900 text-white focus:ring-slate-600"
                />
                <label htmlFor="terms" className="text-xs text-slate-400">
                  I agree to the{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white underline">
                    Privacy Policy
                  </a>
                  {' '}and{' '}
                  <a href="/tos" target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-white underline">
                    Terms of Service
                  </a>
                </label>
              </div>
            )}
            <GradientCtaButtonAsButton
              type="submit"
              disabled={loading || (isSignup && !agreedToTerms)}
              className="w-full h-11 justify-center disabled:opacity-50"
            >
              {loading ? '…' : (isSignup ? 'Sign up' : 'Sign in')}
            </GradientCtaButtonAsButton>
          </form>

          <p className="text-sm text-slate-500 text-center">
            {isSignup ? 'Have an account?' : 'No account?'}{' '}
            <button
              onClick={() => setIsSignup(!isSignup)}
              className="text-slate-300 hover:text-white"
            >
              {isSignup ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
