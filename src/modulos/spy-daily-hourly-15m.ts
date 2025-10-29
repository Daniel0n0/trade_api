import type { Page } from 'playwright';

interface ClickLogPayload {
  readonly selector: string;
  readonly path: readonly string[];
  readonly text?: string;
  readonly ariaLabel?: string;
  readonly dataTestId?: string;
  readonly role?: string;
  readonly href?: string;
  readonly value?: string;
  readonly tagName: string;
  readonly timestamp: number;
}

const CLICK_LOG_BINDING = '__spyDailyHourly15mLogClick';

const formatLogLine = (prefix: string, message: string): string => `${prefix} ${message}`;

export async function runSpyDailyHourly15mModule(page: Page): Promise<void> {
  const moduleId = 'spy-daily-hourly-15m';
  const logPrefix = `[${moduleId}]`;

  /* eslint-disable no-console */
  console.log(formatLogLine(logPrefix, 'Inicializando captura de clics para la pestaña del módulo.'));
  /* eslint-enable no-console */

  await page.waitForLoadState('domcontentloaded');

  await page.exposeBinding(
    CLICK_LOG_BINDING,
    async (_source, payload: ClickLogPayload) => {
      const lines: string[] = [
        formatLogLine(logPrefix, `Click capturado en ${payload.selector}`),
        formatLogLine(logPrefix, `  Ruta: ${payload.path.join(' > ')}`),
      ];

      if (payload.text) {
        lines.push(formatLogLine(logPrefix, `  Texto visible: "${payload.text}"`));
      }

      if (payload.ariaLabel) {
        lines.push(formatLogLine(logPrefix, `  aria-label: "${payload.ariaLabel}"`));
      }

      if (payload.dataTestId) {
        lines.push(formatLogLine(logPrefix, `  data-testid: "${payload.dataTestId}"`));
      }

      if (payload.role) {
        lines.push(formatLogLine(logPrefix, `  role: "${payload.role}"`));
      }

      if (payload.href) {
        lines.push(formatLogLine(logPrefix, `  href: ${payload.href}`));
      }

      if (payload.value) {
        lines.push(formatLogLine(logPrefix, `  value: "${payload.value}"`));
      }

      lines.push(
        formatLogLine(logPrefix, `  Timestamp: ${new Date(payload.timestamp).toISOString()}`),
      );

      for (const line of lines) {
        console.log(line);
      }
    },
    { handle: false },
  );

  await page.evaluate((bindingName: string) => {
    const escapeAttr = (value: string | null): string => {
      if (!value) {
        return '';
      }
      return value.replace(/"/g, '\\"');
    };

    const describeElement = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      let descriptor = tag;

      if (element instanceof HTMLElement) {
        if (element.id) {
          descriptor += `#${element.id}`;
        }

        const classNames = Array.from(element.classList ?? []).filter(Boolean);
        if (classNames.length) {
          descriptor += `.${classNames.join('.')}`;
        }
      }

      const dataTestId = element.getAttribute('data-testid');
      if (dataTestId) {
        descriptor += `[data-testid="${escapeAttr(dataTestId)}"]`;
      }

      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        descriptor += `[aria-label="${escapeAttr(ariaLabel)}"]`;
      }

      return descriptor;
    };

    const buildPath = (element: Element): string[] => {
      const path: string[] = [];
      let current: Element | null = element;
      while (current && path.length < 6) {
        path.push(describeElement(current));
        current = current.parentElement;
      }
      return path;
    };

    const normaliseText = (input: string | null | undefined): string => {
      if (!input) {
        return '';
      }
      return input.replace(/\s+/g, ' ').trim();
    };

    const extractValue = (element: Element): string | undefined => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
      }
      if (element instanceof HTMLSelectElement) {
        return element.value;
      }
      return undefined;
    };

    const resolveElementFromEvent = (event: MouseEvent): Element | null => {
      const composed = event.composedPath?.();
      if (Array.isArray(composed)) {
        for (const item of composed) {
          if (item instanceof Element) {
            return item;
          }
        }
      }

      const target = event.target;
      return target instanceof Element ? target : null;
    };

    document.addEventListener(
      'click',
      (event) => {
        const element = resolveElementFromEvent(event);
        if (!element) {
          return;
        }

        const binding = (window as unknown as Record<string, (payload: unknown) => Promise<void>>)[bindingName];
        if (typeof binding !== 'function') {
          return;
        }

        const text = normaliseText((element as HTMLElement).innerText ?? '');
        const ariaLabel = normaliseText(element.getAttribute('aria-label')) || undefined;
        const dataTestId = normaliseText(element.getAttribute('data-testid')) || undefined;
        const href =
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute && element.getAttribute('href');

        const payload: ClickLogPayload = {
          selector: describeElement(element),
          path: buildPath(element),
          text: text ? text.slice(0, 200) : undefined,
          ariaLabel,
          dataTestId,
          role: element.getAttribute('role') ?? undefined,
          href: href ?? undefined,
          value: extractValue(element),
          tagName: element.tagName.toLowerCase(),
          timestamp: Date.now(),
        };

        void binding(payload);
      },
      { capture: true },
    );
  }, CLICK_LOG_BINDING);

  page.once('close', () => {
    /* eslint-disable no-console */
    console.log(formatLogLine(logPrefix, 'La página se cerró. Captura de clics finalizada.'));
    /* eslint-enable no-console */
  });
}
