import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadStep } from './upload';
import { promises as fs } from 'fs';
import { getGoogleAccessToken } from '@/app/lib/server/google-cloud';
import { createV4SignedUrl } from '@/app/lib/server/gcs-signed-url';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock('@/app/lib/server/google-cloud', () => ({
  getGoogleAccessToken: vi.fn(),
}));

vi.mock('@/app/lib/server/gcs-signed-url', () => ({
  createV4SignedUrl: vi.fn(),
}));

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('uploadStep', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    process.env.ASSET_GCS_BUCKET = 'test-bucket';
    process.env.ASSET_SIGNED_URL_TTL_SECONDS = '3600';
    vi.mocked(createV4SignedUrl).mockReturnValue('https://signed-url');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should upload file successfully', async () => {
    // Setup mocks
    const mockAsset = {
      id: '123',
      fileName: 'test.mp4',
      mimeType: 'video/mp4',
      name: 'Test Video',
    };
    const mockBuffer = Buffer.from('test content');
    const mockToken = 'mock-token';

    vi.mocked(fs.readFile).mockResolvedValue(mockBuffer);
    vi.mocked(getGoogleAccessToken).mockResolvedValue(mockToken);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'assets/123/test.mp4' }),
    });

    // Run step
    const result = await uploadStep.run({ asset: mockAsset } as any);

    // Assertions
    expect(result.status).toBe('succeeded');
    expect(result.metadata).toEqual({
      gcsUri: 'gs://test-bucket/assets/123/test.mp4',
      signedUrl: 'https://signed-url',
      bucket: 'test-bucket',
      objectName: 'assets/123/test.mp4',
    });

    expect(fs.readFile).toHaveBeenCalled();
    expect(getGoogleAccessToken).toHaveBeenCalled();
    expect(createV4SignedUrl).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      objectName: 'assets/123/test.mp4',
      expiresInSeconds: 3600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      })
    );
  });
  
  it('should throw error if configuration is missing', async () => {
      delete process.env.ASSET_GCS_BUCKET;
      const mockAsset = { id: '123', fileName: 'test.mp4' };
      await expect(uploadStep.run({ asset: mockAsset } as any)).rejects.toThrow('ASSET_GCS_BUCKET');
  });

  it('should handle upload failure', async () => {
    const mockAsset = {
        id: '123',
        fileName: 'test.mp4',
        mimeType: 'video/mp4',
        name: 'Test Video',
      };
      const mockBuffer = Buffer.from('test content');
      const mockToken = 'mock-token';
  
      vi.mocked(fs.readFile).mockResolvedValue(mockBuffer);
      vi.mocked(getGoogleAccessToken).mockResolvedValue(mockToken);
      fetchMock.mockResolvedValue({
        ok: false,
        text: async () => 'Upload failed',
      });
  
      await expect(uploadStep.run({ asset: mockAsset } as any)).rejects.toThrow('Failed to upload to Cloud Storage: Upload failed');
  });
});
