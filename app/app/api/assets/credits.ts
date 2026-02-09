import {
  getUploadActionFromMimeType,
  getCreditsForAction,
} from "@/app/lib/credits-config";
import { getBilling, deductCredits } from "@/app/lib/server/credits";

export interface UploadCreditFile {
  mimeType: string;
}

export class CreditsError extends Error {
  status: number;
  responseBody: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>, message?: string) {
    super(message ?? (body.error as string | undefined) ?? "");
    this.status = status;
    this.responseBody = body;
  }
}

export function calculateTotalCredits(files: UploadCreditFile[]) {
  return files.reduce((sum, file) => {
    const action = getUploadActionFromMimeType(file.mimeType);
    return sum + getCreditsForAction(action);
  }, 0);
}

export async function verifyAndDeductCredits(userId: string, totalCreditsNeeded: number) {
  try {
    const billing = await getBilling(userId);
    if (billing.credits < totalCreditsNeeded) {
      throw new CreditsError(
        402,
        {
          error: `Insufficient credits. You need ${totalCreditsNeeded} R-Credits to upload these files. You have ${billing.credits}.`,
          reason: "insufficient_credits",
          required: totalCreditsNeeded,
          current: billing.credits,
        }
      );
    }
  } catch (error) {
    if (error instanceof CreditsError) {
      throw error;
    }
    console.error("Failed to check credits:", error);
    throw new CreditsError(500, { error: "Failed to verify credits" });
  }

  try {
    await deductCredits(userId, totalCreditsNeeded, "asset_upload");
  } catch (error) {
    console.error("Failed to deduct credits:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("Insufficient")) {
      throw new CreditsError(402, { error: message, reason: "insufficient_credits" });
    }
    throw new CreditsError(500, { error: "Failed to process credits" });
  }
}
