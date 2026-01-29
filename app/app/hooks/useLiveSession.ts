"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LiveSession, getToolsForLiveApi, executeToolByName } from "@/app/lib/live";
import type { LiveSessionState, ToolCallRequest, LiveVoiceName } from "@/app/lib/live";
import { useAuth } from "@/app/lib/hooks/useAuth";

const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

interface UseLiveSessionOptions {
  systemInstruction?: string;
  /** Voice for audio responses (default: "Puck") */
  voice?: LiveVoiceName;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onToolCall?: (toolCall: ToolCallRequest) => Promise<Record<string, unknown>>;
  onOutputLevel?: (level: number) => void;
}

interface UseLiveSessionReturn {
  state: LiveSessionState;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: (options?: { deviceId?: string; onAudioLevel?: (level: number) => void }) => Promise<void>;
  stopListening: () => void;
  sendText: (text: string) => void;
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;
}

export function useLiveSession(options: UseLiveSessionOptions = {}): UseLiveSessionReturn {
  const { user } = useAuth();
  const sessionRef = useRef<LiveSession | null>(null);
  const [state, setState] = useState<LiveSessionState>({
    status: "disconnected",
    isListening: false,
    isSpeaking: false,
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.disconnect();
    };
  }, []);

  const connect = useCallback(async () => {
    if (!user) {
      setState((s) => ({ ...s, status: "error", error: "Not authenticated" }));
      return;
    }

    if (sessionRef.current?.isConnected()) {
      return;
    }

    try {
      // Get ephemeral token from our API
      const idToken = await user.getIdToken();
      const response = await fetch("/api/live/token", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get session token");
      }

      const { token, model } = await response.json();

      // Create session with configuration
      const session = new LiveSession(
        {
          model: model || LIVE_MODEL,
          systemInstruction:
            options.systemInstruction ||
            `You are a helpful AI assistant for Gemini Studio, a video editing application.
You help users edit their video projects using voice commands.
Be concise and conversational. Confirm actions you take.
You have access to tools for managing the timeline, adding/removing clips, listing assets, and rendering videos.
When the user asks you to do something, use the appropriate tool to accomplish it.`,
          tools: getToolsForLiveApi(),
          responseModalities: ["AUDIO"],
          voice: options.voice,
        },
        {
          onStateChange: (newState) => {
            setState(newState);
          },
          onTranscript: options.onTranscript,
          onToolCall: async (toolCall) => {
            // If custom handler provided, use it
            if (options.onToolCall) {
              return options.onToolCall(toolCall);
            }
            // Otherwise, execute tool from registry
            return executeToolByName(toolCall.name, toolCall.args);
          },
          onOutputLevel: options.onOutputLevel,
          onError: (error) => {
            console.error("Live session error:", error);
            setState((s) => ({ ...s, status: "error", error: error.message }));
          },
        }
      );

      sessionRef.current = session;
      await session.connect(token);
    } catch (error) {
      console.error("Failed to connect:", error);
      setState((s) => ({
        ...s,
        status: "error",
        error: error instanceof Error ? error.message : "Connection failed",
      }));
    }
  }, [user, options.systemInstruction, options.voice, options.onTranscript, options.onToolCall, options.onOutputLevel]);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setState({
      status: "disconnected",
      isListening: false,
      isSpeaking: false,
    });
  }, []);

  const startListening = useCallback(async (options?: {
    deviceId?: string;
    onAudioLevel?: (level: number) => void;
  }) => {
    if (!sessionRef.current?.isConnected()) {
      throw new Error("Not connected");
    }
    await sessionRef.current.startListening(options);
  }, []);

  const stopListening = useCallback(() => {
    sessionRef.current?.stopListening();
  }, []);

  const sendText = useCallback((text: string) => {
    if (!sessionRef.current?.isConnected()) {
      throw new Error("Not connected");
    }
    sessionRef.current.sendText(text);
  }, []);

  return {
    state,
    connect,
    disconnect,
    startListening,
    stopListening,
    sendText,
    isConnected: state.status === "connected",
    isListening: state.isListening,
    isSpeaking: state.isSpeaking,
    error: state.error ?? null,
  };
}
