import { TextToSpeechClient, protos } from "@google-cloud/text-to-speech";

type AudioEncoding = protos.google.cloud.texttospeech.v1.AudioEncoding;

let cachedClient: TextToSpeechClient | null = null;

function parseCredentials() {
  const raw =
    process.env.GOOGLE_TTS_CREDENTIALS ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    null;

  if (!raw) return undefined;

  try {
    const credentials = JSON.parse(raw) as {
      client_email: string;
      private_key: string;
    };
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Missing client_email or private_key");
    }
    return { credentials };
  } catch (error) {
    console.warn("Failed to parse Google TTS credentials from environment.", error);
    return undefined;
  }
}

export function getTextToSpeechClient() {
  if (cachedClient) return cachedClient;
  const options = parseCredentials();
  cachedClient = new TextToSpeechClient(options);
  return cachedClient;
}

export type SupportedTtsEncoding = "mp3" | "ogg_opus" | "linear16";

export interface SynthesizeSpeechOptions {
  text?: string;
  ssml?: string;
  voiceName: string;
  languageCode: string;
  speakingRate?: number;
  audioEncoding?: SupportedTtsEncoding;
}

const AUDIO_ENCODING_MAP: Record<SupportedTtsEncoding, AudioEncoding> = {
  mp3: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
  ogg_opus: protos.google.cloud.texttospeech.v1.AudioEncoding.OGG_OPUS,
  linear16: protos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
};

export async function synthesizeSpeech({
  text,
  ssml,
  voiceName,
  languageCode,
  speakingRate,
  audioEncoding = "mp3",
}: SynthesizeSpeechOptions) {
  if (!text && !ssml) {
    throw new Error("Either text or ssml input must be provided.");
  }

  const client = getTextToSpeechClient();

  const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: ssml ? { ssml } : { text: text ?? "" },
    voice: {
      name: voiceName,
      languageCode,
    },
    audioConfig: {
      audioEncoding: AUDIO_ENCODING_MAP[audioEncoding],
      speakingRate,
    },
  };

  const [response] = await client.synthesizeSpeech(request);
  const audioContent = response.audioContent;

  if (!audioContent || !audioContent.length) {
    throw new Error("Google TTS returned an empty audio payload.");
  }

  return Buffer.isBuffer(audioContent)
    ? audioContent
    : Buffer.from(audioContent as Uint8Array);
}
