'use client';

import { useCallback } from 'react';
import { auth } from '@/app/lib/server/firebase';

/**
 * Get auth headers with Firebase ID token.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    return {};
  }

  try {
    const token = await user.getIdToken();
    return {
      'Authorization': `Bearer ${token}`,
    };
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return {};
  }
}

/**
 * Hook that returns a fetch function with auth headers included.
 */
export function useAuthFetch() {
  const authFetch = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const authHeaders = await getAuthHeaders();

    return fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });
  }, []);

  return authFetch;
}

/**
 * Get auth token for XHR requests.
 */
export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) {
    return null;
  }

  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}
