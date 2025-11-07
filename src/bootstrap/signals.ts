// Supported process signals as string literal types
export type Signals = 'SIGINT' | 'SIGTERM';

export type Closer = () => void | Promise<void>;

export type ProcessSignalsBinding = {
  waitForShutdown: () => Promise<void>;
};

const closersStack: Closer[] = [];
const closersSet = new Set<Closer>();

let shuttingDown = false;
let binding: ProcessSignalsBinding | null = null;
let shutdownPromise: Promise<void> | null = null;
let resolveShutdown: (() => void) | null = null;

const SIGNALS_TO_HANDLE: Signals[] = ['SIGINT', 'SIGTERM'];

function ensureShutdownPromise(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
  }
  return shutdownPromise;
}

async function runClosers(): Promise<void> {
  const recordedClosers = closersStack.slice();
  closersStack.length = 0;

  for (let index = recordedClosers.length - 1; index >= 0; index -= 1) {
    const closer = recordedClosers[index];
    if (!closersSet.has(closer)) {
      continue;
    }

    closersSet.delete(closer);

    try {
      await closer();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[signals] Error al ejecutar un closer registrado:', error);
    }
  }

  closersSet.clear();
}

async function shutdown(signal?: Signals): Promise<void> {
  if (shuttingDown) {
    return ensureShutdownPromise();
  }

  shuttingDown = true;

  try {
    await runClosers();
  } finally {
    resolveShutdown?.();
    resolveShutdown = null;
  }

  if (signal) {
    // Reenvía la señal original para permitir que Node finalice el proceso.
    setImmediate(() => {
      try {
        process.kill(process.pid, signal);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[signals] No se pudo reenviar la señal de terminación:', error);
      }
    });
  }
}

export function bindProcessSignals(): ProcessSignalsBinding {
  if (binding) {
    return binding;
  }

  ensureShutdownPromise();

  const handleSignal = (signal: Signals) => {
    /* eslint-disable no-console */
    console.log(`Se recibió la señal ${signal}. Finalizando la sesión de depuración...`);
    /* eslint-enable no-console */
    void shutdown(signal);
  };

  for (const signal of SIGNALS_TO_HANDLE) {
    process.once(signal, () => handleSignal(signal));
  }

  process.once('beforeExit', () => {
    void shutdown();
  });

  binding = {
    waitForShutdown: ensureShutdownPromise,
  };

  return binding;
}

export function registerCloser(closer: Closer): () => void {
  closersStack.push(closer);
  closersSet.add(closer);

  return () => {
    closersSet.delete(closer);
  };
}
