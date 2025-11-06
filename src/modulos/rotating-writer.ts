import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export type RotatePolicy = {
  readonly maxBytes?: number;
  readonly maxMinutes?: number;
  readonly gzipOnRotate?: boolean;
};

export class RotatingWriter {
  private readonly basePath: string;

  private readonly policy: RotatePolicy;

  private stream: fs.WriteStream | null = null;

  private startTs = 0;

  private bytes = 0;

  private readonly header?: string;

  private currentPath: string | null = null;

  constructor(basePath: string, policy: RotatePolicy = {}, header?: string) {
    this.basePath = basePath;
    this.policy = policy;
    this.header = header;
  }

  private ensureDir(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
    this.ensureDir(file);
    this.stream = fs.createWriteStream(file, { flags: 'a' });
    this.startTs = Date.now();
    this.bytes = 0;
    this.currentPath = file;
    if (this.header) {
      this.stream.write(`${this.header}\n`);
      this.bytes += Buffer.byteLength(this.header) + 1;
    }
    return file;
  }

  private rotateIfNeeded() {
    const now = Date.now();
    const bySize = this.policy.maxBytes !== undefined && this.bytes >= this.policy.maxBytes;
    const byTime =
      this.policy.maxMinutes !== undefined &&
      now - this.startTs >= this.policy.maxMinutes * 60_000;

    if (!this.stream || bySize || byTime) {
      const oldStream = this.stream;
      const oldPath = (oldStream && (oldStream as unknown as { path?: string }).path) as string | undefined;
      if (oldStream) {
        oldStream.end();
      }
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
    if (!this.stream) {
      this.openNew();
    }
    this.stream!.write(`${line}\n`);
    this.bytes += Buffer.byteLength(line) + 1;
  }

  close() {
    if (!this.stream) {
      return;
    }
    const oldStream = this.stream;
    const oldPath = (oldStream as unknown as { path?: string }).path as string | undefined;
    oldStream.end();
    this.stream = null;
    if (oldPath && this.policy.gzipOnRotate) {
      this.gzipFile(oldPath);
    }
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }
}
