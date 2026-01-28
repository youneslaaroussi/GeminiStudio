'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/lib/hooks/useAuth';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const { login, signup, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLocalError(null);

    try {
      if (isSignup) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      router.push('/');
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-white text-slate-900 text-sm font-medium rounded-md hover:bg-slate-100 disabled:opacity-50 transition-colors"
            >
              {loading ? '...' : (isSignup ? 'Sign up' : 'Sign in')}
            </button>
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
