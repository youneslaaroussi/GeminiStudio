'use client';

import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from '@/app/lib/server/firebase';
import { getAuthHeaders } from '@/app/lib/hooks/useAuthFetch';

/**
 * Hook to get current authenticated user and auth methods
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        setUser(user);
        setLoading(false);

        // Set session cookie for authenticated requests (video/img tags)
        if (user) {
          try {
            const idToken = await user.getIdToken();
            await fetch('/api/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken }),
            });
          } catch (err) {
            console.error('Failed to set session cookie:', err);
          }
        }
      },
      (error) => {
        setError(error.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const signup = async (email: string, password: string) => {
    try {
      setError(null);
      const result = await createUserWithEmailAndPassword(auth, email, password);
      setUser(result.user);
      return result.user;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      setError(null);
      const result = await signInWithEmailAndPassword(auth, email, password);
      setUser(result.user);
      return result.user;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      setError(null);
      // Clear session cookie first
      await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
      await signOut(auth);
      setUser(null);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const sendVerificationEmail = async (continueUrl?: string) => {
    try {
      setError(null);
      if (!auth.currentUser) {
        throw new Error('No user is currently signed in');
      }
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        throw new Error('Not authenticated');
      }
      const url =
        continueUrl ??
        (typeof window !== 'undefined' ? `${window.location.origin}/settings/claims` : undefined);
      const res = await fetch('/api/auth/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(url ? { continueUrl: url } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to send verification email');
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  return { user, loading, error, signup, login, logout, sendVerificationEmail };
}
