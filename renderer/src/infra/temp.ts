import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  return dir;
};

export const cleanupTempDir = async (dir: string) => {
  await rm(dir, { recursive: true, force: true });
};
