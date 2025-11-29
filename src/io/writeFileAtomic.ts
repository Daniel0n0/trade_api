import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `${path.basename(filePath)}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, data, { encoding: 'utf8' });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
