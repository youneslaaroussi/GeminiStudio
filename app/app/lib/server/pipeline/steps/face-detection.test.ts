import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faceDetectionStep } from './face-detection';
import { getPipelineStateForAsset } from '../store';

// Mock dependencies
vi.mock('../store', () => ({
  getPipelineStateForAsset: vi.fn(),
}));

vi.mock('@/app/lib/server/google-cloud', () => ({
  parseGoogleServiceAccount: vi.fn().mockReturnValue({ client_email: 'test' }),
}));

// Mock the Google Cloud client
const mockAnnotateVideo = vi.fn();
vi.mock('@google-cloud/video-intelligence', () => {
    return {
        VideoIntelligenceServiceClient: class {
            annotateVideo = mockAnnotateVideo;
        }
    }
});

describe('faceDetectionStep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should throw if cloud-upload step is missing or incomplete', async () => {
    vi.mocked(getPipelineStateForAsset).mockResolvedValue({
      steps: [],
    } as any);

    await expect(faceDetectionStep.run({ asset: { id: '123' } } as any)).rejects.toThrow('Cloud upload step must complete');
  });

  it('should run face detection successfully', async () => {
    // Mock pipeline state
    vi.mocked(getPipelineStateForAsset).mockResolvedValue({
      steps: [
        {
          id: 'cloud-upload',
          status: 'succeeded',
          metadata: { gcsUri: 'gs://test/video.mp4' },
        },
      ],
    } as any);

    // Mock video client response
    const mockOperation = {
        promise: vi.fn().mockResolvedValue([{
            annotationResults: [{
                faceDetectionAnnotations: [
                    {
                        tracks: [{
                            segment: { startTimeOffset: { seconds: 0 }, endTimeOffset: { seconds: 5 } },
                            timestampedObjects: [{ attributes: [{ name: 'Smiling' }] }]
                        }]
                    }
                ]
            }]
        }])
    };
    mockAnnotateVideo.mockResolvedValue([mockOperation]);

    const result = await faceDetectionStep.run({ asset: { id: '123' } } as any);

    expect(result.status).toBe('succeeded');
    expect(result.metadata.faceCount).toBe(1);
    expect(result.metadata.gcsUri).toBe('gs://test/video.mp4');
    expect(mockAnnotateVideo).toHaveBeenCalledWith(expect.objectContaining({
        inputUri: 'gs://test/video.mp4',
        features: ['FACE_DETECTION'],
    }));
  });
});
