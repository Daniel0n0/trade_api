import { z } from 'zod';

const optionalString: z.ZodType<string | undefined> = z
  .any()
  .transform((value: unknown) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const str = typeof value === 'string' ? value : String(value);
    const trimmed = str.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

const optionalNumber: z.ZodType<number | undefined> = z
  .any()
  .transform((value: unknown) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  });

export const BaseEvent = z
  .object({
    eventType: optionalString,
    eventSymbol: optionalString,
    symbol: optionalString,
    eventFlags: optionalNumber,
    time: optionalNumber,
    eventTime: optionalNumber,
    open: optionalNumber,
    high: optionalNumber,
    low: optionalNumber,
    close: optionalNumber,
    volume: optionalNumber,
    vwap: optionalNumber,
    count: optionalNumber,
    sequence: optionalNumber,
    impliedVolatility: optionalNumber,
    openInterest: optionalNumber,
    price: optionalNumber,
    dayVolume: optionalNumber,
    bidPrice: optionalNumber,
    bidSize: optionalNumber,
    bidTime: optionalNumber,
    askPrice: optionalNumber,
    askSize: optionalNumber,
    askTime: optionalNumber,
  })
  .passthrough();

export type BaseEvent = z.infer<typeof BaseEvent>;
