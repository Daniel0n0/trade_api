export type TradeLike = {
  readonly price: number;
  readonly size?: number;
  readonly dayVolume?: number;
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

export class BarAggregator {
  private readonly tfMs: number;

  private readonly buckets: Map<number, Bar> = new Map();

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
    let bar = this.buckets.get(start);
    if (!bar) {
      bar = { t: start, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: 0 };
      this.buckets.set(start, bar);
    } else {
      if (trade.price > bar.high) {
        bar.high = trade.price;
      }
      if (trade.price < bar.low) {
        bar.low = trade.price;
      }
      bar.close = trade.price;
    }
    if (typeof trade.dayVolume === 'number' && Number.isFinite(trade.dayVolume)) {
      bar.volume += 1;
    } else if (typeof trade.size === 'number' && Number.isFinite(trade.size)) {
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
    let bar = this.buckets.get(start);
    if (!bar) {
      bar = { t: start, open: mid, high: mid, low: mid, close: mid, volume: 0 };
      this.buckets.set(start, bar);
    } else {
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
    for (const [bucket, bar] of this.buckets) {
      if (bucket <= cutoff) {
        out.push(bar);
        this.buckets.delete(bucket);
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  drainAll(): readonly Bar[] {
    const out = Array.from(this.buckets.values());
    this.buckets.clear();
    out.sort((a, b) => a.t - b.t);
    return out;
  }
}
