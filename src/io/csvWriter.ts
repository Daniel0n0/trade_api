import fs from 'node:fs';

import { ensureDirectoryForFileSync } from './dir.js';

const csvWriters = new Map<string, fs.WriteStream>();

type HeaderInput = readonly string[] | string;

const normaliseHeader = (header: HeaderInput): string => {
  if (Array.isArray(header)) {
    return header.join(',');
  }
  return header as string;
};

const isStreamWritable = (stream: fs.WriteStream): boolean => {
  if (stream.destroyed) {
    return false;
  }
  if ('closed' in stream && stream.closed) {
    return false;
  }
  if (stream.writableEnded) {
    return false;
  }
  return true;
};

export const getCsvWriter = (filePath: string, header: HeaderInput): fs.WriteStream => {
  const existing = csvWriters.get(filePath);
  if (existing && isStreamWritable(existing)) {
    return existing;
  }
  if (existing) {
    csvWriters.delete(filePath);
  }

  const headerLine = normaliseHeader(header);
  const fileExists = fs.existsSync(filePath);
  ensureDirectoryForFileSync(filePath);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  csvWriters.set(filePath, stream);

  stream.once('close', () => {
    const current = csvWriters.get(filePath);
    if (current === stream) {
      csvWriters.delete(filePath);
    }
  });

  if (!fileExists && headerLine) {
    stream.write(`${headerLine}\n`);
  }

  return stream;
};

export const closeAllWriters = async (): Promise<void> => {
  const closing: Promise<void>[] = [];

  for (const [filePath, stream] of csvWriters.entries()) {
    csvWriters.delete(filePath);
    if (!isStreamWritable(stream)) {
      continue;
    }
    const endPromise = new Promise<void>((resolve) => {
      const handleError = () => {
        stream.off('finish', handleFinish);
        resolve();
      };
      const handleFinish = () => {
        stream.off('error', handleError);
        resolve();
      };

      stream.once('error', handleError);
      stream.once('finish', handleFinish);
      stream.end();
    });
    closing.push(endPromise);
  }

  if (!closing.length) {
    return;
  }

  await Promise.allSettled(closing);
};
