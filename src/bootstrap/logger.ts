import fs from 'node:fs';
import path from 'node:path';
import { ensureDirectorySync } from '../io/dir.js';

export type ProcessLogger = {
  readonly logPath: string;
  readonly info: (message: string, ...metadata: unknown[]) => void;
  readonly warn: (message: string, ...metadata: unknown[]) => void;
  readonly error: (message: string, ...metadata: unknown[]) => void;
  readonly debug: (message: string, ...metadata: unknown[]) => void;
  readonly close: () => Promise<void>;
};

export type ProcessLoggerOptions = {
  readonly name?: string;
  readonly directory?: string;
};

function formatMetadata(metadata: readonly unknown[]): unknown[] | undefined {
  if (!metadata.length) {
    return undefined;
  }

  return metadata.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }

    try {
      return JSON.parse(JSON.stringify(entry));
    } catch (_error) {
      return String(entry);
    }
  });
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function serialiseLog(level: string, message: string, metadata: readonly unknown[]): string {
  const payload: Record<string, unknown> = {
    ts: formatTimestamp(),
    level,
    message,
  };

  const formattedMetadata = formatMetadata(metadata);
  if (formattedMetadata) {
    payload.metadata = formattedMetadata;
  }

  return `${JSON.stringify(payload)}\n`;
}

export function createProcessLogger(options: ProcessLoggerOptions = {}): ProcessLogger {
  const { name = 'process', directory = path.join(process.cwd(), 'logs') } = options;

  ensureDirectorySync(directory);

  const timestamp = formatTimestamp().replace(/[:.]/g, '-');
  const logPath = path.join(directory, `${name}-${timestamp}.log`);
  const stream = fs.createWriteStream(logPath, { flags: 'a' });

  let closed = false;

  const write = (level: string, message: string, metadata: readonly unknown[]) => {
    if (closed) {
      return;
    }

    const payload = serialiseLog(level, message, metadata);
    stream.write(payload);
  };

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;

    await new Promise<void>((resolve, reject) => {
      stream.end((error: Error | null | undefined): void => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  return {
    logPath,
    info: (message: string, ...metadata: unknown[]) => write('info', message, metadata),
    warn: (message: string, ...metadata: unknown[]) => write('warn', message, metadata),
    error: (message: string, ...metadata: unknown[]) => write('error', message, metadata),
    debug: (message: string, ...metadata: unknown[]) => write('debug', message, metadata),
    close,
  };
}
