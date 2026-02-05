"use client";

import { useEffect, useRef } from "react";
import type { User } from "firebase/auth";
import type { ChatMode, TimelineChatMessage } from "@/app/types/chat";
import {
  saveChatSession,
  generateSessionName,
} from "@/app/lib/services/chat-sessions";

const DEFAULT_INTERVAL_MS = 30_000;

export interface AutoSaveChatState {
  user: User | null;
  sessionId: string;
  mode: ChatMode;
  messages: TimelineChatMessage[] | undefined;
}

interface UseAutoSaveChatOptions {
  /** Polling interval in milliseconds. Default: 30000 */
  intervalMs?: number;
  /** Whether auto-save is enabled. Default: true when getState is provided */
  enabled?: boolean;
  /** Returns current chat state; use a ref so the interval always reads latest values */
  getState: () => AutoSaveChatState;
  /** Called after a successful auto-save so the UI can show "saved" state (e.g. check icon) */
  onSaved?: () => void;
}

/**
 * Polls periodically and saves the current assistant chat session to Firebase
 * when the user is logged in and there are messages. Calls onSaved on success
 * so the save button can show the "saved" state.
 */
export function useAutoSaveChat(options: UseAutoSaveChatOptions) {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
    getState,
    onSaved,
  } = options;
  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const tick = () => {
      const { user, sessionId, mode, messages } = getStateRef.current();
      if (!user?.uid || !messages?.length) return;
      const name = generateSessionName(messages);
      saveChatSession(user.uid, sessionId, name, mode, messages)
        .then(() => {
          onSavedRef.current?.();
        })
        .catch((err) => {
          console.error("Auto-save chat failed:", err);
        });
    };

    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
