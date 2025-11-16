import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ensureDirectoryForFileSync } from '../io/dir.js';

export type RotatePolicy = {
  readonly maxBytes?: number;
  readonly maxMinutes?: number;
  readonly gzipOnRotate?: boolean;
};

export class RotatingWriter {
  private readonly basePath: string;

  private readonly policy: RotatePolicy;

  private fd: number | null = null;

  private startTs = 0;

  private bytes = 0;

  private readonly header?: string;

  private currentPath: string | null = null;

  constructor(basePath: string, policy: RotatePolicy = {}, header?: string) {
    this.basePath = basePath;
    this.policy = policy;
    this.header = header;
  }

  private tsName() {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
      `${date.getFullYear()}` +
      `${pad(date.getMonth() + 1)}` +
      `${pad(date.getDate())}-` +
      `${pad(date.getHours())}` +
      `${pad(date.getMinutes())}` +
      `${pad(date.getSeconds())}`
    );
  }

  private openNew() {
    const ext = path.extname(this.basePath);
    const root = ext ? this.basePath.slice(0, -ext.length) : this.basePath;
    const file = `${root}-${this.tsName()}${ext}`;
    ensureDirectoryForFileSync(file);
    this.fd = fs.openSync(file, 'a');
    this.startTs = Date.now();
    this.bytes = 0;
    this.currentPath = file;
    if (this.header) {
      const headerLine = `${this.header}\n`;
      fs.writeSync(this.fd, headerLine);
      this.bytes += Buffer.byteLength(headerLine);
    }
    return file;
  }

  private closeCurrentStream(): string | undefined {
    if (this.fd === null) {
      return undefined;
    }
    const oldFd = this.fd;
    const oldPath = this.currentPath ?? undefined;
    this.fd = null;
    fs.closeSync(oldFd);
    return oldPath;
  }

  private rotateIfNeeded() {
    const now = Date.now();
    const bySize = this.policy.maxBytes !== undefined && this.bytes >= this.policy.maxBytes;
    const byTime =
      this.policy.maxMinutes !== undefined &&
      now - this.startTs >= this.policy.maxMinutes * 60_000;

    if (!this.fd || bySize || byTime) {
      const oldPath = this.closeCurrentStream();
      const newPath = this.openNew();
      if (oldPath && this.policy.gzipOnRotate) {
        setImmediate(() => this.gzipFile(oldPath));
      }
      return newPath;
    }
    return this.currentPath ?? undefined;
  }

  private gzipFile(filePath: string) {
    if (filePath.endsWith('.gz')) {
      return;
    }
    const gzPath = `${filePath}.gz`;
    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(gzPath);
    const gzip = zlib.createGzip({ level: 6 });
    readStream
      .pipe(gzip)
      .pipe(writeStream)
      .on('finish', () => {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          void error;
        }
      });
  }

  write(line: string) {
    this.rotateIfNeeded();
    if (this.fd === null) {
      this.openNew();
    }
    if (this.fd === null) {
      return;
    }
    const chunk = `${line}\n`;
    fs.writeSync(this.fd, chunk);
    this.bytes += Buffer.byteLength(chunk);
  }

  close() {
    const oldPath = this.closeCurrentStream();
    if (oldPath && this.policy.gzipOnRotate) {
      this.gzipFile(oldPath);
    }
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }
}
