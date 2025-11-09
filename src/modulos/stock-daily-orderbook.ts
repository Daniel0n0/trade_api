import type { WriteStream } from 'node:fs';
import type { Response, WebSocket } from 'playwright';

import { registerCloser } from '../bootstrap/signals.js';
import { MODULE_URL_CODES } from '../config.js';
import { getCsvWriter } from '../io/csvWriter.js';
import { dataPath } from '../io/paths.js';
import { toCsvLine } from '../io/row.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { LEGEND_WS_PATTERN, normaliseFramePayload, safeJsonParse } from '../utils/payload.js';

const JSON_MIME_PATTERN = /application\/json/i;
const ORDERBOOK_URL_HINT = /order[-_ ]?book|level2|depth/i;

const ORDERBOOK_HEADER = ['ts', 'symbol', 'side', 'price', 'size', 'level', 'source'] as const;
type OrderbookHeader = typeof ORDERBOOK_HEADER;
type OrderbookRow = Partial<Record<OrderbookHeader[number], string | number | undefined>>;

// Limitamos la profundidad serializada para evitar archivos enormes en sesiones prolongadas.
const ORDERBOOK_DEPTH_LIMIT = 25;

type OrderbookLevel = {
  readonly side: 'bid' | 'ask';
  readonly price?: number;
  readonly size?: number;
  readonly level?: number;
};

type ProcessMeta = {
  readonly transport: 'http' | 'ws';
  readonly source: string;
};

const isJsonResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  return typeof contentType === 'string' && JSON_MIME_PATTERN.test(contentType);
};

const resolveSymbol = (symbols: readonly string[] | undefined): string => {
  if (!symbols || symbols.length === 0) {
    throw new Error('[stock-daily-orderbook] Se requiere al menos un símbolo para capturar el libro.');
  }
  for (const candidate of symbols) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed.toUpperCase();
    }
  }
  throw new Error('[stock-daily-orderbook] No se encontró un símbolo válido.');
};

const toNumber = (value: unknown): number | undefined => {
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
    const cleaned = trimmed.replace(/,/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const extractSymbolCandidate = (record: Record<string, unknown>): string | undefined => {
  const candidates = [record.symbol, record.eventSymbol, record.ticker, record.instrument];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return undefined;
};

const pushLevel = (levels: OrderbookLevel[], side: 'bid' | 'ask', entry: unknown, index: number) => {
  if (levels.length >= ORDERBOOK_DEPTH_LIMIT) {
    return;
  }
  if (entry == null) {
    return;
  }

  let price: number | undefined;
  let size: number | undefined;
  let level: number | undefined;

  if (Array.isArray(entry)) {
    price = toNumber(entry[0]);
    size = toNumber(entry[1]);
    level = toNumber(entry[2]);
  } else if (typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    price = toNumber(record.price ?? record[0]);
    size = toNumber(record.size ?? record.quantity ?? record.qty ?? record.volume);
    level = toNumber(record.level ?? record.depth ?? record.rank ?? record.position);
  }

  levels.push({
    side,
    price,
    size,
    level: level ?? index + 1,
  });
};

const collectOrderbookLevels = (payload: unknown, symbol: string): OrderbookLevel[] => {
  const levels: OrderbookLevel[] = [];
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    const candidateSymbol = extractSymbolCandidate(record);
    if (candidateSymbol && candidateSymbol !== symbol) {
      continue;
    }

    const bids = record.bids ?? record.Bids ?? record.buy ?? record.bid_levels;
    const asks = record.asks ?? record.Asks ?? record.sell ?? record.ask_levels;

    if (Array.isArray(bids) || Array.isArray(asks)) {
      const bidEntries = Array.isArray(bids) ? bids.slice(0, ORDERBOOK_DEPTH_LIMIT) : [];
      const askEntries = Array.isArray(asks) ? asks.slice(0, ORDERBOOK_DEPTH_LIMIT) : [];

      bidEntries.forEach((entry, index) => pushLevel(levels, 'bid', entry, index));
      askEntries.forEach((entry, index) => pushLevel(levels, 'ask', entry, index));
    }

    const levelsField = record.levels ?? record.level2 ?? record.book;
    if (Array.isArray(levelsField)) {
      for (const item of levelsField.slice(0, ORDERBOOK_DEPTH_LIMIT * 2)) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const entry = item as Record<string, unknown>;
        const sideValue = toNumber(entry.side) ?? toNumber(entry.s);
        let side: 'bid' | 'ask' | undefined;
        const rawSide = entry.side ?? entry.S;
        if (typeof rawSide === 'string') {
          const normalized = rawSide.trim().toLowerCase();
          if (normalized.startsWith('b')) {
            side = 'bid';
          } else if (normalized.startsWith('a')) {
            side = 'ask';
          }
        }
        if (!side && sideValue !== undefined) {
          side = sideValue <= 0 ? 'bid' : 'ask';
        }
        if (!side) {
          continue;
        }
        pushLevel(levels, side, entry, levels.length);
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return levels;
};

const writeRows = (stream: WriteStream, symbol: string, meta: ProcessMeta, levels: OrderbookLevel[]) => {
  const ts = Date.now();
  for (const level of levels) {
    const row: OrderbookRow = {
      ts,
      symbol,
      side: level.side,
      price: level.price,
      size: level.size,
      level: level.level,
      source: meta.source,
    };
    stream.write(`${toCsvLine(ORDERBOOK_HEADER, row)}\n`);
  }
};

const closeStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve) => {
    const finalize = () => resolve();
    const handleError = () => {
      stream.off('close', finalize);
      finalize();
    };
    stream.once('close', finalize);
    stream.once('error', handleError);
    if ((stream as { closed?: boolean }).closed || stream.destroyed || stream.writableEnded) {
      stream.off('close', finalize);
      stream.off('error', handleError);
      resolve();
      return;
    }
    stream.end();
  });

export const runStockDailyOrderbookModule: ModuleRunner = async (args, { page }) => {
  const symbol = resolveSymbol(args.symbols);
  const urlCode = args.urlCode ?? MODULE_URL_CODES['stock-daily-orderbook'];
  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'orderbook', 'levels.csv');

  const stream = getCsvWriter(csvPath, ORDERBOOK_HEADER);
  const websocketClosers = new Map<WebSocket, () => void>();

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const upperUrl = url.toUpperCase();
    const containsSymbol = upperUrl.includes(symbol.toUpperCase());
    const containsCode = urlCode ? upperUrl.includes(urlCode.toUpperCase()) : false;
    return containsSymbol || containsCode || ORDERBOOK_URL_HINT.test(url);
  };

  const processPayload = (payload: unknown, meta: ProcessMeta) => {
    const levels = collectOrderbookLevels(payload, symbol);
    if (levels.length === 0) {
      return;
    }
    writeRows(stream, symbol, meta, levels);
  };

  const handleResponse = async (response: Response) => {
    if (!isJsonResponse(response)) {
      return;
    }
    const url = response.url();
    if (!shouldProcessUrl(url)) {
      return;
    }
    if (response.status() >= 400) {
      return;
    }

    let parsed: unknown;
    try {
      const text = await response.text();
      if (!text) {
        return;
      }
      parsed = safeJsonParse(text);
    } catch (error) {
      console.warn('[stock-daily-orderbook] No se pudo leer la respuesta JSON:', error);
      return;
    }

    if (!parsed) {
      return;
    }

    processPayload(parsed, { transport: 'http', source: url });
  };

  const handleWebSocket = (socket: WebSocket) => {
    const url = socket.url();
    if (!LEGEND_WS_PATTERN.test(url)) {
      return;
    }

    const onFrame = (frame: string) => {
      const { parsed, text } = normaliseFramePayload(frame);
      const payload = parsed ?? (text ? safeJsonParse(text) : undefined);
      if (!payload) {
        return;
      }
      processPayload(payload, { transport: 'ws', source: url });
    };

    const onClose = () => {
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
      websocketClosers.delete(socket);
    };

    socket.on('framereceived', onFrame);
    socket.on('close', onClose);
    websocketClosers.set(socket, () => {
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
    });
  };

  page.on('response', handleResponse);
  page.on('websocket', handleWebSocket);

  registerCloser(async () => {
    page.off('response', handleResponse);
    page.off('websocket', handleWebSocket);
    for (const closer of websocketClosers.values()) {
      closer();
    }
    websocketClosers.clear();
    await closeStream(stream);
  });

  return csvPath;
};

