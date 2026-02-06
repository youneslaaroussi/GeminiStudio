"use client";

import { useEffect } from "react";

const STORAGE_KEY = "gemini_studio_page_loaded_at";
const CHECK_INTERVAL_MS = 60_000; // check every minute

/** Max age in seconds before we reload the page so new signed asset URLs are fetched. Should be less than asset-service ASSET_SIGNED_URL_TTL_SECONDS. */
const DEFAULT_MAX_AGE_SECONDS = 55 * 60; // 55 min, safe with 1h URL TTL

function getMaxAgeSeconds(): number {
  if (typeof process.env.NEXT_PUBLIC_SIGNED_URL_MAX_AGE_SECONDS === "string") {
    const n = parseInt(process.env.NEXT_PUBLIC_SIGNED_URL_MAX_AGE_SECONDS, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_AGE_SECONDS;
}

export function SignedUrlRefreshHandler() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;

    const maxAgeMs = getMaxAgeSeconds() * 1000;

    let loadedAt = sessionStorage.getItem(STORAGE_KEY);
    if (!loadedAt) {
      loadedAt = String(Date.now());
      sessionStorage.setItem(STORAGE_KEY, loadedAt);
    }
    const loadTime = parseInt(loadedAt, 10);
    if (!Number.isFinite(loadTime)) {
      sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
      return;
    }

    const check = () => {
      const elapsed = Date.now() - loadTime;
      if (elapsed >= maxAgeMs) {
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.reload();
      }
    };

    check(); // run once immediately in case we're already past the threshold
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
