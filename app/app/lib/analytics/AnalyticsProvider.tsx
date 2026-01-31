"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getAnalytics, logEvent as firebaseLogEvent, type Analytics } from "firebase/analytics";
import { app } from "@/app/lib/server/firebase";
import { ANALYTICS_EVENTS, type AnalyticsEventParams } from "./events";

interface AnalyticsContextValue {
  /** Log a custom event. No-op if analytics is not available (e.g. SSR or disabled). */
  logEvent: (eventName: string, params?: AnalyticsEventParams) => void;
  /** Whether analytics is initialized (client + config present). */
  isReady: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

function getAnalyticsInstance(): Analytics | null {
  if (typeof window === "undefined") return null;
  try {
    return getAnalytics(app);
  } catch {
    return null;
  }
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const pathname = usePathname();
  const initialPathRef = useRef<string | null>(null);

  useEffect(() => {
    const instance = getAnalyticsInstance();
    setAnalytics(instance);
  }, []);

  const logEvent = useCallback(
    (eventName: string, params?: AnalyticsEventParams) => {
      if (!analytics) return;
      try {
        firebaseLogEvent(analytics, eventName, params);
      } catch {
        // ignore
      }
    },
    [analytics]
  );

  // Track page_view on pathname change (client-side navigation)
  useEffect(() => {
    if (!analytics || !pathname) return;
    const isInitial = initialPathRef.current === null;
    initialPathRef.current = pathname;
    logEvent(ANALYTICS_EVENTS.PAGE_VIEW, {
      page_title: document.title || "Gemini Studio",
      page_location: typeof window !== "undefined" ? window.location.href : pathname,
    });
  }, [analytics, pathname, logEvent]);

  const value: AnalyticsContextValue = {
    logEvent,
    isReady: !!analytics,
  };

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalyticsContext(): AnalyticsContextValue | null {
  return useContext(AnalyticsContext);
}
