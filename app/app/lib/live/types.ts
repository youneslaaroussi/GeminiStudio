/**
 * Types for Gemini Live API integration
 */

/** Available voice options for Gemini Live API */
export type LiveVoiceName =
  | "Puck"      // Upbeat (default)
  | "Charon"
  | "Kore"      // Firm
  | "Fenrir"
  | "Aoede"
  | "Leda"
  | "Orus"      // Firm
  | "Zephyr"    // Bright
  | "Autonoe"   // Bright
  | "Enceladus"
  | "Iapetus"   // Clear
  | "Umbriel"   // Easy-going
  | "Algieba"
  | "Despina"
  | "Erinome"   // Clear
  | "Algenib"
  | "Rasalgethi"
  | "Laomedeia" // Upbeat
  | "Achernar"
  | "Alnilam"   // Firm
  | "Schedar"
  | "Gacrux"
  | "Pulcherrima"
  | "Achird"
  | "Zubenelgenubi"
  | "Vindemiatrix"
  | "Sadachbia"
  | "Sadaltager"
  | "Sulafat"
  | "Callirrhoe"; // Easy-going

export interface LiveSessionConfig {
  model: string;
  systemInstruction?: string;
  tools?: LiveToolDeclaration[];
  responseModalities?: ("AUDIO" | "TEXT")[];
  /** Voice name for audio responses (default: "Puck") */
  voice?: LiveVoiceName;
}

export interface LiveToolDeclaration {
  functionDeclarations: LiveFunctionDeclaration[];
}

export interface LiveFunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface LiveSessionState {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  isListening: boolean;
  isSpeaking: boolean;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

// Gemini Live API message types
export interface BidiServerMessage {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
    turnComplete?: boolean;
    interrupted?: boolean;
    generationComplete?: boolean;
  };
  toolCall?: {
    functionCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  };
  toolCallCancellation?: {
    ids: string[];
  };
}

export interface LiveSessionCallbacks {
  onStateChange?: (state: LiveSessionState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onToolCall?: (toolCall: ToolCallRequest) => Promise<Record<string, unknown>>;
  onAudioOutput?: (audioData: ArrayBuffer) => void;
  onOutputLevel?: (level: number) => void;
  onError?: (error: Error) => void;
}
