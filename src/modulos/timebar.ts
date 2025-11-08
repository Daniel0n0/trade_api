export type TradeLike = {
  readonly price: number;
  readonly size?: number;
  readonly dayVolume?: number;
  readonly session?: string;
  readonly ts: number;
  readonly symbol?: string;
};

export type QuoteLike = {
  readonly bidPrice?: number;
  readonly askPrice?: number;
  readonly ts: number;
  readonly symbol?: string;
};

export type CandleLike = {
  readonly ts: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly symbol?: string;
};

export type Bar = {
  readonly t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BucketSource = 'aggregated' | 'native' | 'mixed';

type BucketState = {
  readonly symbol: string;
  readonly bucketStart: number;
  readonly bar: Bar;
  readonly lastDayVolumeBySession: Map<string, number>;
  source: BucketSource;
};

const REGULAR_SESSION_KEY = 'REG';

export type AggregatorConfig = {
  readonly timeframe: string;
  readonly periodMs: number;
  readonly preferNative?: boolean;
};

export type AggregatedBarResult = {
  readonly timeframe: string;
  readonly symbol: string;
  readonly bar: Bar;
  readonly source: BucketSource;
};

export class BarAggregator {
  private readonly timeframe: string;

  private readonly periodMs: number;

  private readonly preferNative: boolean;

  private readonly buckets: Map<string, BucketState> = new Map();

  constructor(config: AggregatorConfig) {
    this.timeframe = config.timeframe;
    this.periodMs = config.periodMs;
    this.preferNative = Boolean(config.preferNative);
  }

  private normalizeSymbol(symbol: string | undefined): string {
    if (typeof symbol !== 'string') {
      return 'GENERAL';
    }
    const trimmed = symbol.trim();
    return trimmed || 'GENERAL';
  }

  private bucketStart(ts: number): number {
    return Math.floor(ts / this.periodMs) * this.periodMs;
  }

  private buildBucketKey(symbol: string, bucketStart: number): string {
    return `${symbol}__${bucketStart}`;
  }

  private ensureState(symbol: string, bucketStart: number, price: number): BucketState {
    const key = this.buildBucketKey(symbol, bucketStart);
    let state = this.buckets.get(key);
    if (!state) {
      const bar: Bar = { t: bucketStart, open: price, high: price, low: price, close: price, volume: 0 };
      state = {
        symbol,
        bucketStart,
        bar,
        lastDayVolumeBySession: new Map(),
        source: 'aggregated',
      };
      this.buckets.set(key, state);
    }
    return state;
  }

  addTrade(trade: TradeLike | undefined): void {
    if (!trade || !Number.isFinite(trade.price) || !Number.isFinite(trade.ts)) {
      return;
    }
    const symbol = this.normalizeSymbol(trade.symbol);
    const start = this.bucketStart(trade.ts);
    const state = this.ensureState(symbol, start, trade.price);
    const { bar, lastDayVolumeBySession } = state;

    if (this.preferNative && state.source === 'native') {
      return;
    }

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
          state.source = state.source === 'native' ? 'mixed' : 'aggregated';
          return;
        }
      }
    }

    if (typeof trade.size === 'number' && Number.isFinite(trade.size)) {
      bar.volume += trade.size;
    } else {
      bar.volume += 1;
    }
    state.source = state.source === 'native' ? 'mixed' : 'aggregated';
  }

  addQuote(quote: QuoteLike | undefined): void {
    if (!quote || !Number.isFinite(quote.ts)) {
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
    const symbol = this.normalizeSymbol(quote.symbol);
    const start = this.bucketStart(quote.ts);
    const state = this.ensureState(symbol, start, mid);
    if (this.preferNative && state.source === 'native') {
      return;
    }

    const bar = state.bar;
    if (mid > bar.high) {
      bar.high = mid;
    }
    if (mid < bar.low) {
      bar.low = mid;
    }
    bar.close = mid;
    state.source = state.source === 'native' ? 'mixed' : 'aggregated';
  }

  addCandle(candle: CandleLike | undefined): void {
    if (!candle) {
      return;
    }
    const { ts, open, high, low, close, volume } = candle;
    if (![ts, open, high, low, close].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return;
    }
    const symbol = this.normalizeSymbol(candle.symbol);
    const start = this.bucketStart(ts);
    const key = this.buildBucketKey(symbol, start);
    const existing = this.buckets.get(key);
    const barVolume = typeof volume === 'number' && Number.isFinite(volume) ? volume : undefined;
    if (!existing) {
      const bar: Bar = {
        t: start,
        open,
        high,
        low,
        close,
        volume: barVolume ?? 0,
      };
      this.buckets.set(key, {
        symbol,
        bucketStart: start,
        bar,
        lastDayVolumeBySession: new Map(),
        source: 'native',
      });
      return;
    }

    const bar = existing.bar;
    bar.open = open;
    bar.high = high;
    bar.low = low;
    bar.close = close;
    if (barVolume !== undefined) {
      bar.volume = barVolume;
    }
    existing.source = this.preferNative ? 'native' : existing.source === 'aggregated' ? 'mixed' : 'native';
  }

  drainClosed(nowTs: number): readonly AggregatedBarResult[] {
    const out: AggregatedBarResult[] = [];
    const cutoff = this.bucketStart(nowTs) - this.periodMs;
    for (const [key, state] of this.buckets) {
      if (state.bucketStart <= cutoff) {
        out.push({
          timeframe: this.timeframe,
          symbol: state.symbol,
          bar: { ...state.bar },
          source: state.source,
        });
        this.buckets.delete(key);
      }
    }
    out.sort((a, b) => (a.bar.t === b.bar.t ? a.symbol.localeCompare(b.symbol) : a.bar.t - b.bar.t));
    return out;
  }

  drainAll(): readonly AggregatedBarResult[] {
    const out = Array.from(this.buckets.values(), (state) => ({
      timeframe: this.timeframe,
      symbol: state.symbol,
      bar: { ...state.bar },
      source: state.source,
    }));
    this.buckets.clear();
    out.sort((a, b) => (a.bar.t === b.bar.t ? a.symbol.localeCompare(b.symbol) : a.bar.t - b.bar.t));
    return out;
  }
}
