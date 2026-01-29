/**
 * Gemini Live API WebSocket Client
 *
 * Handles the WebSocket connection to Gemini Live API for real-time
 * voice conversations with tool calling support.
 */

import type {
  LiveSessionConfig,
  LiveSessionState,
  LiveSessionCallbacks,
  BidiServerMessage,
  ToolCallResponse,
} from "./types";
import { AudioCapture, AudioPlayer, arrayBufferToBase64, base64ToArrayBuffer } from "./audio";

// Ephemeral tokens require BidiGenerateContentConstrained endpoint
const LIVE_API_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export class LiveSession {
  private ws: WebSocket | null = null;
  private audioCapture: AudioCapture | null = null;
  private audioPlayer: AudioPlayer | null = null;
  private config: LiveSessionConfig;
  private callbacks: LiveSessionCallbacks;
  private state: LiveSessionState = {
    status: "disconnected",
    isListening: false,
    isSpeaking: false,
  };
  private pendingToolCalls: Map<string, { resolve: (value: Record<string, unknown>) => void }> = new Map();

  constructor(config: LiveSessionConfig, callbacks: LiveSessionCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
  }

  private setState(updates: Partial<LiveSessionState>) {
    this.state = { ...this.state, ...updates };
    this.callbacks.onStateChange?.(this.state);
  }

  async connect(token: string): Promise<void> {
    if (this.ws) {
      throw new Error("Already connected");
    }

    this.setState({ status: "connecting" });

    // Initialize audio player with output level callback
    this.audioPlayer = new AudioPlayer();
    await this.audioPlayer.init(this.callbacks.onOutputLevel);

    // Connect with ephemeral token
    const url = `${LIVE_API_BASE}?access_token=${token}`;
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket not initialized"));

      this.ws.onopen = () => {
        // Send setup message
        this.sendSetup();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data, resolve).catch((err) => {
          console.error("Error handling message:", err);
        });
      };

      this.ws.onerror = (event) => {
        console.error("WebSocket error event:", event);
        const error = new Error("WebSocket error");
        this.setState({ status: "error", error: error.message });
        this.callbacks.onError?.(error);
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        this.setState({ status: "disconnected", isListening: false, isSpeaking: false });
        this.cleanup();
        // Reject if we haven't connected yet
        if (this.state.status === "connecting") {
          reject(new Error(`Connection closed: ${event.reason || "Unknown reason"} (code: ${event.code})`));
        }
      };
    });
  }

  private sendSetup() {
    if (!this.ws) return;

    // Ensure model has "models/" prefix
    const modelName = this.config.model.startsWith("models/")
      ? this.config.model
      : `models/${this.config.model}`;

    const generationConfig: Record<string, unknown> = {
      responseModalities: this.config.responseModalities || ["AUDIO"],
    };

    // Add speech config with voice selection
    if (this.config.voice) {
      generationConfig.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: this.config.voice,
          },
        },
      };
    }

    const setup: Record<string, unknown> = {
      setup: {
        model: modelName,
        generationConfig,
      },
    };

    if (this.config.systemInstruction) {
      (setup.setup as Record<string, unknown>).systemInstruction = {
        parts: [{ text: this.config.systemInstruction }],
      };
    }

    if (this.config.tools && this.config.tools.length > 0) {
      (setup.setup as Record<string, unknown>).tools = this.config.tools;
    }

    this.ws.send(JSON.stringify(setup));
  }

  private async handleMessage(data: string | ArrayBuffer | Blob, onSetupComplete?: () => void) {
    try {
      // Handle Blob data (browser WebSocket returns Blob)
      let textData: string;
      if (data instanceof Blob) {
        textData = await data.text();
      } else if (typeof data === "string") {
        textData = data;
      } else {
        textData = new TextDecoder().decode(data);
      }
      
      const message: BidiServerMessage = JSON.parse(textData);

      // Handle setup complete
      if (message.setupComplete) {
        this.setState({ status: "connected" });
        onSetupComplete?.();
        return;
      }

      // Handle server content (audio/text responses)
      if (message.serverContent) {
        const content = message.serverContent;

        // Handle interruption
        if (content.interrupted) {
          this.audioPlayer?.clear();
          this.setState({ isSpeaking: false });
          return;
        }

        // Handle model turn with audio/text
        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            // Audio response
            if (part.inlineData?.data) {
              const audioData = base64ToArrayBuffer(part.inlineData.data);
              this.audioPlayer?.play(audioData);
              this.callbacks.onAudioOutput?.(audioData);
              this.setState({ isSpeaking: true });
            }

            // Text response (for transcription)
            if (part.text) {
              this.callbacks.onTranscript?.(part.text, content.turnComplete ?? false);
            }
          }
        }

        // Turn complete
        if (content.turnComplete) {
          this.setState({ isSpeaking: false });
        }
      }

      // Handle tool calls
      if (message.toolCall?.functionCalls) {
        this.handleToolCalls(message.toolCall.functionCalls);
      }

      // Handle tool call cancellation
      if (message.toolCallCancellation?.ids) {
        for (const id of message.toolCallCancellation.ids) {
          this.pendingToolCalls.delete(id);
        }
      }
    } catch (error) {
      console.error("Failed to parse Live API message:", error, "Raw data:", data);
    }
  }

  private async handleToolCalls(
    functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>
  ) {
    const responses: ToolCallResponse[] = [];

    for (const call of functionCalls) {
      try {
        // Call the tool callback
        const result = await this.callbacks.onToolCall?.({
          id: call.id,
          name: call.name,
          args: call.args,
        });

        responses.push({
          id: call.id,
          name: call.name,
          response: result ?? { result: "ok" },
        });
      } catch (error) {
        responses.push({
          id: call.id,
          name: call.name,
          response: {
            error: error instanceof Error ? error.message : "Tool execution failed",
          },
        });
      }
    }

    // Send tool responses back
    this.sendToolResponses(responses);
  }

  private sendToolResponses(responses: ToolCallResponse[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      toolResponse: {
        functionResponses: responses.map((r) => ({
          id: r.id,
          name: r.name,
          response: r.response,
        })),
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  async startListening(options?: {
    deviceId?: string;
    onAudioLevel?: (level: number) => void;
  }): Promise<void> {
    if (this.state.isListening) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    this.audioCapture = new AudioCapture();
    await this.audioCapture.start(
      (audioData) => {
        this.sendAudio(audioData);
      },
      {
        deviceId: options?.deviceId,
        onAudioLevel: options?.onAudioLevel,
      }
    );

    this.setState({ isListening: true });
  }

  stopListening(): void {
    if (!this.state.isListening) return;

    this.audioCapture?.stop();
    this.audioCapture = null;

    // Send end of audio stream signal
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audioStreamEnd: true,
          },
        })
      );
    }

    this.setState({ isListening: false });
  }

  private sendAudio(audioData: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      realtimeInput: {
        audio: {
          data: arrayBufferToBase64(audioData),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const message = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.stopListening();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.cleanup();
    this.setState({ status: "disconnected" });
  }

  private cleanup() {
    this.audioCapture?.stop();
    this.audioCapture = null;
    this.audioPlayer?.stop();
    this.audioPlayer = null;
    this.pendingToolCalls.clear();
  }

  getState(): LiveSessionState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.status === "connected";
  }
}
