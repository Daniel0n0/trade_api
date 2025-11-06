import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

type Serializable = Record<string, unknown>;

const DEFAULT_SYMBOLS = ['SPY'];
const DEFAULT_PREFIX = 'socket';
const MAX_ENTRY_TEXT_LENGTH = 200_000;
const HOOK_GUARD_FLAG = '__socketSnifferHooked__';

type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
};

type LogEntry = Serializable & {
  readonly ts: number;
};

function timestampString(): string {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}-` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

function ensureArtifactsDir(): string {
  const dir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createLogPath(prefix: string): string {
  return path.join(ensureArtifactsDir(), `${prefix}-${timestampString()}.jsonl`);
}

function normaliseSymbols(input: readonly string[]): readonly string[] {
  return input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

async function exposeLogger(page: Page, logPath: string): Promise<void> {
  const writeEntry = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
  };

  await page.exposeFunction('socketSnifferLog', (entry: Serializable) => {
    try {
      writeEntry(entry);
    } catch (error) {
      /* eslint-disable no-console */
      console.error('[socket-sniffer] Error al escribir log:', error);
      /* eslint-enable no-console */
    }
  });
}

function buildHookScript() {
  return (
    (wantedSymbols: readonly string[], maxTextLength: number, hookGuardFlag: string) => {
      const globalObject = window as typeof window & {
        socketSnifferLog?: (entry: Serializable) => void;
        [key: string]: unknown;
      };

      const guardKey = hookGuardFlag || '__socketSnifferHooked__';
      if (globalObject[guardKey]) {
        return;
      }

      globalObject[guardKey] = true;

      const upperSymbols = new Set(
        (wantedSymbols ?? [])
          .map((symbol) => (typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''))
          .filter((symbol) => symbol.length > 0),
      );

      const shouldKeep = (payload: unknown): boolean => {
        if (!upperSymbols.size) {
          return true;
        }

        const extractSymbol = (value: unknown): string | undefined => {
          if (!value || typeof value !== 'object') {
            return undefined;
          }
          const data = value as Record<string, unknown>;
          const candidates = [
            data?.data && (data.data as Record<string, unknown>).eventSymbol,
            data?.eventSymbol,
            data?.symbol,
            data?.result && (data.result as Record<string, unknown>).symbol,
          ];
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
              return candidate.trim().toUpperCase();
            }
          }
          return undefined;
        };

        const symbol = extractSymbol(payload);
        return !symbol || upperSymbols.has(symbol);
      };

      const safeLog = (entry: Serializable) => {
        try {
          globalObject.socketSnifferLog?.(entry);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[socket-sniffer] Error al enviar log:', error);
        }
      };

      const truncate = (text: string | null): string | null => {
        if (typeof text !== 'string') {
          return null;
        }
        return text.length > maxTextLength ? text.slice(0, maxTextLength) : text;
      };

      // --- WebSocket hook ---
      (() => {
        const OriginalWebSocket = window.WebSocket;
        const originalSend = OriginalWebSocket.prototype.send;

        const wrapMessage = (url: string, text: string | null, parsed: unknown, kind: 'ws-message' | 'ws-send') => {
          const entry: Serializable = { kind, url, text: truncate(text) };
          if (parsed !== undefined) {
            entry.parsed = parsed as Serializable;
          }
          safeLog(entry);
        };

        const normaliseUrl = (arg: unknown): string => {
          if (typeof arg === 'string') {
            return arg;
          }
          if (arg instanceof URL) {
            return arg.toString();
          }
          return '';
        };

        function PatchedWebSocket(this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
          const ws = new OriginalWebSocket(...args);
          const url = normaliseUrl(args?.[0]);

          ws.addEventListener('message', (event) => {
            let parsed: unknown;
            let text: string | null = null;

            if (typeof event.data === 'string') {
              text = event.data;
              try {
                parsed = JSON.parse(event.data);
              } catch (error) {
                void error;
              }
            }

            if (parsed && !shouldKeep(parsed)) {
              return;
            }

            wrapMessage(url, text, parsed, 'ws-message');
          });

          return ws;
        }

        PatchedWebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;

        OriginalWebSocket.prototype.send = function patchedSend(
          this: WebSocket,
          data: Parameters<WebSocket['send']>[0],
        ) {
          let text: string | null = null;
          let parsed: unknown;

          if (typeof data === 'string') {
            text = data;
            try {
              parsed = JSON.parse(data);
            } catch (error) {
              void error;
            }
            if (parsed && !shouldKeep(parsed)) {
              return originalSend.apply(this, [data]);
            }
          }

          wrapMessage((this as { url?: string }).url ?? '', text, parsed, 'ws-send');
          return originalSend.apply(this, [data]);
        };
      })();

      // --- fetch hook ---
      (() => {
        const originalFetch = window.fetch.bind(window);

        window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
          const request = args[0];
          let url = '';
          if (typeof request === 'string') {
            url = request;
          } else if (request instanceof Request) {
            url = request.url;
          } else if (request instanceof URL) {
            url = request.toString();
          }
          const response = await originalFetch(...args);

          try {
            if (/quotes\/historicals|instruments|options/i.test(url)) {
              const clone = response.clone();
              const text = await clone.text();
              safeLog({ kind: 'http', url, text: truncate(text) });
            }
          } catch (error) {
            void error;
          }

          return response;
        };
      })();
    }
  );
}

export async function runSocketSniffer(
  page: Page,
  options: SocketSnifferOptions = {},
): Promise<string> {
  const symbols = normaliseSymbols(options.symbols ?? DEFAULT_SYMBOLS);
  const prefix = options.logPrefix?.trim() || DEFAULT_PREFIX;
  const logPath = createLogPath(prefix);

  /* eslint-disable no-console */
  console.log(`[socket-sniffer] Registrando en: ${logPath}`);
  console.log(
    symbols.length > 0
      ? `[socket-sniffer] Símbolos filtrados: ${symbols.join(', ')}`
      : '[socket-sniffer] Capturando todos los símbolos.',
  );
  /* eslint-enable no-console */

  await exposeLogger(page, logPath);

  const hookScript = buildHookScript();
  const hookScriptWrapper = function(arg: (string | number | readonly string[])[]) {
    const [wantedSymbols, maxTextLength, hookGuardFlag] = arg as [readonly string[], number, string];
    return (buildHookScript() as any)(wantedSymbols, maxTextLength, hookGuardFlag);
  };
  await page.addInitScript(hookScriptWrapper, [symbols, MAX_ENTRY_TEXT_LENGTH, HOOK_GUARD_FLAG]);
  await page.evaluate(
    (args) => {
      const [wantedSymbols, maxTextLength, hookGuardFlag] = args as [readonly string[], number, string];
      (buildHookScript() as any)(wantedSymbols, maxTextLength, hookGuardFlag);
    },
    [symbols, MAX_ENTRY_TEXT_LENGTH, HOOK_GUARD_FLAG]
  );

  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (error) {
    /* eslint-disable no-console */
    console.warn('[socket-sniffer] No se pudo recargar la página automáticamente:', error);
    /* eslint-enable no-console */
  }

  page.once('close', () => {
    /* eslint-disable no-console */
    console.log(`[socket-sniffer] Página cerrada. Log disponible en: ${logPath}`);
    /* eslint-enable no-console */
  });

  return logPath;
}
