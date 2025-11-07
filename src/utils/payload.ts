export function toText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof Buffer !== 'undefined' && payload && Buffer.isBuffer?.(payload)) {
    return (payload as Buffer).toString('utf8');
  }

  if (payload == null) {
    return '';
  }

  return String(payload);
}

export const payloadToText = toText;

export function safeJsonParse<T = unknown>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export type FeedPacket = {
  readonly channel: number;
  readonly data: readonly unknown[];
};

export function extractFeed(parsed: unknown): FeedPacket | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const payload = (parsed as { payload?: unknown })?.payload ?? parsed;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const channelCandidate =
    record.channel ??
    record.ch ??
    record.c ??
    (record.payload && (record.payload as Record<string, unknown>).channel);
  const dataCandidate =
    record.data ?? record.d ?? (record.payload && (record.payload as Record<string, unknown>).data);

  const channel = Number(channelCandidate);
  if (!Number.isFinite(channel)) {
    return null;
  }

  if (!Array.isArray(dataCandidate)) {
    return null;
  }

  return { channel, data: dataCandidate };
}
