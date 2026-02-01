"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Mic, Square, ChevronDown, RefreshCw, Volume2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useLiveSession } from "@/app/hooks/useLiveSession";
import { getAudioInputDevices, executeToolByName } from "@/app/lib/live";
import { AudioWaveVisualizer } from "@/app/components/AudioWaveVisualizer";
import type { ToolCallRequest, AudioDevice, LiveVoiceName } from "@/app/lib/live";

/** Curated list of voices with descriptions */
const VOICE_OPTIONS: { id: LiveVoiceName; label: string; description: string }[] = [
  { id: "Puck", label: "Puck", description: "Upbeat" },
  { id: "Charon", label: "Charon", description: "Informative" },
  { id: "Kore", label: "Kore", description: "Firm" },
  { id: "Fenrir", label: "Fenrir", description: "Excitable" },
  { id: "Aoede", label: "Aoede", description: "Breezy" },
  { id: "Leda", label: "Leda", description: "Youthful" },
  { id: "Orus", label: "Orus", description: "Firm" },
  { id: "Zephyr", label: "Zephyr", description: "Bright" },
];

interface VoiceChatProps {
  onToolCall?: (toolCall: ToolCallRequest) => Promise<Record<string, unknown>>;
  className?: string;
}

export function VoiceChat({ onToolCall, className = "" }: VoiceChatProps) {
  const [transcript, setTranscript] = useState<string>("");
  const [lastAction, setLastAction] = useState<{ name: string; args: Record<string, unknown> } | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [outputLevel, setOutputLevel] = useState<number>(0);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<LiveVoiceName>("Puck");
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);

  const MIC_DEVICE_STORAGE_KEY = "voice-chat-mic-device-id";
  const VOICE_STORAGE_KEY = "voice-chat-voice";

  // Load available audio devices and restore last selected mic (if it still exists)
  useEffect(() => {
    getAudioInputDevices().then((devices) => {
      setAudioDevices(devices);
      if (devices.length === 0) return;
      const savedId =
        typeof window !== "undefined" ? localStorage.getItem(MIC_DEVICE_STORAGE_KEY) : null;
      const stillAvailable = savedId && devices.some((d) => d.deviceId === savedId);
      if (savedId && !stillAvailable && typeof window !== "undefined") {
        localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
      }
      setSelectedDeviceId(stillAvailable ? savedId : devices[0].deviceId);
    });
  }, []);

  // Persist mic selection when user changes it
  const setSelectedDeviceIdAndSave = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (typeof window !== "undefined") {
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId);
    }
  }, []);

  // Load saved voice preference
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedVoice = localStorage.getItem(VOICE_STORAGE_KEY) as LiveVoiceName | null;
      if (savedVoice && VOICE_OPTIONS.some((v) => v.id === savedVoice)) {
        setSelectedVoice(savedVoice);
      }
    }
  }, []);

  // Persist voice selection
  const setSelectedVoiceAndSave = useCallback((voice: LiveVoiceName) => {
    setSelectedVoice(voice);
    if (typeof window !== "undefined") {
      localStorage.setItem(VOICE_STORAGE_KEY, voice);
    }
  }, []);

  const REFRESH_MIN_DURATION_MS = 500;

  const refreshAudioDevices = useCallback(() => {
    setIsRefreshingDevices(true);
    const startedAt = Date.now();
    getAudioInputDevices()
      .then((devices) => {
        setAudioDevices(devices);
        if (devices.length === 0) return;
        const savedId =
          typeof window !== "undefined" ? localStorage.getItem(MIC_DEVICE_STORAGE_KEY) : null;
        const stillAvailable = savedId && devices.some((d) => d.deviceId === savedId);
        if (savedId && !stillAvailable && typeof window !== "undefined") {
          localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
        }
        setSelectedDeviceId(stillAvailable ? savedId : devices[0].deviceId);
      })
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, REFRESH_MIN_DURATION_MS - elapsed);
        setTimeout(() => setIsRefreshingDevices(false), remaining);
      });
  }, []);

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    setTranscript(text);
    if (isFinal) {
      // Clear after a moment
      setTimeout(() => setTranscript(""), 3000);
    }
  }, []);

  // Handle tool calls: always update UI, then delegate to custom handler or execute via registry
  const handleToolCall = useCallback(
    async (toolCall: ToolCallRequest) => {
      setLastAction({ name: toolCall.name, args: toolCall.args });

      // Use custom handler if provided, otherwise execute tool from registry
      if (onToolCall) {
        return onToolCall(toolCall);
      }
      return executeToolByName(toolCall.name, toolCall.args);
    },
    [onToolCall]
  );

  const {
    connect,
    disconnect,
    startListening,
    stopListening,
    isConnected,
    isListening,
    isSpeaking,
    error,
    state,
  } = useLiveSession({
    voice: selectedVoice,
    onTranscript: handleTranscript,
    onToolCall: handleToolCall,
    onOutputLevel: setOutputLevel,
  });

  const handleMicClick = async () => {
    if (!isConnected) {
      await connect();
      // Auto-start listening after connection
      setTimeout(() => {
        startListening({
          deviceId: selectedDeviceId || undefined,
          onAudioLevel: setAudioLevel,
        });
      }, 500);
    } else if (isListening) {
      stopListening();
      setAudioLevel(0);
    } else {
      await startListening({
        deviceId: selectedDeviceId || undefined,
        onAudioLevel: setAudioLevel,
      });
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setTranscript("");
    setLastAction(null);
    setAudioLevel(0);
    setOutputLevel(0);
  };

  return (
    <div className={`relative flex flex-col items-center gap-4 w-[calc(100%+48px)] -ml-6 -mb-6 ${className}`}>
      {/* AI speech wave visualizer - full bleed to panel edges, z-0 */}
      {isConnected && (
        <div
          className="absolute bottom-0 left-0 right-0 w-full h-24 z-0 overflow-hidden pointer-events-none"
          aria-hidden
        >
          <AudioWaveVisualizer
            level={outputLevel}
            isActive={isSpeaking}
            color="#3b82f6"
            className="w-full h-full"
          />
        </div>
      )}

      {/* Main content - centered in panel (272px padded area) */}
      <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-[272px] mx-auto pb-6">
      {/* Audio level indicator */}
      {isListening && (
        <div className="flex items-center gap-1 h-8">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1.5 rounded-full bg-red-500 transition-all duration-75"
              style={{
                height: `${Math.min(100, Math.max(20, audioLevel * 100 * (5 - Math.abs(i - 2))))}%`,
                opacity: audioLevel > i * 0.15 ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      )}

      {/* Main mic button */}
      <button
        onClick={handleMicClick}
        disabled={state.status === "connecting"}
        className={`
          relative w-20 h-20 rounded-full transition-all duration-300
          flex items-center justify-center
          ${
            isListening
              ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50"
              : isConnected
                ? "bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/30"
                : "bg-zinc-700 hover:bg-zinc-600"
          }
          ${state.status === "connecting" ? "opacity-50 cursor-wait" : "cursor-pointer"}
        `}
        style={isListening ? {
          transform: `scale(${1 + audioLevel * 0.15})`,
        } : undefined}
        title={
          isListening
            ? "Click to stop"
            : isConnected
              ? "Click to speak"
              : "Click to start voice chat"
        }
      >
        {/* Mic/Stop icon */}
        {isListening ? (
          <Square className={`size-10 fill-current ${isListening || isConnected ? "text-white" : "text-zinc-400"}`} />
        ) : (
          <Mic className={`size-10 ${isListening || isConnected ? "text-white" : "text-zinc-400"}`} />
        )}

      </button>

      {/* Status text - truncated with bottom fade */}
      <div
        className="relative text-center min-h-[60px] max-h-[72px] w-full overflow-hidden"
        style={{
          maskImage: "linear-gradient(to bottom, black 0%, black 65%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 65%, transparent 100%)",
        }}
      >
        <div className="px-1">
          {state.status === "connecting" && (
            <p className="text-zinc-400 text-sm animate-pulse">Connecting...</p>
          )}

          {error && (
            <p className="text-red-400 text-sm line-clamp-2 break-words">&ldquo;{error}&rdquo;</p>
          )}

          {isConnected && !isListening && !isSpeaking && (
            <p className="text-emerald-400 text-sm">Ready - tap to speak</p>
          )}

          {isListening && (
            <p className="text-red-400 text-sm font-medium">Listening...</p>
          )}

          {transcript && (
            <div className="text-zinc-300 text-xs mt-2 max-w-xs mx-auto line-clamp-2 break-words [&_p]:inline [&_strong]:font-semibold [&_strong]:text-zinc-200 [&_code]:text-[0.65rem] [&_code]:bg-zinc-700/50 [&_code]:px-1 [&_code]:rounded">
              &ldquo;<ReactMarkdown>{transcript}</ReactMarkdown>&rdquo;
            </div>
          )}

          {lastAction && !transcript && (
            <p className="text-zinc-500 text-xs mt-2 max-w-xs mx-auto line-clamp-2 break-words">
              <strong className="text-zinc-400 font-medium">{lastAction.name}</strong>
              {Object.keys(lastAction.args).length > 0 && (
                <>
                  {": "}
                  <code className="text-[0.65rem] px-1 py-0.5 rounded bg-zinc-700/50">
                    {JSON.stringify(lastAction.args)}
                  </code>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Disconnect button (when connected) */}
      {isConnected && (
        <button
          onClick={handleDisconnect}
          className="text-zinc-500 hover:text-zinc-300 text-xs underline"
        >
          Disconnect
        </button>
      )}

      {/* Mic and Voice selectors (when not listening) */}
      {!isListening && (
        <div className="flex items-center justify-center gap-3">
          {/* Mic selector */}
          {audioDevices.length > 1 && (
            <div className="relative">
              <button
                onClick={() => {
                  setShowDeviceSelector(!showDeviceSelector);
                  setShowVoiceSelector(false);
                }}
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-xs"
              >
                <Mic className="size-3" />
                <span className="max-w-[100px] truncate">
                  {audioDevices.find(d => d.deviceId === selectedDeviceId)?.label || "Mic"}
                </span>
                <ChevronDown className={`size-3 transition-transform ${showDeviceSelector ? "rotate-180" : ""}`} />
              </button>

              {showDeviceSelector && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[200px] max-h-[200px] overflow-y-auto z-10">
                  <div className="flex items-center justify-end gap-1 px-2 pb-1.5 pt-0.5 border-b border-zinc-700/50">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshAudioDevices();
                      }}
                      disabled={isRefreshingDevices}
                      className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-70 disabled:pointer-events-none"
                      title="Refresh microphone list"
                    >
                      <RefreshCw className={`size-3.5 ${isRefreshingDevices ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                  {audioDevices.map((device) => (
                    <button
                      key={device.deviceId}
                      onClick={() => {
                        setSelectedDeviceIdAndSave(device.deviceId);
                        setShowDeviceSelector(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
                        device.deviceId === selectedDeviceId ? "text-emerald-400" : "text-zinc-300"
                      }`}
                    >
                      {device.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Voice selector */}
          <div className="relative">
            <button
              onClick={() => {
                setShowVoiceSelector(!showVoiceSelector);
                setShowDeviceSelector(false);
              }}
              disabled={isConnected}
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title={isConnected ? "Disconnect to change voice" : "Select AI voice"}
            >
              <Volume2 className="size-3" />
              <span>{selectedVoice}</span>
              <ChevronDown className={`size-3 transition-transform ${showVoiceSelector ? "rotate-180" : ""}`} />
            </button>

            {showVoiceSelector && !isConnected && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-[200px] overflow-y-auto z-10">
                {VOICE_OPTIONS.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => {
                      setSelectedVoiceAndSave(voice.id);
                      setShowVoiceSelector(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-700 transition-colors flex items-center justify-between gap-2 ${
                      voice.id === selectedVoice ? "text-emerald-400" : "text-zinc-300"
                    }`}
                  >
                    <span>{voice.label}</span>
                    <span className="text-zinc-500 text-[10px]">{voice.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Instructions (when not connected) */}
      {!isConnected && state.status !== "connecting" && (
        <p className="text-zinc-600 text-xs text-center max-w-[200px]">
          Start a voice conversation with your AI video editor
        </p>
      )}
      </div>

    </div>
  );
}

/**
 * Compact version for embedding in other UI
 */
export function VoiceChatButton({ onToolCall, className = "" }: VoiceChatProps) {
  const {
    connect,
    disconnect,
    startListening,
    stopListening,
    isConnected,
    isListening,
    isSpeaking,
    state,
  } = useLiveSession({
    onToolCall,
  });

  const handleClick = async () => {
    if (!isConnected) {
      await connect();
      setTimeout(() => startListening(), 500);
    } else if (isListening) {
      stopListening();
    } else {
      await startListening();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={state.status === "connecting"}
      className={`
        relative p-3 rounded-full transition-all duration-200
        ${
          isListening
            ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
            : isConnected
              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        }
        ${state.status === "connecting" ? "opacity-50" : ""}
        ${isSpeaking ? "ring-2 ring-blue-400" : ""}
        ${className}
      `}
      title={isListening ? "Stop" : isConnected ? "Speak" : "Start voice chat"}
    >
      {isListening ? (
        <Square className="size-5 fill-current" />
      ) : (
        <Mic className="size-5" />
      )}

      {isListening && (
        <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-25" />
      )}
    </button>
  );
}
