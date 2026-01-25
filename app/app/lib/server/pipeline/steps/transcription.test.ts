import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcriptionStep } from './transcription';
import { getPipelineStateForAsset } from '../store';
import { getSpeechEnv, getSpeechAccessToken } from '@/app/lib/server/google-speech';
import { findLatestJobForAsset, saveTranscriptionJob } from '@/app/lib/server/transcriptions-store';
import { determineAssetType } from '@/app/lib/server/asset-storage';

// Mocks
vi.mock('../store');
vi.mock('@/app/lib/server/google-speech');
vi.mock('@/app/lib/server/transcriptions-store');
vi.mock('@/app/lib/server/asset-storage');

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('transcriptionStep', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getSpeechEnv).mockReturnValue({
            projectId: 'test-project',
            location: 'global',
            recognizerId: 'test-recognizer',
            model: 'test-model',
            languageCodes: ['en-US'],
            bucket: 'test-bucket'
        });
        vi.mocked(getSpeechAccessToken).mockResolvedValue('mock-token');
        vi.mocked(determineAssetType).mockReturnValue('video');
    });

    it('should skip if asset is not audio/video', async () => {
        vi.mocked(determineAssetType).mockReturnValue('image');
        await expect(transcriptionStep.run({ asset: { mimeType: 'image/jpeg' } } as any))
            .rejects.toThrow('Only audio or video assets can be transcribed');
    });

    it('should return waiting if job already processing', async () => {
        vi.mocked(findLatestJobForAsset).mockResolvedValue({
            id: 'job-123',
            status: 'processing',
            createdAt: '2023-01-01',
        } as any);

        const result = await transcriptionStep.run({ asset: { id: 'asset-1' } } as any);
        expect(result.status).toBe('waiting');
        expect(result.metadata.message).toBe('Transcription already running');
    });

    it('should start new transcription job', async () => {
        vi.mocked(findLatestJobForAsset).mockResolvedValue(null);
        vi.mocked(getPipelineStateForAsset).mockResolvedValue({
            steps: [{ id: 'cloud-upload', metadata: { gcsUri: 'gs://bucket/file.mp4' } }]
        } as any);

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ name: 'operation-123' })
        });

        const result = await transcriptionStep.run({ asset: { id: 'asset-1', fileName: 'file.mp4' } } as any);

        expect(result.status).toBe('waiting');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('https://speech.googleapis.com/v2/projects/test-project/locations/global/recognizers/test-recognizer:batchRecognize'),
            expect.anything()
        );
        expect(saveTranscriptionJob).toHaveBeenCalled();
    });
});
