export type TradeLike = {
  readonly price: number;
  readonly size?: number;
  readonly dayVolume?: number;
  readonly session?: string;
  readonly ts: number;
};

export type QuoteLike = {
  readonly bidPrice?: number;
  readonly askPrice?: number;
  readonly ts: number;
};

export type Bar = {
  readonly t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BucketState = {
  readonly bar: Bar;
  readonly lastDayVolumeBySession: Map<string, number>;
};

const REGULAR_SESSION_KEY = 'REG';

export class BarAggregator {
  private readonly tfMs: number;

  private readonly buckets: Map<number, BucketState> = new Map();

  constructor(tfMinutes: number) {
    this.tfMs = tfMinutes * 60_000;
  }

  private bucketStart(ts: number): number {
    return Math.floor(ts / this.tfMs) * this.tfMs;
  }

  addTrade(trade: TradeLike | undefined): void {
    if (!trade || !Number.isFinite(trade.price)) {
      return;
    }
    const start = this.bucketStart(trade.ts);
    let state = this.buckets.get(start);
    if (!state) {
      state = {
        bar: { t: start, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: 0 },
        lastDayVolumeBySession: new Map(),
      };
      this.buckets.set(start, state);
    }
    const { bar, lastDayVolumeBySession } = state;

    if (trade.price > bar.high) {
      bar.high = trade.price;
    }
    if (trade.price < bar.low) {
      bar.low = trade.price;
    }
    bar.close = trade.price;

    const sessionRaw = typeof trade.session === 'string' ? trade.session.trim() : '';
    const sessionKey = sessionRaw ? sessionRaw : REGULAR_SESSION_KEY;
    if (typeof trade.dayVolume === 'number' && Number.isFinite(trade.dayVolume)) {
      const last = lastDayVolumeBySession.get(sessionKey);
      lastDayVolumeBySession.set(sessionKey, trade.dayVolume);
      if (last !== undefined) {
        const delta = trade.dayVolume - last;
        if (delta > 0 && Number.isFinite(delta)) {
          bar.volume += delta;
          return;
        }
      }
    }

    if (typeof trade.size === 'number' && Number.isFinite(trade.size)) {
      bar.volume += trade.size;
    } else {
      bar.volume += 1;
    }
  }

  addQuote(quote: QuoteLike | undefined): void {
    if (!quote) {
      return;
    }
    const bid = typeof quote.bidPrice === 'number' ? quote.bidPrice : undefined;
    const ask = typeof quote.askPrice === 'number' ? quote.askPrice : undefined;
    const mid =
      bid !== undefined && ask !== undefined
        ? (bid + ask) / 2
        : bid !== undefined
        ? bid
        : ask !== undefined
        ? ask
        : undefined;
    if (mid === undefined || !Number.isFinite(mid) || mid <= 0) {
      return;
    }
    const start = this.bucketStart(quote.ts);
    let state = this.buckets.get(start);
    if (!state) {
      state = {
        bar: { t: start, open: mid, high: mid, low: mid, close: mid, volume: 0 },
        lastDayVolumeBySession: new Map(),
      };
      this.buckets.set(start, state);
    } else {
      const bar = state.bar;
      if (mid > bar.high) {
        bar.high = mid;
      }
      if (mid < bar.low) {
        bar.low = mid;
      }
      bar.close = mid;
    }
  }

  drainClosed(nowTs: number): readonly Bar[] {
    const out: Bar[] = [];
    const cutoff = this.bucketStart(nowTs) - this.tfMs;
    for (const [bucket, state] of this.buckets) {
      if (bucket <= cutoff) {
        out.push(state.bar);
        this.buckets.delete(bucket);
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  drainAll(): readonly Bar[] {
    const out = Array.from(this.buckets.values(), (state) => state.bar);
    this.buckets.clear();
    out.sort((a, b) => a.t - b.t);
    return out;
  }
}
