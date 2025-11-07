export function payloadToText(payload: unknown): string {
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
