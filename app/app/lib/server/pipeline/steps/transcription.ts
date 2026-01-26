import crypto from "crypto";
import type { PipelineStepDefinition } from "../types";
import { determineAssetType } from "@/app/lib/server/asset-storage";
import { getSpeechEnv, getSpeechAccessToken } from "@/app/lib/server/google-speech";
import {
  saveTranscriptionJob,
  type StoredTranscriptionJob,
  findLatestJobForAsset,
} from "@/app/lib/server/transcriptions-store";
import { getPipelineStateForAsset } from "../store";

async function startBatchRecognize(
  token: string,
  env: ReturnType<typeof getSpeechEnv>,
  gcsUri: string,
  languageCodes: string[]
) {
  const recognizerPath = `projects/${env.projectId}/locations/${env.location}/recognizers/${env.recognizerId}`;
  const endpoint = env.location === "global"
    ? "speech.googleapis.com"
    : `${env.location}-speech.googleapis.com`;
  const url = `https://${endpoint}/v2/${recognizerPath}:batchRecognize`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recognizer: recognizerPath,
      config: {
        autoDecodingConfig: {},
        languageCodes: languageCodes.length ? languageCodes : env.languageCodes,
        model: env.model,
        features: {
          enableWordTimeOffsets: true,
        },
      },
      files: [{ uri: gcsUri }],
      recognitionOutputConfig: {
        inlineResponseConfig: {},
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Speech-to-Text request failed: ${text}`);
  }

  const payload = (await response.json()) as { name?: string };
  if (!payload.name) {
    throw new Error("Speech-to-Text API did not return an operation name");
  }
  return payload.name;
}

export const transcriptionStep: PipelineStepDefinition = {
  id: "transcription",
  label: "Transcribe audio/video",
  description: "Use Google Cloud Speech-to-Text to generate captions.",
  supportedTypes: ["audio", "video"],
  run: async ({ asset, params }) => {
    const assetType = determineAssetType(asset.mimeType, asset.name);
    if (!["audio", "video"].includes(assetType)) {
      throw new Error("Only audio or video assets can be transcribed");
    }

    const existingJob = await findLatestJobForAsset(asset.id);
    if (existingJob && ["processing"].includes(existingJob.status)) {
      return {
        status: "waiting",
        metadata: {
          message: "Transcription already running",
          jobId: existingJob.id,
          createdAt: existingJob.createdAt,
        },
      };
    }

    // Use audioGcsUri if provided (for video files where audio was extracted client-side),
    // otherwise fall back to the original asset's GCS URI from the cloud-upload step
    let gcsUri = typeof params?.audioGcsUri === "string" ? params.audioGcsUri : undefined;

    if (!gcsUri) {
      const pipeline = await getPipelineStateForAsset(asset.id);
      const uploadStep = pipeline.steps.find((step) => step.id === "cloud-upload");
      gcsUri = uploadStep?.metadata?.gcsUri as string | undefined;
      if (!gcsUri) {
        throw new Error("Cloud upload step must complete before transcription");
      }
    }

    const env = getSpeechEnv();
    const token = await getSpeechAccessToken();
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const languageCodes = Array.isArray(params?.languageCodes)
      ? (params?.languageCodes as string[])
      : env.languageCodes;

    const job: StoredTranscriptionJob = {
      id: jobId,
      assetId: asset.id,
      assetName: asset.name,
      assetUrl: `/uploads/${asset.fileName}`,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      gcsUri,
      status: "processing",
      languageCodes,
      createdAt,
      updatedAt: createdAt,
    };

    const operationName = await startBatchRecognize(token, env, gcsUri, languageCodes);
    job.operationName = operationName;
    await saveTranscriptionJob(job);

    return {
      status: "waiting",
      metadata: {
        jobId,
        createdAt,
        languageCodes,
      },
    };
  },
};
