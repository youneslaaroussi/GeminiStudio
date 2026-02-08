"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { toast } from "sonner";
import {
  Bot,
  Loader2,
  Send,
  Square,
  Download,
  ChevronDown,
  ChevronRight,
  Sparkles,
  MessageSquare,
  ListTodo,
  Paperclip,
  X,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  FileText,
  File as FileIcon,
  Cloud,
  CloudUpload,
  History,
  Save,
  Check,
  AlertCircle,
  Plus,
  Volume2,
  VolumeX,
  Copy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { CodeToolResultCard } from "@/app/components/ui/CodeToolResultCard";
import type {
  AssetMention,
  ChatAttachment,
  ChatMode,
  TaskListSnapshot,
  TimelineChatMessage,
} from "@/app/types/chat";
import { ChatInput, type ChatInputRef } from "./chat";
import { isYouTubeUrl } from "./chat/link-extension";
import {
  MENTION_TOKEN_REGEX,
  getMentionAppearance,
} from "./chat/mention-extension";
import { SiYoutube } from "react-icons/si";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toolRegistry, executeTool } from "@/app/lib/tools/tool-registry";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/app/lib/tools/types";
import type { Project } from "@/app/types/timeline";
import type { VideoEffectJob } from "@/app/types/video-effects";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useVideoEffectsStore } from "@/app/lib/store/video-effects-store";
import { requestAssetHighlight, requestComponentHighlight } from "@/app/lib/store/asset-highlight-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";
import {
  saveChatSession,
  loadChatSession,
  listChatSessions,
  generateSessionName,
  type ChatSessionSummary,
} from "@/app/lib/services/chat-sessions";
import { useAutoSaveChat, type AutoSaveChatState } from "@/app/lib/hooks/useAutoSaveChat";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { getCreditsForAction } from "@/app/lib/credits-config";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/server/firebase";
import { motion, AnimatePresence } from "motion/react";

type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested";

interface ToolPart {
  type: string;
  toolCallId: string;
  state: ToolPartState;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id: string };
}

const MODE_OPTIONS: { value: ChatMode; label: string; description: string }[] =
  [
    {
      value: "ask",
      label: "Ask",
      description: "Direct answers without tools",
    },
    {
      value: "agent",
      label: "Agent",
      description: "Full tool access",
    },
    {
      value: "plan",
      label: "Plan",
      description: "Task planning only",
    },
  ];

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
};

export function ChatPanel() {
  const [hasInputContent, setHasInputContent] = useState(false);
  const [mode, setMode] = useState<ChatMode>("agent");
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [savedSessions, setSavedSessions] = useState<ChatSessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"success" | "error" | null>(null);
  const [isTeleporting, setIsTeleporting] = useState(false);
  const [teleportStatus, setTeleportStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [isCloudProcessing, setIsCloudProcessing] = useState(false);
  const [cloudAgentStatus, setCloudAgentStatus] = useState<string | null>(null);
  const [isListeningToCloud, setIsListeningToCloud] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSpeakLoading, setIsSpeakLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [recommendedActions, setRecommendedActions] = useState<string[]>([]);
  const [recommendedActionsLoading, setRecommendedActionsLoading] = useState(false);
  const cloudUnsubscribeRef = useRef<(() => void) | null>(null);
  const teleportAbortRef = useRef<AbortController | null>(null);
  const recommendedActionsAbortRef = useRef<AbortController | null>(null);
  const recommendedActionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [sessionId, setSessionId] = useState(() => `chat-${Date.now()}`);
  const [initialMessages, setInitialMessages] = useState<TimelineChatMessage[]>([]);

  const router = useRouter();
  const { user } = useAuth();
  const { events: analytics } = useAnalytics();

  const chatCredits = useMemo(() => getCreditsForAction("chat"), []);

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async (options) => {
          const auth = (await getAuthHeaders()) as Record<string, string>;
          return {
            body: {
              messages: options.messages,
              mode,
              id: sessionId,
              ...(options.body ?? {}),
            },
            headers: { ...auth, ...((options.headers as Record<string, string>) ?? {}) },
          };
        },
      }),
    [mode, sessionId]
  );

  const project = useProjectStore((state) => state.project);
  const projectId = useProjectStore((state) => state.projectId);
  const updateProjectSettings = useProjectStore((state) => state.updateProjectSettings);
  const updateProjectInList = useProjectsListStore((state) => state.updateProject);
  const assets = useAssetsStore((state) => state.assets);
  const assetsMetadata = useAssetsStore((state) => state.metadata);

  const messagesRef = useRef<TimelineChatMessage[]>([]);
  const autoSaveChatStateRef = useRef<AutoSaveChatState>({
    user: null,
    sessionId: "",
    mode: "agent",
    messages: undefined,
  });
  const addToolOutputRef = useRef<
    (params: { state: "output-error"; tool: string; toolCallId: string; errorText: string }) => Promise<void>
  | null>(null);
  const setMessagesRef = useRef<typeof setMessages | null>(null);

  const { messages, sendMessage, setMessages, status, error, clearError, stop, addToolOutput } =
    useChat<TimelineChatMessage>({
      transport: chatTransport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      id: sessionId,
      messages: initialMessages,
      onFinish: useCallback(
        async (options?: { isAbort?: boolean; messages?: TimelineChatMessage[] }) => {
          const msgs = options?.messages ?? messagesRef.current;

          // When user stopped the stream, remove the incomplete assistant message to prevent auto-resubmission
          if (options?.isAbort && setMessagesRef.current) {
            setMessagesRef.current((currentMessages) => {
              // Find and remove the last assistant message if it has incomplete tool calls
              const lastAssistantIndex = currentMessages.length - 1;
              if (lastAssistantIndex >= 0 && currentMessages[lastAssistantIndex]?.role === "assistant") {
                const lastMessage = currentMessages[lastAssistantIndex];
                const parts = Array.isArray(lastMessage.parts) ? lastMessage.parts : [];
                const hasIncompleteToolCalls = parts.some(
                  (p) =>
                    typeof p === "object" &&
                    p !== null &&
                    "state" in p &&
                    p.state === "input-available" &&
                    typeof p.type === "string" &&
                    p.type.startsWith("tool-")
                );
                if (hasIncompleteToolCalls) {
                  // Remove the incomplete assistant message
                  return currentMessages.slice(0, lastAssistantIndex);
                }
              }
              return currentMessages;
            });
            // Early return to skip project title generation when aborted
            return;
          }

          const conversationContext = msgs
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => {
              const textContent = (m.parts ?? [])
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join(" ");
              return textContent ? `${m.role}: ${textContent}` : "";
            })
            .filter(Boolean)
            .join("\n\n");

          // Update recommended actions when agent response is done (conversation text only, no tool results)
          if (conversationContext.trim()) {
            recommendedActionsAbortRef.current?.abort();
            const controller = new AbortController();
            recommendedActionsAbortRef.current = controller;
            getAuthHeaders()
              .then((headers) =>
                fetch("/api/chat/recommended-actions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...headers },
                  body: JSON.stringify({
                    type: "afterResponse",
                    conversationText: conversationContext.trim(),
                  }),
                  signal: controller.signal,
                })
              )
              .then((res) => res.json())
              .then((data) => {
                if (!controller.signal.aborted && Array.isArray(data?.actions))
                  setRecommendedActions(data.actions);
              })
              .catch(() => {});
          }

          if (!conversationContext.trim() || !user?.uid || !projectId) return;
          const name = project?.name ?? "";
          const isDefaultName =
            name === "New Project" || name === "Untitled Project";
          if (!isDefaultName) return;
          try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/generate-project-title", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...headers },
              body: JSON.stringify({ context: conversationContext.trim() }),
            });
            if (!res.ok) return;
            const data = (await res.json()) as {
              accepted?: boolean;
              title?: string;
            };
            if (!data.accepted || !data.title) return;
            updateProjectSettings({ name: data.title });
            await updateProjectInList(projectId, { name: data.title }, user.uid);
          } catch {
            /* ignore */
          }
        },
        [user?.uid, projectId, project?.name, updateProjectSettings, updateProjectInList]
      ),
      onError: useCallback(
        (err: Error) => {
          try {
            const d = JSON.parse(err.message) as { error?: string; required?: number };
            if (typeof d.required === "number") {
              toast.error(d.error ?? "Insufficient credits", {
                description: `Each message uses ${d.required} R‑Credits. Add credits to continue.`,
                action: {
                  label: "Add credits",
                  onClick: () => router.push("/settings/billing"),
                },
              });
            }
          } catch {
            /* ignore */
          }
        },
        [router]
      ),
    });

  useEffect(() => {
    addToolOutputRef.current = addToolOutput as (params: {
      state: "output-error";
      tool: string;
      toolCallId: string;
      errorText: string;
    }) => Promise<void>;
    setMessagesRef.current = setMessages;
  }, [addToolOutput, setMessages]);

  useEffect(() => {
    messagesRef.current = messages ?? [];
  }, [messages]);

  // Recommended actions for empty chat: regenerate when assets change
  const assetsContext = useMemo(() => {
    if (!assets.length) return "";
    return assets
      .map((a) => {
        const meta = assetsMetadata[a.id];
        const parts = [a.name, a.type];
        if (a.description) parts.push(a.description);
        if (meta?.duration != null) parts.push(`${meta.duration.toFixed(1)}s`);
        return parts.join(" • ");
      })
      .join("\n");
  }, [assets, assetsMetadata]);

  const hasNoMessages = !messages?.length;
  useEffect(() => {
    if (!hasNoMessages || !projectId) {
      setRecommendedActionsLoading(false);
      return;
    }
    recommendedActionsAbortRef.current?.abort();
    recommendedActionsDebounceRef.current && clearTimeout(recommendedActionsDebounceRef.current);
    const controller = new AbortController();
    recommendedActionsAbortRef.current = controller;
    setRecommendedActionsLoading(true);
    const DEBOUNCE_MS = 10000;
    recommendedActionsDebounceRef.current = setTimeout(() => {
      recommendedActionsDebounceRef.current = null;
      getAuthHeaders()
        .then((headers) =>
          fetch("/api/chat/recommended-actions", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ type: "empty", assetsContext }),
            signal: controller.signal,
          })
        )
        .then((res) => res.json())
        .then((data) => {
          if (
            !controller.signal.aborted &&
            Array.isArray(data?.actions) &&
            data.actions.length > 0
          ) {
            setRecommendedActions(data.actions);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setRecommendedActionsLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      recommendedActionsDebounceRef.current && clearTimeout(recommendedActionsDebounceRef.current);
      recommendedActionsDebounceRef.current = null;
      controller.abort();
      recommendedActionsAbortRef.current = null;
    };
  }, [hasNoMessages, projectId, assetsContext]);

  autoSaveChatStateRef.current = {
    user: user ?? null,
    sessionId,
    mode,
    messages: messages ?? undefined,
  };
  useAutoSaveChat({
    getState: () => autoSaveChatStateRef.current,
    enabled: !!user,
    intervalMs: 30_000,
    onSaved: useCallback(() => {
      setSaveStatus("success");
      setTimeout(() => setSaveStatus(null), 2000);
    }, []),
  });

  const isBusy = status === "submitted" || status === "streaming" || isCloudProcessing;
  const hasMessages = messages && messages.length > 0;

  const isMissingToolResultsError =
    error?.message?.includes("Tool results are missing") ||
    error?.message?.includes("missing for tool calls");

  const handleDismissError = useCallback(async () => {
    if (isMissingToolResultsError && messages && addToolOutput) {
      for (const message of messages) {
        const parts = Array.isArray(message.parts) ? message.parts : [];
        for (const rawPart of parts) {
          const part = rawPart as ToolPart | null;
          if (
            !part ||
            typeof part !== "object" ||
            part.state !== "input-available" ||
            typeof part.type !== "string" ||
            !part.type.startsWith("tool-") ||
            typeof part.toolCallId !== "string"
          ) {
            continue;
          }
          const toolName = part.type.replace("tool-", "");
          try {
            await addToolOutput({
              state: "output-error",
              tool: toolName as Parameters<typeof addToolOutput>[0]["tool"],
              toolCallId: part.toolCallId,
              errorText: "Cancelled or timed out.",
            });
          } catch {
            // ignore
          }
        }
      }
    }
    clearError?.();
  }, [isMissingToolResultsError, messages, addToolOutput, clearError]);

  // Shared upload for both file input and drop zone
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setIsUploadingAttachments(true);
      try {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        if (projectId) {
          formData.append("projectId", projectId);
        }
        for (const file of files) {
          formData.append("files", file);
        }
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/chat/attachments", {
          method: "POST",
          headers: authHeaders,
          body: formData,
        });
        if (!response.ok) {
          const error = await response.json();
          console.error("Failed to upload attachments:", error);
          return;
        }
        const { attachments } = (await response.json()) as {
          attachments: ChatAttachment[];
        };
        setPendingAttachments((prev) => [...prev, ...attachments]);
      } catch (error) {
        console.error("Failed to upload attachments:", error);
      } finally {
        setIsUploadingAttachments(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [sessionId, projectId]
  );

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      void uploadFiles(Array.from(files));
    },
    [uploadFiles]
  );

  // Full-panel file drop zone (on top of chat so TipTap doesn't intercept)
  const [isChatDropZoneActive, setIsChatDropZoneActive] = useState(false);
  const chatDropZoneDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsChatDropZoneActive(true);
    }
  }, []);
  const chatDropZoneDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsChatDropZoneActive(false);
    }
  }, []);
  const chatDropZoneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsChatDropZoneActive(false);
      const files = e.dataTransfer.files;
      if (files?.length) {
        void uploadFiles(Array.from(files));
      }
    },
    [uploadFiles]
  );

  const removeAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  const taskListSnapshot = useMemo(
    () => deriveTaskListSnapshot(messages),
    [messages]
  );
  const toolboxTools = useMemo(() => toolRegistry.list(), []);
  const clientToolMap = useMemo(() => {
    const entries = new Map<string, ToolDefinition<z.ZodTypeAny, Project>>();
    for (const tool of toolboxTools) {
      if (tool.runLocation === "client") {
        entries.set(tool.name, tool);
      }
    }
    return entries;
  }, [toolboxTools]);
  const handledToolCalls = useRef<Set<string>>(new Set());

  // Auto-scroll to bottom on new messages only when user is already near bottom
  const SCROLL_NEAR_BOTTOM_THRESHOLD = 120;
  useEffect(() => {
    const container = messagesScrollContainerRef.current;
    const end = messagesEndRef.current;
    if (!container || !end) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isNearBottom = distanceFromBottom <= SCROLL_NEAR_BOTTOM_THRESHOLD;
    if (isNearBottom) {
      end.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isBusy]);

  const handleChatSubmit = useCallback((text: string, mentions: AssetMention[]) => {
    const trimmed = text.trim();
    if (!trimmed && pendingAttachments.length === 0 && mentions.length === 0) return;

    if (isCloudMode) {
      // Save and teleport to cloud
      startCloudSession(trimmed || "Please analyze these files.");
    } else {
      // Send to local API
      sendMessage({
        text: trimmed || (pendingAttachments.length > 0 ? "Please analyze these files." : ""),
        metadata: {
          mode,
          attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
          assetMentions: mentions.length > 0 ? mentions : undefined,
        },
      });
    }
    analytics.chatMessageSent();
    setPendingAttachments([]);
    setRecommendedActions([]);
  }, [pendingAttachments, isCloudMode, mode, sendMessage, analytics]);

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Trigger submit via ChatInput ref
    chatInputRef.current?.submit();
  };

  const handleRecommendedActionClick = useCallback((action: string) => {
    chatInputRef.current?.setText(action);
    chatInputRef.current?.focus();
  }, []);

  const handleExportChat = () => {
    if (!messages || messages.length === 0) return;

    const data = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        activeMode: mode,
        taskList: taskListSnapshot,
        messages,
      },
      null,
      2
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load saved sessions list
  const loadSavedSessions = useCallback(async () => {
    if (!user) return;
    setIsLoadingSessions(true);
    try {
      const sessions = await listChatSessions(user.uid);
      setSavedSessions(sessions);
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user]);

  // Load sessions when dropdown is opened
  useEffect(() => {
    if (isSessionDropdownOpen && user) {
      loadSavedSessions();
    }
  }, [isSessionDropdownOpen, user, loadSavedSessions]);

  // Save current session to Firebase
  const handleSaveSession = useCallback(async () => {
    if (!user || !messages || messages.length === 0) return null;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const name = generateSessionName(messages);
      const session = await saveChatSession(
        user.uid,
        sessionId,
        name,
        mode,
        messages
      );
      setSaveStatus("success");
      setTimeout(() => setSaveStatus(null), 2000);
      return session;
    } catch (error) {
      console.error("Failed to save chat session:", error);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 2000);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [user, sessionId, mode, messages]);

  // Load a specific session
  const handleLoadSession = useCallback(
    async (loadSessionId: string) => {
      if (!user || isLoadingSession) return;
      setIsSessionDropdownOpen(false);
      setIsLoadingSession(true);
      try {
        const session = await loadChatSession(user.uid, loadSessionId);
        if (session) {
          // Format the messages correctly
          const loadedMessages = (session.messages || []).map((msg) => ({
            ...msg,
            id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            role: msg.role as "user" | "assistant",
            parts: Array.isArray(msg.parts) ? msg.parts : [],
          })) as TimelineChatMessage[];
          
          // Set initial messages first, then update session ID to trigger hook reinit
          setInitialMessages(loadedMessages);
          setSessionId(session.id);
          setMode(session.currentMode);
          toast.success(`Loaded: ${session.name}`);
        } else {
          toast.error("Session not found");
        }
      } catch (error) {
        console.error("Failed to load chat session:", error);
        toast.error("Failed to load session");
      } finally {
        setIsLoadingSession(false);
      }
    },
    [user, isLoadingSession]
  );

  // Teleport: Save session and send to cloud
  const handleTeleport = useCallback(async () => {
    if (!user || !messages || messages.length === 0) {
      setTeleportStatus({
        type: "error",
        message: "No messages to teleport",
      });
      return;
    }

    setIsTeleporting(true);
    setTeleportStatus(null);

    try {
      // First save the session
      const savedSession = await handleSaveSession();
      if (!savedSession) {
        throw new Error("Failed to save session before teleport");
      }

      // Then call the teleport endpoint
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:8000"}/teleport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: savedSession.id,
            thread_id: savedSession.id,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Teleport failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        setTeleportStatus({
          type: "success",
          message: "Session sent to cloud successfully!",
        });
      } else {
        throw new Error(result.message || "Teleport failed");
      }
    } catch (error) {
      console.error("Teleport failed:", error);
      setTeleportStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Teleport failed",
      });
    } finally {
      setIsTeleporting(false);
      // Clear status after 3 seconds
      setTimeout(() => setTeleportStatus(null), 3000);
    }
  }, [user, messages, handleSaveSession]);

  // Handle speaking a message with TTS
  const handleSpeak = useCallback(
    async (messageId: string, text: string) => {
      // If already speaking this message, stop it
      if (speakingMessageId === messageId) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        setSpeakingMessageId(null);
        return;
      }

      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setIsSpeakLoading(true);
      setSpeakingMessageId(messageId);

      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/speak", {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to generate speech");
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          setSpeakingMessageId(null);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
        };

        audio.onerror = () => {
          setSpeakingMessageId(null);
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          toast.error("Failed to play audio");
        };

        await audio.play();
      } catch (error) {
        console.error("Speak failed:", error);
        toast.error(error instanceof Error ? error.message : "Failed to speak");
        setSpeakingMessageId(null);
      } finally {
        setIsSpeakLoading(false);
      }
    },
    [speakingMessageId]
  );

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Copy message text to clipboard
  const handleCopy = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, []);

  // Start listening to Firebase for real-time cloud agent updates
  const startCloudListener = useCallback(
    (userId: string, chatId: string, currentMessageCount: number) => {
      // Clean up any existing listener
      if (cloudUnsubscribeRef.current) {
        cloudUnsubscribeRef.current();
      }

      const sessionRef = doc(db, "users", userId, "chatSessions", chatId);
      setIsListeningToCloud(true);

      const unsubscribe = onSnapshot(
        sessionRef,
        (snapshot) => {
          if (!snapshot.exists()) return;

          const data = snapshot.data();
          const firebaseMessages = data?.messages || [];
          const agentStatus = data?.agentStatus ?? null;
          setCloudAgentStatus(agentStatus);

          // Only update if there are new messages from the cloud
          if (firebaseMessages.length > currentMessageCount) {
            console.log(
              `[Cloud] Received ${firebaseMessages.length - currentMessageCount} new message(s)`
            );

            // Convert Firebase messages to our format
            const newMessages = firebaseMessages.map(
              (msg: any) => ({
                id: msg.id,
                role: msg.role as "user" | "assistant",
                parts: msg.parts,
              })
            );

            setMessages(newMessages);
            setIsCloudProcessing(false);
          }
        },
        (error) => {
          console.error("[Cloud] Listener error:", error);
          setIsListeningToCloud(false);
        }
      );

      cloudUnsubscribeRef.current = unsubscribe;
    },
    [setMessages]
  );

  // Stop listening to cloud updates
  const stopCloudListener = useCallback(() => {
    if (cloudUnsubscribeRef.current) {
      cloudUnsubscribeRef.current();
      cloudUnsubscribeRef.current = null;
    }
    setIsListeningToCloud(false);
    setCloudAgentStatus(null);
  }, []);

  // Stop: abort cloud teleport if processing (fetch catch will add "Stopped."), otherwise stop local chat
  const handleStop = useCallback(() => {
    if (isCloudProcessing) {
      teleportAbortRef.current?.abort();
      setIsCloudProcessing(false);
      setCloudAgentStatus(null);
    } else {
      // Immediately clean up any pending tool calls before stopping
      if (setMessagesRef.current && messages) {
        setMessagesRef.current((currentMessages) => {
          // Find and remove the last assistant message if it has incomplete tool calls
          const lastAssistantIndex = currentMessages.length - 1;
          if (lastAssistantIndex >= 0 && currentMessages[lastAssistantIndex]?.role === "assistant") {
            const lastMessage = currentMessages[lastAssistantIndex];
            const parts = Array.isArray(lastMessage.parts) ? lastMessage.parts : [];
            const hasIncompleteToolCalls = parts.some(
              (p) =>
                typeof p === "object" &&
                p !== null &&
                "state" in p &&
                p.state === "input-available" &&
                typeof p.type === "string" &&
                p.type.startsWith("tool-")
            );
            if (hasIncompleteToolCalls) {
              // Remove the incomplete assistant message
              return currentMessages.slice(0, lastAssistantIndex);
            }
          }
          return currentMessages;
        });
      }
      stop?.();
    }
  }, [isCloudProcessing, stop, messages]);

  // Start a new chat session
  const handleNewChat = useCallback(() => {
    // Clear initial messages and generate new session ID (triggers useChat reinit)
    setInitialMessages([]);
    setSessionId(`chat-${Date.now()}`);
    // Clear pending attachments
    setPendingAttachments([]);
    // Clear input
    chatInputRef.current?.clear();
    // Stop any cloud listener
    stopCloudListener();
  }, [stopCloudListener]);

  // Cleanup cloud listener on unmount
  useEffect(() => {
    return () => {
      if (cloudUnsubscribeRef.current) {
        cloudUnsubscribeRef.current();
      }
    };
  }, []);

  // Start a cloud session - add message, save, then teleport in background and listen for updates
  const startCloudSession = useCallback(
    async (text: string) => {
      if (!text.trim() || !user) return;

      // Interrupt any in-flight teleport for this session (server will cancel previous run)
      teleportAbortRef.current?.abort();
      teleportAbortRef.current = new AbortController();
      const signal = teleportAbortRef.current.signal;

      setIsCloudProcessing(true);
      setCloudAgentStatus(null);

      // Add user message to local state
      const userMessage = {
        id: `msg-${Date.now()}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text }],
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        // Save session with the new message
        const name = text.length > 50 ? text.substring(0, 47) + "..." : text;
        const updatedMessages = [...(messages || []), userMessage];
        const session = await saveChatSession(user.uid, sessionId, name, mode, updatedMessages);

        // Add "processing" message and start listening before calling teleport so user sees progress immediately
        const processingMessage = {
          id: `msg-${Date.now()}-processing`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "Cloud agent is processing your request..." }],
        };
        setMessages((prev) => [...prev, processingMessage]);
        startCloudListener(user.uid, session.id, updatedMessages.length);
        setIsCloudMode(false);

        // Teleport in background; listener will update messages and clear processing when agent responds
        fetch(
          `${process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:8000"}/teleport`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: session.id, thread_id: session.id }), signal }
        )
          .then((response) => {
            if (!response.ok) throw new Error(`Teleport failed: ${response.status}`);
            return response.json();
          })
          .catch((err) => {
            if (err.name === "AbortError") {
              setIsCloudProcessing(false);
              setMessages((prev) =>
                prev.filter((m) => !m.id?.endsWith("-processing")).concat({
                  id: `msg-${Date.now()}-stopped`,
                  role: "assistant" as const,
                  parts: [{ type: "text" as const, text: "Stopped." }],
                })
              );
              return;
            }
            console.error("Cloud session failed:", err);
            setIsCloudProcessing(false);
            const errorMessage = {
              id: `msg-${Date.now()}-error`,
              role: "assistant" as const,
              parts: [{ type: "text" as const, text: `Failed to create cloud session: ${error instanceof Error ? error.message : "Unknown error"}` }],
            };
            setMessages((prev) => [...prev, errorMessage]);
          });
      } catch (error) {
        console.error("Cloud session failed:", error);
        setIsCloudProcessing(false);
        const errorMessage = {
          id: `msg-${Date.now()}-error`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: `Failed to create cloud session: ${error instanceof Error ? error.message : "Unknown error"}` }],
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    },
    [user, sessionId, mode, messages, setMessages, startCloudListener]
  );

  const submitClientToolResult = useCallback(
    async (payload: { toolCallId: string; result: ToolExecutionResult }) => {
      await fetch("/api/chat/tool-callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    },
    []
  );

  const runClientToolForCall = useCallback(
    async (options: {
      toolName: string;
      toolCallId: string;
      input: Record<string, unknown>;
    }) => {
      try {
        const result = await executeTool({
          toolName: options.toolName,
          input: options.input,
          context: { project, projectId: projectId ?? undefined },
        });
        // Surface agent-started video effect jobs in the Jobs tab
        if (
          options.toolName === "applyVideoEffectToClip" &&
          result.status === "success" &&
          result.outputs?.length
        ) {
          const jsonOutput = result.outputs.find((o) => o.type === "json");
          if (
            jsonOutput &&
            "data" in jsonOutput &&
            jsonOutput.data &&
            typeof jsonOutput.data === "object" &&
            "id" in jsonOutput.data &&
            "assetId" in jsonOutput.data
          ) {
            useVideoEffectsStore.getState().upsertJob(jsonOutput.data as VideoEffectJob);
          }
        }
        await submitClientToolResult({
          toolCallId: options.toolCallId,
          result,
        });
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Client tool execution failed.");
        await submitClientToolResult({
          toolCallId: options.toolCallId,
          result: {
            status: "error",
            error: err.message,
          },
        });
      }
    },
    [project, projectId, submitClientToolResult]
  );

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    for (const message of messages) {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      for (const rawPart of parts) {
        const part = rawPart as ToolPart | null;
        if (
          !part ||
          typeof part !== "object" ||
          typeof part.type !== "string" ||
          !part.type.startsWith("tool-") ||
          part.state !== "input-available" ||
          typeof part.toolCallId !== "string"
        ) {
          continue;
        }
        const toolName = part.type.replace("tool-", "");
        if (!clientToolMap.has(toolName)) continue;
        if (handledToolCalls.current.has(part.toolCallId)) continue;
        handledToolCalls.current.add(part.toolCallId);
        void runClientToolForCall({
          toolName,
          toolCallId: part.toolCallId,
          input: (part.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }, [messages, clientToolMap, runClientToolForCall]);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOverCapture={chatDropZoneDragOver}
      onDragLeaveCapture={chatDropZoneDragLeave}
      onDropCapture={chatDropZoneDrop}
    >
      {/* File drop zone overlay — on top of entire chat so TipTap doesn't intercept */}
      {isChatDropZoneActive && (
        <div
          className="absolute inset-0 z-[100] flex min-h-full min-w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10"
          onDragOver={chatDropZoneDragOver}
          onDragLeave={chatDropZoneDragLeave}
          onDrop={chatDropZoneDrop}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <Paperclip className="size-10 text-primary" />
            <p className="text-sm font-medium text-foreground">Drop files to attach</p>
            <p className="text-xs text-muted-foreground">Images, video, audio, PDF, or text</p>
          </div>
        </div>
      )}
      {/* Messages Area + floating recommended actions */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <div ref={messagesScrollContainerRef} className="flex-1 overflow-y-auto">
          {/* Task List (sticky at top when present) */}
          {taskListSnapshot && (
            <div className="sticky top-0 z-10 p-3 bg-gradient-to-b from-card via-card to-transparent pb-6">
              <TaskListPanel
                snapshot={taskListSnapshot}
                open={isTaskPanelOpen}
                onOpenChange={setIsTaskPanelOpen}
              />
            </div>
          )}

          <div className="px-3 pt-4 pb-3 pb-28 space-y-3">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="size-14 rounded-full bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 flex items-center justify-center mb-3">
                <img src="/gemini-logo.png" alt="Gemini" className="size-8" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                How can I help?
              </p>
              <p className="text-xs text-muted-foreground max-w-[200px] mb-6">
                Ask about your project, generate content, or let me help edit
                your timeline.
              </p>
              {recommendedActionsLoading && recommendedActions.length === 0 && (
                <div className="w-full max-w-md grid grid-cols-1 gap-3 px-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton
                      key={i}
                      className="h-14 w-full rounded-xl"
                    />
                  ))}
                </div>
              )}
              <AnimatePresence>
                {recommendedActions.length > 0 && (
                  <motion.div
                    className="w-full max-w-md grid grid-cols-1 gap-3 px-2"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      visible: {
                        transition: { staggerChildren: 0.06, delayChildren: 0.08 },
                      },
                      hidden: {},
                    }}
                  >
                    {recommendedActions.slice(0, 4).map((action) => (
                      <motion.button
                        key={action}
                        type="button"
                        onClick={() => handleRecommendedActionClick(action)}
                        className="rounded-xl px-5 py-4 text-base font-medium text-foreground bg-muted/50 hover:bg-muted border border-border/50 hover:border-border text-left transition-colors shadow-sm hover:shadow"
                        title={action}
                        variants={{
                          hidden: { opacity: 0, y: 10 },
                          visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                      >
                        {action}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {messages?.map((message) => {
            const parts = Array.isArray(message.parts) ? message.parts : [];
            const isUser = message.role === "user";
            const metadata = message.metadata as {
              attachments?: ChatAttachment[];
              assetMentions?: AssetMention[];
            } | undefined;
            const attachments = metadata?.attachments;
            const assetMentions = metadata?.assetMentions;
            
            // Extract text content for TTS
            const textContent = parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text" && "text" in p && typeof p.text === "string")
              .map((p) => p.text)
              .join("\n");
            const canSpeak = !isUser && textContent.length > 0;
            const isSpeaking = speakingMessageId === message.id;
            
            return (
              <div
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60"
                  )}
                >
                  {/* Show attachments first */}
                  {attachments && attachments.length > 0 && (
                    <MessageAttachments attachments={attachments} isUser={isUser} />
                  )}
                  {parts.map((part, index) => {
                    const content = renderMessagePart(
                      part,
                      `${message.id}-${index}`,
                      isUser,
                      assetMentions
                    );
                    if (!content) return null;
                    return (
                      <div
                        key={`${message.id}-${index}`}
                        className={cn(
                          part.type === "reasoning" &&
                            "text-xs opacity-70 italic mb-2"
                        )}
                      >
                        {content}
                      </div>
                    );
                  })}
                  {/* Copy and speak buttons for assistant messages */}
                  {canSpeak && (
                    <div className="flex justify-end items-center gap-0.5 mt-1.5 -mb-0.5">
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, textContent)}
                        className={cn(
                          "p-1 rounded-md transition-colors",
                          copiedMessageId === message.id
                            ? "text-emerald-500 bg-emerald-500/10"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        title={copiedMessageId === message.id ? "Copied!" : "Copy to clipboard"}
                      >
                        {copiedMessageId === message.id ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSpeak(message.id, textContent)}
                        disabled={isSpeakLoading && !isSpeaking}
                        className={cn(
                          "p-1 rounded-md transition-colors",
                          isSpeaking
                            ? "text-primary bg-primary/10 hover:bg-primary/20"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          isSpeakLoading && !isSpeaking && "opacity-50 cursor-not-allowed"
                        )}
                        title={isSpeaking ? "Stop speaking" : "Speak this message"}
                      >
                        {isSpeakLoading && speakingMessageId === message.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : isSpeaking ? (
                          <VolumeX className="size-3.5" />
                        ) : (
                          <Volume2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isBusy && (
            <div className="flex justify-start">
              <div className={cn(
                "rounded-2xl px-3 py-2",
                isCloudProcessing ? "bg-blue-500/10" : "bg-muted/60"
              )}>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin shrink-0" />
                  <span>
                    {isCloudProcessing && cloudAgentStatus
                      ? <span className="italic">{cloudAgentStatus}</span>
                      : isCloudProcessing
                        ? "Cloud processing..."
                        : "Thinking..."}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        </div>

        {/* Floating recommended actions at bottom of chat list (only when chat has messages) */}
        <AnimatePresence>
          {recommendedActions.length > 0 && hasMessages && (
            <motion.div
              key="recommended-actions-bar"
              className="absolute bottom-0 left-0 right-0 pt-8 pb-1.5 px-2 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="pointer-events-auto pb-4 overflow-x-auto overflow-y-hidden">
                <motion.div
                  className="flex items-center gap-1.5 justify-start flex-nowrap w-max min-w-full"
                  variants={{
                    visible: {
                      transition: { staggerChildren: 0.03, delayChildren: 0.04 },
                    },
                    hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  {recommendedActions.map((action) => (
                    <motion.button
                      key={action}
                      type="button"
                      onClick={() => handleRecommendedActionClick(action)}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground/90 hover:text-foreground bg-muted/40 hover:bg-muted/80 backdrop-blur-sm transition-colors text-left whitespace-nowrap max-w-[160px] truncate"
                      title={action}
                      variants={{
                        hidden: { opacity: 0, y: 4, scale: 0.96 },
                        visible: { opacity: 1, y: 0, scale: 1 },
                      }}
                      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    >
                      {action}
                    </motion.button>
                  ))}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate">{error.message ?? "Something went wrong"}</p>
            <button
              type="button"
              className="shrink-0 font-medium hover:underline"
              onClick={() => void handleDismissError()}
            >
              {isMissingToolResultsError ? "Dismiss and remove pending tools" : "Dismiss"}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-border p-3 space-y-2">
        {/* Mode Selector + Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  disabled={isCloudMode}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    mode === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    isCloudMode && "opacity-50 cursor-not-allowed"
                  )}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {/* Cloud Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsCloudMode(!isCloudMode)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                isCloudMode
                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
              title={isCloudMode ? "Using Cloud Agent" : "Click to use Cloud Agent"}
            >
              <Cloud className="size-3.5" />
              {isCloudMode ? "Cloud" : "Local"}
            </button>
            {isListeningToCloud && (
              <span className="flex items-center gap-1 text-xs text-blue-500">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Listening
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* New Chat Button */}
            <button
              onClick={handleNewChat}
              disabled={isBusy}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
              title="New chat"
            >
              <Plus className="size-4" />
            </button>
            {/* Sessions Dropdown */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setIsSessionDropdownOpen(!isSessionDropdownOpen)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  title="Load saved chat"
                >
                  <History className="size-4" />
                </button>
                {isSessionDropdownOpen && (
                  <div className="absolute right-0 bottom-full mb-1 w-64 rounded-lg border border-border bg-card shadow-lg z-50">
                    <div className="p-2 border-b border-border">
                      <p className="text-xs font-medium text-muted-foreground">
                        Saved Sessions
                      </p>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {isLoadingSessions ? (
                        <div className="p-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          Loading...
                        </div>
                      ) : savedSessions.length === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          No saved sessions
                        </div>
                      ) : (
                        savedSessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            disabled={isLoadingSession}
                            onClick={() => {
                              handleLoadSession(session.id);
                            }}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                          >
                            <p className="font-medium truncate">{session.name}</p>
                            <p className="text-muted-foreground">
                              {session.messageCount} messages
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Save Button */}
            {user && (
              <button
                onClick={handleSaveSession}
                disabled={!hasMessages || isSaving}
                className={cn(
                  "p-1.5 rounded-md transition-colors disabled:opacity-50",
                  saveStatus === "success"
                    ? "text-emerald-500 bg-emerald-500/10"
                    : saveStatus === "error"
                      ? "text-destructive bg-destructive/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Save chat session"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : saveStatus === "success" ? (
                  <Check className="size-4" />
                ) : saveStatus === "error" ? (
                  <X className="size-4" />
                ) : (
                  <Save className="size-4" />
                )}
              </button>
            )}
            {/* Teleport Button */}
            {user && (
              <button
                onClick={handleTeleport}
                disabled={!hasMessages || isTeleporting}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  teleportStatus?.type === "success"
                    ? "text-emerald-500 bg-emerald-500/10"
                    : teleportStatus?.type === "error"
                      ? "text-destructive bg-destructive/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  "disabled:opacity-50"
                )}
                title="Teleport: Send this chat session to the cloud to continue on another device"
              >
                {isTeleporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : teleportStatus?.type === "success" ? (
                  <Check className="size-4" />
                ) : teleportStatus?.type === "error" ? (
                  <AlertCircle className="size-4" />
                ) : (
                  <CloudUpload className="size-4" />
                )}
              </button>
            )}
            {/* Export Button */}
            <button
              onClick={handleExportChat}
              disabled={!hasMessages}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
              title="Export chat"
            >
              <Download className="size-4" />
            </button>
          </div>
        </div>

        {/* Teleport Status Message */}
        {teleportStatus && (
          <div
            className={cn(
              "text-xs px-2 py-1 rounded",
              teleportStatus.type === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {teleportStatus.message}
          </div>
        )}

        {/* Pending Attachments Preview */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {pendingAttachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}

        {/* Message Input */}
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || isUploadingAttachments}
            className="shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Attach files"
          >
            {isUploadingAttachments ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </button>

          <ChatInput
            ref={chatInputRef}
            projectId={projectId}
            submitDisabled={isBusy}
            placeholder={
              (pendingAttachments.length > 0
                ? "Add a message or send files..."
                : mode === "ask"
                  ? "Ask a question..."
                  : mode === "plan"
                    ? "Describe what to plan..."
                    : "What would you like to do?") +
              " — Type @ to add assets or drag them here. Enter to send, Shift+Enter for new line"
            }
            onSubmit={handleChatSubmit}
            onContentChange={setHasInputContent}
          />
          {isBusy ? (
            <button
              type="button"
              onClick={handleStop}
              className="shrink-0 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-destructive hover:bg-destructive/20 transition-colors"
              title="Stop"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!hasInputContent && pendingAttachments.length === 0}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="size-4" />
            </button>
          )}
        </form>

        {/* Powered by branding and credits */}
        <div className="flex items-center justify-center gap-1.5 pt-2 pb-1 text-[11px] text-muted-foreground">
          <span className="text-muted-foreground">Powered by</span>
          <div className="flex items-center gap-1">
            <img src="/gemini-logo.png" alt="Gemini" className="size-3.5" />
            <span className="font-medium text-foreground">Gemini 3 Pro</span>
          </div>
          <span aria-hidden className="text-muted-foreground/60">·</span>
          <span>
            Each message uses{" "}
            <span className="font-medium tabular-nums text-foreground">{chatCredits}</span>{" "}
            R‑Credits
          </span>
        </div>
      </div>
    </div>
  );
}

type MessagePart = {
  type?: string;
  reasoning?: string;
  text?: string;
  [key: string]: unknown;
};

type MentionDisplay = {
  label: string;
  assetId?: string;
  assetType: string;
  url?: string;
  thumbnailUrl?: string;
  description?: string;
};

type MessageToken =
  | { type: "text"; text: string }
  | { type: "mention"; data: MentionDisplay }
  | { type: "url"; url: string };

type AssetLookupFn = (name: string) => {
  id: string;
  name?: string | null;
  type?: string | null;
} | null;

function stripMentionPrefix(value: string) {
  if (!value) return value;
  return value.startsWith("@") ? value.slice(1) : value;
}

function resolveMentionDisplay(
  rawLabel: string,
  meta: AssetMention | null,
  mentionLookup: Map<string, AssetMention>,
  findAssetByName: AssetLookupFn
): MentionDisplay {
  const normalized = stripMentionPrefix(rawLabel.trim());
  const lower = normalized.toLowerCase();
  const metaSource =
    meta ??
    mentionLookup.get(normalized) ??
    mentionLookup.get(lower) ??
    null;
  const asset = findAssetByName(normalized);
  const assetId = metaSource?.id ?? asset?.id ?? undefined;
  const assetType = metaSource?.type ?? asset?.type ?? "other";
  const label =
    metaSource?.name ??
    asset?.name ??
    normalized ??
    rawLabel.replace(/^@/, "");

  return {
    label: label || normalized || rawLabel,
    assetId,
    assetType,
    url: metaSource?.url,
    thumbnailUrl: metaSource?.thumbnailUrl,
    description: metaSource?.description,
  };
}

function expandFallbackMentions(
  tokens: MessageToken[],
  mentionLookup: Map<string, AssetMention>,
  findAssetByName: AssetLookupFn
): MessageToken[] {
  const expanded: MessageToken[] = [];

  for (const token of tokens) {
    if (token.type === "mention" || token.type === "url") {
      expanded.push(token);
      continue;
    }

    const segment = token.text;
    if (!segment) {
      expanded.push(token);
      continue;
    }

    let lastIndex = 0;
    const regex = new RegExp(MENTION_TOKEN_REGEX.source, "g");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(segment)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      if (start > lastIndex) {
        expanded.push({
          type: "text",
          text: segment.slice(lastIndex, start),
        });
      }

      const label = match[1] ?? "";
      if (label.length === 0) {
        expanded.push({
          type: "text",
          text: match[0],
        });
      } else {
        expanded.push({
          type: "mention",
          data: resolveMentionDisplay(
            label,
            mentionLookup.get(label) ?? mentionLookup.get(label.toLowerCase()) ?? null,
            mentionLookup,
            findAssetByName
          ),
        });
      }

      lastIndex = end;
    }

    if (lastIndex < segment.length) {
      expanded.push({
        type: "text",
        text: segment.slice(lastIndex),
      });
    }
  }

  return expanded;
}

function buildMessageTokens(
  text: string,
  assetMentions: AssetMention[] | undefined,
  findAssetByName: AssetLookupFn
): MessageToken[] {
  if (!text) return [];

  const mentionLookup = new Map<string, AssetMention>();
  for (const mention of assetMentions ?? []) {
    if (mention.name) {
      mentionLookup.set(mention.name, mention);
      mentionLookup.set(mention.name.toLowerCase(), mention);
    }
    if (mention.plainText) {
      const stripped = stripMentionPrefix(mention.plainText);
      if (stripped) {
        mentionLookup.set(stripped, mention);
        mentionLookup.set(stripped.toLowerCase(), mention);
      }
    }
  }

  const length = text.length;
  const sortedMentions = (assetMentions ?? [])
    .filter(
      (mention): mention is AssetMention & { start: number; end: number } =>
        typeof mention.start === "number" &&
        typeof mention.end === "number" &&
        mention.end > mention.start
    )
    .sort((a, b) => a.start - b.start);

  const tokens: MessageToken[] = [];
  let cursor = 0;

  const clampIndex = (value: number) =>
    Math.max(0, Math.min(length, value));

  for (const mention of sortedMentions) {
    const start = clampIndex(mention.start);
    const end = clampIndex(mention.end);
    if (end <= start || start < cursor) continue;

    if (start > cursor) {
      tokens.push({
        type: "text",
        text: text.slice(cursor, start),
      });
    }

    const raw = mention.plainText ?? text.slice(start, end);
    const resolved = resolveMentionDisplay(
      raw || mention.name || "",
      mention,
      mentionLookup,
      findAssetByName
    );
    tokens.push({ type: "mention", data: resolved });

    cursor = end;
  }

  if (cursor < length) {
    tokens.push({
      type: "text",
      text: text.slice(cursor),
    });
  }

  return expandUrlTokens(
    expandFallbackMentions(tokens, mentionLookup, findAssetByName)
  );
}

/** Matches http(s) URLs in plain text for chip display (same as link-extension intent). */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s<>"']+/g;

function expandUrlTokens(tokens: MessageToken[]): MessageToken[] {
  const result: MessageToken[] = [];
  for (const token of tokens) {
    if (token.type !== "text") {
      result.push(token);
      continue;
    }
    const segment = token.text;
    if (!segment) {
      result.push(token);
      continue;
    }
    let lastIndex = 0;
    const regex = new RegExp(URL_IN_TEXT_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(segment)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        result.push({ type: "text", text: segment.slice(lastIndex, start) });
      }
      result.push({ type: "url", url: match[0] });
      lastIndex = end;
    }
    if (lastIndex < segment.length) {
      result.push({ type: "text", text: segment.slice(lastIndex) });
    }
  }
  return result;
}

function MessageTextContent({
  text,
  assetMentions,
}: {
  text: string;
  assetMentions?: AssetMention[];
}) {
  const findByName = useAssetsStore((s) => s.findByName);
  const getAssetById = useAssetsStore((s) => s.getAssetById);

  const elements = useMemo(() => {
    const tokens = buildMessageTokens(
      text,
      assetMentions,
      (name) => findByName(name) ?? null
    );

    if (tokens.length === 0) {
      return [<span key="text-0">{text}</span>];
    }

    let keyCounter = 0;
    return tokens
      .map((token) => {
        if (token.type === "text") {
          keyCounter += 1;
          return token.text.length > 0 ? (
            <span key={`text-${keyCounter}`}>{token.text}</span>
          ) : null;
        }

        if (token.type === "url") {
          keyCounter += 1;
          const href = token.url;
          const displayUrl = href.length > 48 ? `${href.slice(0, 45)}…` : href;
          const isYoutube = isYouTubeUrl(href);
          const UrlIcon = isYoutube ? SiYoutube : ExternalLink;
          return (
            <a
              key={`url-${keyCounter}`}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium no-underline transition-colors",
                isYoutube
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40 hover:border-red-500/50"
                  : "bg-primary/20 text-primary-foreground hover:bg-primary/30 border border-primary/40 hover:border-primary/50"
              )}
              title={href}
            >
              <UrlIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate max-w-[200px]">{displayUrl}</span>
            </a>
          );
        }

        const { className, Icon } = getMentionAppearance(token.data.assetType);
        const baseClass = cn(
          "mention-chip",
          className,
          token.data.assetId &&
            "cursor-pointer hover:opacity-90 transition-opacity"
        );
        const chipContent = (
          <>
            <Icon className="mention-chip-icon" aria-hidden="true" />
            <span className="mention-chip-label">@{token.data.label}</span>
          </>
        );

        const typeLabel =
          token.data.assetType === "other"
            ? "Asset"
            : (token.data.assetType as string).charAt(0).toUpperCase() +
              (token.data.assetType as string).slice(1);
        const fullAsset = token.data.assetId
          ? getAssetById(token.data.assetId)
          : undefined;
        const isImage =
          token.data.assetType === "image" ||
          fullAsset?.type === "image";
        const thumbUrl =
          isImage &&
          (token.data.thumbnailUrl ??
            token.data.url ??
            fullAsset?.thumbnailUrl ??
            fullAsset?.url);
        const description =
          token.data.description ?? fullAsset?.description ?? undefined;
        const notes = fullAsset?.notes;
        const formatBytes = (n: number) =>
          n >= 1024 * 1024
            ? `${(n / (1024 * 1024)).toFixed(1)} MB`
            : n >= 1024
              ? `${(n / 1024).toFixed(1)} KB`
              : `${n} B`;
        const formatDuration = (s: number) => {
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
        };
        const formatDate = (iso: string) => {
          try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
            });
          } catch {
            return "";
          }
        };

        const preview = (
          <div className="mention-preview max-w-[280px] rounded-md border border-zinc-700/60 bg-zinc-900 p-2">
            {thumbUrl && (
              <div className="mention-preview-media mb-2 rounded overflow-hidden bg-zinc-800">
                <img
                  src={thumbUrl}
                  alt=""
                  className="h-14 w-full object-cover object-center"
                />
              </div>
            )}
            <div className="font-medium text-zinc-100 truncate">
              {token.data.label}
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">{typeLabel}</div>

            {description && (
              <div className="mt-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
                  Description
                </div>
                <p className="text-xs text-zinc-400 line-clamp-4">
                  {description}
                </p>
              </div>
            )}

            {notes && (
              <div className="mt-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
                  Notes
                </div>
                <p className="text-xs text-zinc-400 line-clamp-2">
                  {notes}
                </p>
              </div>
            )}

            {(fullAsset || token.data.assetId) && (
              <div className="mt-2 pt-2 border-t border-zinc-700/60 space-y-1">
                {fullAsset?.size != null && (
                  <div className="text-[11px] text-zinc-500">
                    Size: {formatBytes(fullAsset.size)}
                  </div>
                )}
                {fullAsset?.duration != null && fullAsset.duration > 0 && (
                  <div className="text-[11px] text-zinc-500">
                    Duration: {formatDuration(fullAsset.duration)}
                  </div>
                )}
                {fullAsset?.uploadedAt && (
                  <div className="text-[11px] text-zinc-500">
                    Uploaded: {formatDate(fullAsset.uploadedAt)}
                  </div>
                )}
                {fullAsset?.width != null &&
                  fullAsset?.height != null && (
                    <div className="text-[11px] text-zinc-500">
                      {fullAsset.width} × {fullAsset.height}
                    </div>
                  )}
                {token.data.assetId && (
                  <div className="text-[10px] text-zinc-600 font-mono truncate">
                    ID: {token.data.assetId.slice(0, 8)}…
                  </div>
                )}
              </div>
            )}
          </div>
        );

        keyCounter += 1;
        if (token.data.assetId) {
          const assetId = token.data.assetId;
          return (
            <Tooltip key={`mention-${keyCounter}-${assetId}`} delayDuration={400}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={baseClass}
                  onClick={() => requestAssetHighlight(assetId)}
                  title="Locate in Assets"
                  data-source="message"
                  data-mention-id={assetId}
                  data-mention-name={token.data.label}
                  data-asset-type={token.data.assetType}
                >
                  {chipContent}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="p-0 border-0">
                {preview}
              </TooltipContent>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={`mention-${keyCounter}`} delayDuration={400}>
            <TooltipTrigger asChild>
              <span
                className={baseClass}
                data-source="message"
                data-mention-name={token.data.label}
                data-asset-type={token.data.assetType}
              >
                {chipContent}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="p-0 border-0">
              {preview}
            </TooltipContent>
          </Tooltip>
        );
      })
      .filter(Boolean);
  }, [text, assetMentions, findByName, getAssetById]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="message-mention-text whitespace-pre-wrap">
        {elements}
      </div>
    </TooltipProvider>
  );
}

function renderMessagePart(
  part: MessagePart,
  key: string,
  isUser: boolean,
  assetMentions?: AssetMention[]
) {
  if (!part || typeof part !== "object") {
    return null;
  }

  if (part.type === "text") {
    if (!part.text) return null;
    // For user messages, render with mention chips (type-colored, with symbols)
    if (isUser) {
      return (
        <MessageTextContent text={part.text} assetMentions={assetMentions} />
      );
    }
    return (
      <div
        className={cn(
          "prose prose-sm max-w-none",
          !isUser && "chat-assistant-prose overflow-hidden",
          isUser && "prose-invert"
        )}
      >
        <MemoizedMarkdown id={`${key}-text`} content={part.text} />
      </div>
    );
  }

  if (part.type === "reasoning" || part.type === "thinking") {
    if (!part.reasoning && !part.text) return null;
    return (
      <MemoizedMarkdown
        id={`${key}-reasoning`}
        content={part.reasoning ?? part.text ?? ""}
      />
    );
  }

  if (part.type === "step-start") {
    return null;
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return renderToolPart(part as unknown as ToolPart);
  }

  return null;
}

function renderToolPart(part: ToolPart) {
  const label = resolveToolLabel(part.type);

  if (
    part.state === "output-available" &&
    typeof part.type === "string" &&
    part.type.startsWith("tool-plan") &&
    isPlanningToolOutput(part.output)
  ) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
        <ListTodo className="size-3.5" />
        <span>Updated task list</span>
      </div>
    );
  }

  switch (part.state) {
    case "input-streaming":
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
          <Loader2 className="size-3 animate-spin" />
          <span>{label}...</span>
        </div>
      );
    case "input-available":
      return (
        <ToolCallCard label={label} status="running" input={part.input} />
      );
    case "output-available":
      return (
        <ToolCallCard
          label={label}
          status="success"
          input={part.input}
          output={part.output}
        />
      );
    case "output-error":
      return (
        <ToolCallCard
          label={label}
          status="error"
          input={part.input}
          error={part.errorText}
        />
      );
    case "approval-requested":
      return (
        <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 py-1">
          <span>{label}: approval required</span>
        </div>
      );
    default:
      return null;
  }
}

function ToolCallCard({
  label,
  status,
  input,
  output,
  error,
}: {
  label: string;
  status: "running" | "success" | "error";
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}) {
  // Check if the output contains code diffs (ToolExecutionResult with code outputs)
  const hasCodeOutput = useMemo(() => {
    if (!output || !isToolExecutionResult(output)) return false;
    const outputs = (output as { outputs?: unknown[] }).outputs;
    if (!Array.isArray(outputs)) return false;
    return outputs.some(
      (o) => typeof o === "object" && o !== null && (o as Record<string, unknown>).type === "code"
    );
  }, [output]);

  // Auto-expand when output has code diffs
  const [expanded, setExpanded] = useState(hasCodeOutput);
  useEffect(() => {
    if (hasCodeOutput) setExpanded(true);
  }, [hasCodeOutput]);

  // Build a summary-friendly version of input (truncate long code fields)
  const inputSummary = useMemo(() => {
    if (!input || Object.keys(input).length === 0) return null;
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        (key === "code" || key === "oldCode") &&
        typeof value === "string" &&
        value.length > 120
      ) {
        summary[key] = `[${value.split("\n").length} lines]`;
      } else {
        summary[key] = value;
      }
    }
    return summary;
  }, [input]);

  // Extract code outputs to render at the top level (not inside the collapsed output section)
  const { codeOutputs, otherOutputs } = useMemo(() => {
    if (!output || !isToolExecutionResult(output) || (output as { status: string }).status !== "success") {
      return { codeOutputs: [] as Record<string, unknown>[], otherOutputs: output };
    }
    const outputs = ((output as { outputs?: unknown[] }).outputs ?? []) as Record<string, unknown>[];
    const code = outputs.filter((o) => o.type === "code");
    const other = outputs.filter((o) => o.type !== "code");
    return {
      codeOutputs: code,
      otherOutputs: other.length > 0
        ? { status: "success", outputs: other }
        : null,
    };
  }, [output]);

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-background/80 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 transition-colors text-left"
      >
        {status === "running" && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        {status === "success" && (
          <div className="size-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <div className="size-1.5 rounded-full bg-emerald-500" />
          </div>
        )}
        {status === "error" && (
          <div className="size-3.5 rounded-full bg-destructive/20 flex items-center justify-center">
            <div className="size-1.5 rounded-full bg-destructive" />
          </div>
        )}
        <span className="font-medium flex-1 truncate">{label}</span>
        {expanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Code diffs rendered prominently outside the collapsed section */}
      {codeOutputs.length > 0 && (
        <div className="border-t border-border/40">
          {codeOutputs.map((entry, idx) => {
            const codeEntry = entry as {
              language?: string;
              filename?: string;
              code?: string;
              oldCode?: string;
              summary?: string;
            };
            if (!codeEntry.code) return null;
            return (
              <CodeToolResultCard
                key={idx}
                language={codeEntry.language ?? "tsx"}
                filename={codeEntry.filename}
                code={codeEntry.code}
                oldCode={codeEntry.oldCode}
                summary={codeEntry.summary}
                defaultExpanded
                onOpenInComponents={(filename) => {
                  const name = filename?.replace(/\.[^.]+$/, "").trim();
                  if (name) requestComponentHighlight({ name });
                }}
              />
            );
          })}
        </div>
      )}

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/40 pt-2">
          {inputSummary && Object.keys(inputSummary).length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Input
              </p>
              <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-auto max-h-32">
                {JSON.stringify(inputSummary, null, 2)}
              </pre>
            </div>
          )}
          {status === "error" && error && (
            <p className="text-destructive">{error}</p>
          )}
          {status === "success" && otherOutputs ? (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Output
              </p>
              <div className="bg-muted/40 rounded p-2 overflow-auto max-h-48">
                {renderToolResultBody(otherOutputs)}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function resolveToolLabel(partType: string) {
  if (partType.startsWith("tool-")) {
    const toolName = partType.replace("tool-", "");
    const definition = toolRegistry.get(toolName);
    if (definition) {
      return definition.label;
    }
  }
  return partType.replace(/^tool-/, "").replace(/-/g, " ");
}

function renderToolResultBody(output: unknown) {
  if (!output)
    return <p className="text-muted-foreground text-[11px]">No output</p>;

  // Handle ToolExecutionResult shape: { status, outputs: [...] }
  if (isToolExecutionResult(output)) {
    if (output.status === "error") {
      return (
        <p className="text-destructive text-[11px]">
          {output.error ?? "Tool execution failed"}
        </p>
      );
    }
    const outputs = output.outputs as Array<Record<string, unknown>>;
    if (!outputs || outputs.length === 0) {
      return <p className="text-muted-foreground text-[11px]">No output</p>;
    }
    return (
      <div className="space-y-2">
        {outputs.map((entry, index) => (
          <div key={index}>{renderToolOutputEntry(entry, index)}</div>
        ))}
      </div>
    );
  }

  if (!isToolResultOutput(output)) {
    return (
      <pre className="text-[11px] overflow-auto">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  switch (output.type) {
    case "text":
      return (
        <div className="prose prose-sm max-w-none text-[11px]">
          <MemoizedMarkdown id="tool-output-text" content={output.value} />
        </div>
      );
    case "json":
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(output.value, null, 2)}
        </pre>
      );
    case "error-text":
    case "execution-denied":
      return (
        <p className="text-destructive text-[11px]">
          {output.type === "error-text"
            ? output.value
            : output.reason ?? "Execution denied"}
        </p>
      );
    case "error-json":
      return (
        <pre className="text-destructive text-[11px] overflow-auto">
          {JSON.stringify(output.value, null, 2)}
        </pre>
      );
    case "content":
      return (
        <div className="space-y-2">
          {output.value.map((entry, index) => (
            <div key={index}>{renderContentEntry(entry, index)}</div>
          ))}
        </div>
      );
    default:
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      );
  }
}

/** Render a single entry from ToolExecutionResult.outputs */
function renderToolOutputEntry(entry: Record<string, unknown>, key: number) {
  if (!entry || typeof entry !== "object" || !entry.type) {
    return (
      <pre className="text-[11px] overflow-auto">
        {JSON.stringify(entry, null, 2)}
      </pre>
    );
  }

  switch (entry.type) {
    case "code": {
      const codeEntry = entry as {
        language?: string;
        filename?: string;
        code?: string;
        oldCode?: string;
        summary?: string;
      };
      if (!codeEntry.code) return null;
      return (
        <CodeToolResultCard
          language={codeEntry.language ?? "tsx"}
          filename={codeEntry.filename}
          code={codeEntry.code}
          oldCode={codeEntry.oldCode}
          summary={codeEntry.summary}
          defaultExpanded
          onOpenInComponents={(filename) => {
            const name = filename?.replace(/\.[^.]+$/, "").trim();
            if (name) requestComponentHighlight({ name });
          }}
        />
      );
    }
    case "text": {
      const text = (entry as { text?: string }).text;
      if (!text) return null;
      // Also check for <!--code:...--> markers (from tool-output-adapter)
      if (text.startsWith("<!--code:")) {
        try {
          const jsonStr = text.slice("<!--code:".length, text.indexOf("-->"));
          const codeData = JSON.parse(jsonStr) as {
            language: string;
            filename?: string;
            code: string;
            oldCode?: string;
            summary?: string;
          };
          return (
            <CodeToolResultCard
              language={codeData.language}
              filename={codeData.filename}
              code={codeData.code}
              oldCode={codeData.oldCode}
              summary={codeData.summary}
              defaultExpanded
              onOpenInComponents={(filename) => {
                const name = filename?.replace(/\.[^.]+$/, "").trim();
                if (name) requestComponentHighlight({ name });
              }}
            />
          );
        } catch {
          // Fall through to markdown
        }
      }
      return (
        <div className="prose prose-sm max-w-none text-[11px]">
          <MemoizedMarkdown id={`tool-exec-output-${key}`} content={text} />
        </div>
      );
    }
    case "json": {
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify((entry as { data?: unknown }).data, null, 2)}
        </pre>
      );
    }
    case "image": {
      const imgEntry = entry as { url?: string; alt?: string };
      if (!imgEntry.url) return null;
      return (
        <img
          src={imgEntry.url}
          alt={imgEntry.alt ?? "Tool output"}
          className="max-h-48 w-auto rounded border border-border/40"
        />
      );
    }
    default:
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(entry, null, 2)}
        </pre>
      );
  }
}

type ContentEntry = Extract<
  ToolResultOutput,
  { type: "content" }
>["value"][number];

function renderContentEntry(entry: ContentEntry, key: number) {
  switch (entry.type) {
    case "text": {
      // Detect code tool output marker
      if (entry.text.startsWith("<!--code:")) {
        try {
          const jsonStr = entry.text.slice("<!--code:".length, entry.text.indexOf("-->"));
          const codeData = JSON.parse(jsonStr) as {
            language: string;
            filename?: string;
            code: string;
            oldCode?: string;
            summary?: string;
          };
          return (
            <CodeToolResultCard
              language={codeData.language}
              filename={codeData.filename}
              code={codeData.code}
              oldCode={codeData.oldCode}
              summary={codeData.summary}
              onOpenInComponents={(filename) => {
                const name = filename?.replace(/\.[^.]+$/, "").trim();
                if (name) requestComponentHighlight({ name });
              }}
            />
          );
        } catch {
          // Fall through to markdown
        }
      }
      return (
        <MemoizedMarkdown id={`tool-output-text-${key}`} content={entry.text} />
      );
    }
    case "image-data": {
      const src = `data:${entry.mediaType};base64,${entry.data}`;
      return (
        <img
          src={src}
          alt="Tool output"
          className="max-h-48 w-auto rounded border border-border/40"
        />
      );
    }
    case "image-url":
      return (
        <img
          src={entry.url}
          alt="Tool output"
          className="max-h-48 w-auto rounded border border-border/40"
        />
      );
    case "file-data": {
      const href = `data:${entry.mediaType};base64,${entry.data}`;
      return (
        <a
          href={href}
          download={entry.filename ?? "download"}
          className="text-primary underline"
        >
          Download {entry.filename ?? "file"}
        </a>
      );
    }
    case "file-url":
      return (
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Download file
        </a>
      );
    case "media": {
      const href = `data:${entry.mediaType};base64,${entry.data}`;
      return <audio controls src={href} className="w-full h-8" />;
    }
    default:
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(entry, null, 2)}
        </pre>
      );
  }
}

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

/** Detect ToolExecutionResult shape: { status: "success"|"error", outputs?: [...] } */
function isToolExecutionResult(
  value: unknown
): value is {
  status: "success" | "error";
  outputs?: unknown[];
  error?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const maybe = value as Record<string, unknown>;
  return (
    (maybe.status === "success" || maybe.status === "error") &&
    (maybe.status === "error" || Array.isArray(maybe.outputs))
  );
}

function deriveTaskListSnapshot(
  messages?: TimelineChatMessage[]
): TaskListSnapshot | null {
  if (!messages) return null;
  let snapshot: TaskListSnapshot | null = null;

  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        typeof part.type === "string" &&
        part.type.startsWith("tool-plan") &&
        (part as ToolPart).state === "output-available" &&
        isPlanningToolOutput((part as ToolPart).output)
      ) {
        snapshot = ((part as ToolPart).output as any).taskList;
      }
    }
  }

  return snapshot;
}

type PlanningToolLikeOutput = {
  action?: string;
  message?: string;
  taskList: TaskListSnapshot;
};

function isPlanningToolOutput(
  value: unknown
): value is PlanningToolLikeOutput {
  if (!value || typeof value !== "object") return false;
  const maybe = value as PlanningToolLikeOutput;
  return (
    typeof maybe === "object" &&
    typeof maybe.taskList === "object" &&
    Array.isArray(maybe.taskList.tasks)
  );
}

function TaskListPanel({
  snapshot,
  open,
  onOpenChange,
}: {
  snapshot: TaskListSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = snapshot.tasks.length;
  const completed = snapshot.tasks.filter(
    (task) => task.status === "completed"
  ).length;
  const inProgress = snapshot.tasks.find(
    (task) => task.status === "in_progress"
  );
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-border bg-card shadow-sm"
    >
      <CollapsibleTrigger className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ListTodo className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {snapshot.title ?? "Task List"}
          </p>
          <p className="text-xs text-muted-foreground">
            {completed}/{total} complete
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-2">
          {/* Progress bar */}
          <div className="h-1 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Current task highlight */}
          {inProgress && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
              <Loader2 className="size-3.5 animate-spin text-amber-500" />
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 truncate">
                {inProgress.title}
              </span>
            </div>
          )}

          {/* Task list */}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {snapshot.tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                  task.status === "completed" && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    task.status === "completed" && "bg-emerald-500",
                    task.status === "in_progress" && "bg-amber-500",
                    task.status === "pending" && "bg-muted-foreground/40"
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    task.status === "completed" && "line-through"
                  )}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Attachment preview component for pending attachments
function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const Icon = getAttachmentIcon(attachment.category);

  return (
    <div className="relative group flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2 py-1.5 text-xs">
      <Icon className="size-4 text-muted-foreground shrink-0" />
      <span className="truncate max-w-[120px]" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="text-muted-foreground shrink-0">
        {formatFileSize(attachment.size)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// Message attachments display component
function MessageAttachments({
  attachments,
  isUser,
}: {
  attachments: ChatAttachment[];
  isUser: boolean;
}) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((attachment) => (
        <AttachmentDisplay key={attachment.id} attachment={attachment} isUser={isUser} />
      ))}
    </div>
  );
}

// Individual attachment display in messages
function AttachmentDisplay({
  attachment,
  isUser,
}: {
  attachment: ChatAttachment;
  isUser: boolean;
}) {
  const Icon = getAttachmentIcon(attachment.category);
  const previewUrl = attachment.signedUrl;
  // Use thumbnail from attachment if available (e.g. from asset service). No client-side extraction.
  const videoThumbnail = attachment.thumbnailUrl ?? null;

  // For images, show thumbnail
  if (attachment.category === "image" && previewUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border/50 max-w-[200px]">
        <img
          src={previewUrl}
          alt={attachment.name}
          className="max-h-32 w-auto object-cover"
        />
        <div className={cn(
          "px-2 py-1 text-[10px] truncate",
          isUser ? "bg-primary-foreground/10" : "bg-muted/50"
        )}>
          {attachment.name}
        </div>
      </div>
    );
  }

  // For video, show thumbnail if available (from attachment) or icon
  if (attachment.category === "video" && previewUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border/50 max-w-[200px]">
        {videoThumbnail ? (
          <img
            src={videoThumbnail}
            alt={attachment.name}
            className="max-h-32 w-auto object-cover"
          />
        ) : (
          <div className="flex items-center justify-center max-h-32 bg-muted/50">
            <Icon className="size-8 text-muted-foreground" />
          </div>
        )}
        <div className={cn(
          "px-2 py-1 text-[10px] truncate",
          isUser ? "bg-primary-foreground/10" : "bg-muted/50"
        )}>
          {attachment.name}
        </div>
      </div>
    );
  }

  // For audio, show player
  if (attachment.category === "audio" && previewUrl) {
    return (
      <div className={cn(
        "rounded-lg border border-border/50 p-2 space-y-1",
        isUser ? "bg-primary-foreground/10" : "bg-muted/50"
      )}>
        <div className="flex items-center gap-2 text-xs">
          <Icon className="size-4 shrink-0" />
          <span className="truncate max-w-[150px]">{attachment.name}</span>
        </div>
        <audio src={previewUrl} controls className="w-full h-8" preload="metadata" />
      </div>
    );
  }

  // Default file display
  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs hover:bg-muted/30 transition-colors",
        isUser ? "bg-primary-foreground/10" : "bg-muted/50"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate max-w-[150px] font-medium">{attachment.name}</p>
        <p className="text-muted-foreground">{formatFileSize(attachment.size)}</p>
      </div>
    </a>
  );
}

function getAttachmentIcon(category: ChatAttachment["category"]) {
  switch (category) {
    case "image":
      return ImageIcon;
    case "video":
      return FileVideo;
    case "audio":
      return FileAudio;
    case "document":
      return FileText;
    default:
      return FileIcon;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
