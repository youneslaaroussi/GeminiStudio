import { describe, it, expect, vi, beforeEach } from "vitest";
import { shotDetectionStep } from "./shot-detection";
import { getPipelineStateForAsset } from "../store";

vi.mock("../store", () => ({
  getPipelineStateForAsset: vi.fn(),
}));

vi.mock("@/app/lib/server/google-cloud", () => ({
  parseGoogleServiceAccount: vi.fn().mockReturnValue({ client_email: "test" }),
}));

const mockAnnotateVideo = vi.fn();

vi.mock("@google-cloud/video-intelligence", () => ({
  VideoIntelligenceServiceClient: class {
    annotateVideo = mockAnnotateVideo;
  },
}));

describe("shotDetectionStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws if cloud-upload metadata is missing", async () => {
    vi.mocked(getPipelineStateForAsset).mockResolvedValue({
      steps: [],
    } as any);

    await expect(
      shotDetectionStep.run({ asset: { id: "asset-1" } } as any)
    ).rejects.toThrow("Cloud upload step must complete before shot detection");
  });

  it("returns shot metadata when detection succeeds", async () => {
    vi.mocked(getPipelineStateForAsset).mockResolvedValue({
      steps: [
        {
          id: "cloud-upload",
          status: "succeeded",
          metadata: { gcsUri: "gs://bucket/video.mp4" },
        },
      ],
    } as any);

    const mockOperation = {
      promise: vi.fn().mockResolvedValue([
        {
          annotationResults: [
            {
              shotAnnotations: [
                {
                  startTimeOffset: { seconds: 0, nanos: 0 },
                  endTimeOffset: { seconds: 2, nanos: 500_000_000 },
                },
                {
                  startTimeOffset: { seconds: 2, nanos: 500_000_000 },
                  endTimeOffset: { seconds: 5, nanos: 0 },
                },
              ],
            },
          ],
        },
      ]),
    };

    mockAnnotateVideo.mockResolvedValue([mockOperation]);

    const result = await shotDetectionStep.run({ asset: { id: "asset-1" } } as any);

    expect(result.status).toBe("succeeded");
    expect(result.metadata.shotCount).toBe(2);
    expect(result.metadata.shots[0]).toMatchObject({
      index: 0,
      start: 0,
    });
    expect(mockAnnotateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUri: "gs://bucket/video.mp4",
        features: ["SHOT_CHANGE_DETECTION"],
      })
    );
  });
});
