/**
 * Gemini Live API module
 *
 * Provides real-time voice interaction with Gemini using WebSockets.
 */

export { LiveSession } from "./client";
export { AudioCapture, AudioPlayer, getAudioInputDevices } from "./audio";
export type { AudioDevice } from "./audio";
export { getToolsForLiveApi, getToolsByName, executeToolByName } from "./tools";
export type { LiveToolContext } from "./tools";
export type {
  LiveSessionConfig,
  LiveSessionState,
  LiveSessionCallbacks,
  LiveToolDeclaration,
  LiveFunctionDeclaration,
  LiveVoiceName,
  ToolCallRequest,
  ToolCallResponse,
} from "./types";
