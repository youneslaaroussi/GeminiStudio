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
  private authToken: string | null = null;

  constructor(config: LiveSessionConfig, callbacks: LiveSessionCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Set auth token for authenticated proxy requests (e.g., media fetching)
   */
  setAuthToken(token: string): void {
    this.authToken = token;
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
    const mediaToInject: Array<{ downloadUrl: string; mimeType: string; assetType?: string }> = [];

    console.log(`[LiveSession] Handling ${functionCalls.length} tool call(s)`, {
      toolNames: functionCalls.map(c => c.name),
    });

    for (const call of functionCalls) {
      try {
        console.log(`[LiveSession] Executing tool: ${call.name}`, {
          toolId: call.id,
          args: call.args,
        });

        const result = await this.callbacks.onToolCall?.({
          id: call.id,
          name: call.name,
          args: call.args,
        });

        console.log(`[LiveSession] Tool ${call.name} completed`, {
          toolId: call.id,
          hasResult: !!result,
          hasInjectMedia: result?._injectMedia,
          hasFileUri: !!(result as any)?._fileUri,
          hasDownloadUrl: !!(result as any)?._downloadUrl,
          mimeType: (result as any)?._mimeType,
        });

        // Check for media injection request - prefer downloadUrl for Live API
        if (result?._injectMedia && result._downloadUrl && result._mimeType) {
          console.log(`[LiveSession] Media injection detected for ${call.name}`, {
            toolId: call.id,
            downloadUrl: result._downloadUrl, // FULL URL - don't truncate
            mimeType: result._mimeType,
            assetType: result._assetType,
          });
          mediaToInject.push({
            downloadUrl: result._downloadUrl as string,
            mimeType: result._mimeType as string,
            assetType: result._assetType as string | undefined,
          });
        } else if (result?._injectMedia) {
          console.warn(`[LiveSession] WARNING: _injectMedia=true but missing downloadUrl or mimeType for ${call.name}`, {
            toolId: call.id,
            hasDownloadUrl: !!result._downloadUrl,
            hasMimeType: !!result._mimeType,
            hasFileUri: !!(result as any)?._fileUri,
          });
        }

        responses.push({
          id: call.id,
          name: call.name,
          response: result ?? { result: "ok" },
        });
      } catch (error) {
        console.error(`[LiveSession] Tool ${call.name} failed`, {
          toolId: call.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        responses.push({
          id: call.id,
          name: call.name,
          response: {
            error: error instanceof Error ? error.message : "Tool execution failed",
          },
        });
      }
    }

    // Send tool responses first
    console.log(`[LiveSession] Sending ${responses.length} tool response(s)`);
    this.sendToolResponses(responses);

    // Then inject any media so the model can see it
    console.log(`[LiveSession] Injecting ${mediaToInject.length} media item(s)`);
    for (const media of mediaToInject) {
      const isVideo = media.assetType === "video" || media.mimeType.startsWith("video/");
      const isImage = media.assetType === "image" || media.mimeType.startsWith("image/");
      const isAudio = media.assetType === "audio" || media.mimeType.startsWith("audio/");

      console.log(`[LiveSession] Injecting media`, {
        type: isVideo ? "video" : isImage ? "image" : isAudio ? "audio" : "unknown",
        mimeType: media.mimeType,
        downloadUrl: media.downloadUrl, // FULL URL - don't truncate
      });

      if (isVideo) {
        // Video: extract frames using mediabunny
        console.log(`[LiveSession] Extracting video frames from: ${media.downloadUrl}`);
        await this.sendVideoFrames(media.downloadUrl, this.authToken ?? undefined, 4);
        console.log(`[LiveSession] Video frames sent to model`);
      } else if (isImage) {
        // Image: send directly
        console.log(`[LiveSession] Sending image: ${media.downloadUrl}`);
        await this.sendImage(media.downloadUrl, this.authToken ?? undefined);
        console.log(`[LiveSession] Image sent to model`);
      } else if (isAudio) {
        // Audio: Live API doesn't support injecting audio files mid-conversation
        // The model already received the tool response text
        console.log("[LiveSession] Audio assets cannot be injected into Live API");
      }
    }
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

  /**
   * Send an image to the model.
   * Uses proxy to avoid CORS issues with GCS signed URLs.
   */
  async sendImage(url: string, authToken?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    try {
      // Use proxy to avoid CORS issues with GCS
      const proxyUrl = `/api/proxy/media?url=${encodeURIComponent(url)}`;
      const headers: HeadersInit = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(proxyUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Data = arrayBufferToBase64(arrayBuffer);

      // Determine mime type from response or default to jpeg
      const contentType = response.headers.get("Content-Type") || "image/jpeg";

      // Send image using realtimeInput (same pattern as audio)
      const message = {
        realtimeInput: {
          video: {
            data: base64Data,
            mimeType: contentType,
          },
        },
      };

      this.ws.send(JSON.stringify(message));
      console.log("[LiveSession] Sent image to model");
    } catch (error) {
      console.error("Failed to send image:", error);
      this.sendText(`[Image failed to load: ${error instanceof Error ? error.message : "Unknown error"}]`);
    }
  }

  /**
   * Send video frames to the model by extracting frames using mediabunny.
   * Live API requires individual image frames, not encoded video files.
   * Uses proxy to avoid CORS issues with GCS signed URLs.
   */
  async sendVideoFrames(url: string, authToken?: string, frameCount: number = 4): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    try {
      // Use proxy URL to avoid CORS
      const proxyUrl = `/api/proxy/media?url=${encodeURIComponent(url)}`;
      const headers: HeadersInit = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      // Dynamically import mediabunny (it's a client-side library)
      const { Input, UrlSource, CanvasSink, MP4 } = await import("mediabunny");

      // Create input with custom fetch that includes auth
      const source = new UrlSource(proxyUrl, {
        requestInit: { headers },
      });

      const input = new Input({
        formats: [MP4],
        source,
      });

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      const duration = await videoTrack.computeDuration();
      const startTime = await videoTrack.getFirstTimestamp();

      // Create canvas sink for extracting frames as images
      const sink = new CanvasSink(videoTrack, {
        width: 640,  // Reasonable size for Live API
        height: 360,
        fit: "contain",  // Required when both width and height are provided
      });

      // Calculate evenly spaced timestamps
      const timestamps: number[] = [];
      for (let i = 0; i < frameCount; i++) {
        const t = startTime + (i / (frameCount - 1 || 1)) * (duration - startTime);
        timestamps.push(t);
      }

      // Extract and send each frame
      let frameIndex = 0;
      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (!result) continue;
        const canvas = result.canvas;
        
        // Convert canvas to JPEG base64 (handle both HTMLCanvasElement and OffscreenCanvas)
        let blob: Blob;
        if (canvas instanceof OffscreenCanvas) {
          blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        } else {
          blob = await new Promise<Blob>((resolve) => {
            (canvas as HTMLCanvasElement).toBlob((b) => resolve(b!), "image/jpeg", 0.8);
          });
        }
        const arrayBuffer = await blob.arrayBuffer();
        const base64Data = arrayBufferToBase64(arrayBuffer);

        // Send frame using realtimeInput (same pattern as audio)
        const message = {
          realtimeInput: {
            video: {
              data: base64Data,
              mimeType: "image/jpeg",
            },
          },
        };

        this.ws?.send(JSON.stringify(message));
        frameIndex++;

        // Small delay between frames
        if (frameIndex < frameCount) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      // Clean up
      input.dispose();

      console.log(`[LiveSession] Sent ${frameIndex} frames to model`);
    } catch (error) {
      console.error("Failed to send video frames:", error);
      // Send error as text so the model knows something went wrong
      this.sendText(`[Video frames failed to load: ${error instanceof Error ? error.message : "Unknown error"}]`);
    }
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
