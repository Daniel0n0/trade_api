import type { Page } from 'playwright';

type FrameKey = '1D' | '1H' | '15m';
type MetricKey =
  | 'spot'
  | 'open'
  | 'high'
  | 'low'
  | 'close'
  | 'volume'
  | 'ema8'
  | 'ema21'
  | 'ema50'
  | 'rsi14'
  | 'macd12_26_9'
  | 'obv'
  | 'aavwap1000';

type LabelMatchType = 'text' | 'aria-label' | 'data-testid' | 'title';

interface SerializedPattern {
  readonly source: string;
  readonly flags?: string;
}

interface FrameDefinition {
  readonly key: FrameKey;
  readonly labelPatterns: readonly SerializedPattern[];
  readonly minIndicatorKeywords: number;
}

interface MetricDefinition {
  readonly key: MetricKey;
  readonly labelPatterns: readonly SerializedPattern[];
  readonly valuePatterns: readonly SerializedPattern[];
  readonly allowStandaloneValue?: boolean;
}

interface EvaluateOptions {
  readonly frames: readonly FrameDefinition[];
  readonly metrics: readonly MetricDefinition[];
  readonly indicatorKeywords: readonly string[];
}

interface EvaluateMetricResult {
  readonly key: MetricKey;
  readonly value: string | null;
  readonly labelText?: string;
  readonly labelMatchType?: LabelMatchType;
  readonly valueSource?: string;
  readonly containerHint?: string;
}

interface EvaluateFrameResult {
  readonly key: FrameKey;
  readonly containerFound: boolean;
  readonly containerHint?: string;
  readonly metrics: readonly EvaluateMetricResult[];
}

interface EvaluateResult {
  readonly frames: readonly EvaluateFrameResult[];
}

const POLL_INTERVAL_MS = 5_000;

const createPattern = (pattern: RegExp): SerializedPattern => ({
  source: pattern.source,
  flags: pattern.flags,
});

const NUMBER_PATTERN = createPattern(/[-+]?\d[\d,.]*(?:\s*(?:k|m|b|mm|mill|millones|%))?/i);
const MACD_PATTERN = createPattern(/[-+]?\d[\d,.]*(?:\s*[,/]\s*[-+]?\d[\d,.]*){0,2}/);

const TIMEFRAME_DEFINITIONS: readonly FrameDefinition[] = [
  {
    key: '1D',
    labelPatterns: [
      createPattern(/\b1\s*d(ay)?\b/i),
      createPattern(/\b1\s*d[ií]a\b/i),
      createPattern(/\b1d\b/i),
      createPattern(/\bday\b/i),
    ],
    minIndicatorKeywords: 2,
  },
  {
    key: '1H',
    labelPatterns: [
      createPattern(/\b1\s*h(our)?\b/i),
      createPattern(/\b1\s*h\b/i),
      createPattern(/\b1\s*hora\b/i),
      createPattern(/\b1h\b/i),
    ],
    minIndicatorKeywords: 2,
  },
  {
    key: '15m',
    labelPatterns: [
      createPattern(/\b15\s*m(in(ute|utos)?)?\b/i),
      createPattern(/\b15m\b/i),
    ],
    minIndicatorKeywords: 2,
  },
];

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'spot',
    labelPatterns: [
      createPattern(/spot/i),
      createPattern(/last\s*price/i),
      createPattern(/market\s*price/i),
      createPattern(/current\s*price/i),
      createPattern(/precio\s*actual/i),
      createPattern(/precio\s*de\s*mercado/i),
      createPattern(/mark\s*price/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
    allowStandaloneValue: true,
  },
  {
    key: 'open',
    labelPatterns: [
      createPattern(/^o$/i),
      createPattern(/open/i),
      createPattern(/apertura/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'high',
    labelPatterns: [
      createPattern(/^h$/i),
      createPattern(/high/i),
      createPattern(/alto/i),
      createPattern(/m[aá]ximo/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'low',
    labelPatterns: [
      createPattern(/^l$/i),
      createPattern(/low/i),
      createPattern(/bajo/i),
      createPattern(/m[ií]nimo/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'close',
    labelPatterns: [
      createPattern(/^c$/i),
      createPattern(/close/i),
      createPattern(/cierre/i),
      createPattern(/closing/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'volume',
    labelPatterns: [
      createPattern(/volume/i),
      createPattern(/volumen/i),
      createPattern(/^vol\.?$/i),
      createPattern(/\bvol\.?\b/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'ema8',
    labelPatterns: [
      createPattern(/ema[-\s]*8/i),
      createPattern(/ema8/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'ema21',
    labelPatterns: [
      createPattern(/ema[-\s]*21/i),
      createPattern(/ema21/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'ema50',
    labelPatterns: [
      createPattern(/ema[-\s]*50/i),
      createPattern(/ema50/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'rsi14',
    labelPatterns: [
      createPattern(/rsi\s*14/i),
      createPattern(/rsi14/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'macd12_26_9',
    labelPatterns: [
      createPattern(/macd/i),
    ],
    valuePatterns: [MACD_PATTERN, NUMBER_PATTERN],
  },
  {
    key: 'obv',
    labelPatterns: [
      createPattern(/obv/i),
      createPattern(/on\s*balance\s*volume/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
  {
    key: 'aavwap1000',
    labelPatterns: [
      createPattern(/aavwap/i),
      createPattern(/anchored\s*avwap/i),
      createPattern(/anchored\s*vwap/i),
      createPattern(/anchored\s*volume\s*weighted\s*average\s*price/i),
    ],
    valuePatterns: [NUMBER_PATTERN],
  },
];

const INDICATOR_KEYWORDS: readonly string[] = [
  'open',
  'high',
  'low',
  'close',
  'volume',
  'volumen',
  'ema',
  'rsi',
  'macd',
  'obv',
  'vwap',
  'precio',
  'spot',
  'anchored',
  'last',
];

export async function runSpyDailyHourly15mModule(page: Page): Promise<void> {
  const moduleId = 'spy-daily-hourly-15m';
  const logPrefix = `[${moduleId}]`;

  /* eslint-disable no-console */
  console.log(`${logPrefix} Inicializando instrumentación para localizar métricas (1D / 1H / 15m).`);
  /* eslint-enable no-console */

  await page.waitForLoadState('domcontentloaded');

  const previousValues = new Map<string, string | null>();
  const seenContainers = new Set<FrameKey>();

  let disposed = false;

  const poll = async (): Promise<void> => {
    if (disposed || page.isClosed()) {
      return;
    }

    try {
      const snapshot = await page.evaluate(extractSpySnapshot, {
        frames: TIMEFRAME_DEFINITIONS,
        metrics: METRIC_DEFINITIONS,
        indicatorKeywords: INDICATOR_KEYWORDS,
      } satisfies EvaluateOptions);

      if (!snapshot) {
        return;
      }

      for (const frame of snapshot.frames) {
        if (!frame.containerFound) {
          const containerKey = `container:${frame.key}`;
          if (!previousValues.has(containerKey)) {
            previousValues.set(containerKey, null);
            /* eslint-disable no-console */
            console.warn(`${logPrefix} No se encontró un contenedor visible para la temporalidad ${frame.key}.`);
            /* eslint-enable no-console */
          }
          continue;
        }

        if (!seenContainers.has(frame.key)) {
          seenContainers.add(frame.key);
          /* eslint-disable no-console */
          console.log(
            `${logPrefix} Se detectó contenedor para ${frame.key}: ${frame.containerHint ?? 'sin detalles adicionales'}.`,
          );
          /* eslint-enable no-console */
        }

        for (const metric of frame.metrics) {
          const key = `${frame.key}:${metric.key}`;
          const previousValue = previousValues.get(key);

          if (previousValue !== metric.value) {
            previousValues.set(key, metric.value);

            const details: string[] = [];
            if (metric.labelText) {
              const labelDetail =
                metric.labelMatchType && metric.labelMatchType !== 'text'
                  ? `label(${metric.labelMatchType})="${metric.labelText}"`
                  : `label="${metric.labelText}"`;
              details.push(labelDetail);
            }
            if (!metric.labelText && metric.labelMatchType) {
              details.push(`label(${metric.labelMatchType})`);
            }
            if (metric.valueSource) {
              details.push(`origen=${metric.valueSource}`);
            }
            if (metric.containerHint) {
              details.push(`contenedor=${metric.containerHint}`);
            }

            const suffix = details.length ? ` (${details.join(' | ')})` : '';

            /* eslint-disable no-console */
            console.log(
              `${logPrefix} [${frame.key}] ${metric.key} => ${metric.value ?? 'N/D'}${suffix}`,
            );
            /* eslint-enable no-console */
          }
        }
      }
    } catch (error) {
      /* eslint-disable no-console */
      console.error(`${logPrefix} Error al evaluar los datos del módulo:`, error);
      /* eslint-enable no-console */
    }
  };

  await poll();
  const interval = setInterval(poll, POLL_INTERVAL_MS);

  page.once('close', () => {
    disposed = true;
    clearInterval(interval);
  });
}

function extractSpySnapshot(options: EvaluateOptions): EvaluateResult {
  const makeRegExp = (pattern: SerializedPattern): RegExp | null => {
    try {
      return new RegExp(pattern.source, pattern.flags ?? '');
    } catch (_error) {
      return null;
    }
  };

  const normalizeText = (input: string | null | undefined): string =>
    (input ?? '').replace(/\s+/g, ' ').trim();

  const describeElement = (element: Element | null | undefined): string | undefined => {
    if (!element) {
      return undefined;
    }

    const parts: string[] = [element.tagName.toLowerCase()];

    if ((element as HTMLElement).id) {
      parts.push(`#${(element as HTMLElement).id}`);
    }

    const className = (element as HTMLElement).className;
    if (typeof className === 'string' && className.trim()) {
      const classParts = className
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => `.${name}`);
      parts.push(...classParts);
    }

    const dataTestId = element.getAttribute('data-testid');
    if (dataTestId) {
      parts.push(`[data-testid="${dataTestId}"]`);
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      parts.push(`[aria-label="${ariaLabel}"]`);
    }

    return parts.join('');
  };

  const getElementSources = (
    element: HTMLElement,
  ): { kind: LabelMatchType; value: string }[] => {
    const sources: { kind: LabelMatchType; value: string }[] = [];

    const textContent = normalizeText(element.textContent ?? '');
    if (textContent) {
      sources.push({ kind: 'text', value: textContent });
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      const normalized = normalizeText(ariaLabel);
      if (normalized) {
        sources.push({ kind: 'aria-label', value: normalized });
      }
    }

    const dataTestId = element.getAttribute('data-testid');
    if (dataTestId) {
      const trimmed = dataTestId.trim();
      if (trimmed) {
        sources.push({ kind: 'data-testid', value: trimmed });
      }
    }

    const title = element.getAttribute('title');
    if (title) {
      const normalized = normalizeText(title);
      if (normalized) {
        sources.push({ kind: 'title', value: normalized });
      }
    }

    return sources;
  };

  const frames = options.frames.map((frame) => ({
    key: frame.key,
    patterns: frame.labelPatterns.map(makeRegExp).filter(Boolean) as RegExp[],
    minIndicatorKeywords: frame.minIndicatorKeywords,
  }));

  const metrics = options.metrics.map((metric) => ({
    key: metric.key,
    labelPatterns: metric.labelPatterns.map(makeRegExp).filter(Boolean) as RegExp[],
    valuePatterns: metric.valuePatterns.map(makeRegExp).filter(Boolean) as RegExp[],
    allowStandaloneValue: Boolean(metric.allowStandaloneValue),
  }));

  const indicatorKeywords = options.indicatorKeywords.map((keyword) => keyword.toLowerCase());

  const countKeywordMatches = (text: string): number => {
    const lower = text.toLowerCase();
    let count = 0;
    for (const keyword of indicatorKeywords) {
      if (lower.includes(keyword)) {
        count += 1;
      }
    }
    return count;
  };

  const extractValueFromText = (
    text: string,
    patterns: readonly RegExp[],
    kind: LabelMatchType = 'text',
  ): { value: string; source: string } | null => {
    const snippet = text.slice(0, 120);
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match && match[0]) {
        return { value: match[0], source: `${kind}:"${snippet}"` };
      }
    }
    return null;
  };

  const attachElementContext = (
    info: { value: string; source: string },
    element: HTMLElement | null | undefined,
  ): { value: string; source: string } => {
    if (!element) {
      return info;
    }

    const descriptor = describeElement(element);
    if (!descriptor) {
      return info;
    }

    return { value: info.value, source: `${info.source} en ${descriptor}` };
  };

  const collectAncestors = (element: HTMLElement, depth: number): HTMLElement[] => {
    const ancestors: HTMLElement[] = [];
    let current: HTMLElement | null = element.parentElement;
    let remaining = depth;
    while (current && remaining > 0) {
      ancestors.push(current);
      current = current.parentElement;
      remaining -= 1;
    }
    return ancestors;
  };

  const findNeighborValue = (
    label: HTMLElement,
    patterns: readonly RegExp[],
  ): { value: string; source: string } | null => {
    const queue: HTMLElement[] = [];
    const visited = new Set<HTMLElement>();

    const enqueue = (element: Element | null | undefined): void => {
      if (element instanceof HTMLElement && !visited.has(element)) {
        queue.push(element);
      }
    };

    const parent = label.parentElement;
    if (parent) {
      enqueue(parent);
      enqueue(parent.nextElementSibling);
      enqueue(parent.previousElementSibling);
      for (const sibling of Array.from(parent.children)) {
        if (sibling instanceof HTMLElement && sibling !== label) {
          enqueue(sibling);
        }
      }
    }

    enqueue(label.nextElementSibling);
    enqueue(label.previousElementSibling);

    for (const ancestor of collectAncestors(label, 2)) {
      enqueue(ancestor);
      enqueue(ancestor.nextElementSibling);
      enqueue(ancestor.previousElementSibling);
    }

    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate || visited.has(candidate)) {
        continue;
      }
      visited.add(candidate);

      for (const child of Array.from(candidate.children)) {
        if (child instanceof HTMLElement && !visited.has(child)) {
          queue.push(child);
        }
      }

      const sources = getElementSources(candidate);
      for (const source of sources) {
        const extracted = extractValueFromText(source.value, patterns, source.kind);
        if (extracted) {
          return attachElementContext(extracted, candidate);
        }
      }
    }

    return null;
  };

  interface LabelSearchResult {
    readonly element: HTMLElement;
    readonly matchedText: string;
    readonly matchType: LabelMatchType;
  }

  const findLabelElement = (
    root: HTMLElement,
    patterns: readonly RegExp[],
  ): LabelSearchResult | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode as HTMLElement | null;

    while (current) {
      if (current instanceof HTMLElement) {
        const sources = getElementSources(current);
        for (const source of sources) {
          if (patterns.some((pattern) => pattern.test(source.value))) {
            return { element: current, matchedText: source.value, matchType: source.kind };
          }
        }
      }

      current = walker.nextNode() as HTMLElement | null;
    }

    return null;
  };

  const findStandaloneValue = (
    container: HTMLElement,
    labelPatterns: readonly RegExp[],
    valuePatterns: readonly RegExp[],
  ): { value: string; source: string } | null => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode as HTMLElement | null;

    while (current) {
      if (current instanceof HTMLElement) {
        const sources = getElementSources(current);
        const matchingSources = sources.filter((source) =>
          labelPatterns.some((pattern) => pattern.test(source.value)),
        );

        for (const source of matchingSources) {
          const extracted = extractValueFromText(source.value, valuePatterns, source.kind);
          if (extracted) {
            return attachElementContext(extracted, current);
          }
        }
      }

      current = walker.nextNode() as HTMLElement | null;
    }

    return null;
  };

  const collectMetrics = (container: HTMLElement): EvaluateMetricResult[] => {
    const results: EvaluateMetricResult[] = [];

    for (const metric of metrics) {
      const labelMatch = findLabelElement(container, metric.labelPatterns);
      let labelText: string | undefined;
      let labelMatchType: LabelMatchType | undefined;
      let valueInfo: { value: string; source: string } | null = null;

      if (labelMatch) {
        labelText = labelMatch.matchedText;
        labelMatchType = labelMatch.matchType;

        const directExtraction = extractValueFromText(
          labelMatch.matchedText,
          metric.valuePatterns,
          labelMatch.matchType,
        );

        valueInfo = directExtraction
          ? attachElementContext(directExtraction, labelMatch.element)
          : findNeighborValue(labelMatch.element, metric.valuePatterns);
      } else if (metric.allowStandaloneValue) {
        valueInfo = findStandaloneValue(container, metric.labelPatterns, metric.valuePatterns);
      }

      results.push({
        key: metric.key,
        value: valueInfo?.value ?? null,
        labelText,
        labelMatchType,
        valueSource: valueInfo?.source,
        containerHint: describeElement(container),
      });
    }

    return results;
  };

  const findFrameContainer = (root: HTMLElement, frame: (typeof frames)[number]): HTMLElement | null => {
    const candidates = Array.from(root.querySelectorAll('section,article,div')) as HTMLElement[];
    let best: { element: HTMLElement; score: number } | null = null;

    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent ?? '');
      if (!text) {
        continue;
      }

      if (!frame.patterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      const keywordScore = countKeywordMatches(text);
      if (keywordScore < frame.minIndicatorKeywords) {
        continue;
      }

      const score = text.length;
      if (!best || score < best.score) {
        best = { element: candidate, score };
      }
    }

    return best?.element ?? null;
  };

  const result: EvaluateResult = { frames: [] };

  const body = document.body;
  if (!body) {
    return result;
  }

  for (const frame of frames) {
    const container = findFrameContainer(body, frame);

    if (!container) {
      result.frames.push({ key: frame.key, containerFound: false, metrics: [] });
      continue;
    }

    result.frames.push({
      key: frame.key,
      containerFound: true,
      containerHint: describeElement(container),
      metrics: collectMetrics(container),
    });
  }

  return result;
}
