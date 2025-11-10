
# Trade API Robinhood Automation Toolkit

This repository provides a TypeScript + Playwright scaffold for launching a visible Chromium/Chrome
session that opens Robinhood, lets you authenticate manually, and removes any cached data as soon as
the automation finishes.

## Prerequisites

- Node.js 20 LTS or newer
- pnpm, npm, or yarn (examples below use `npm`)
- A Robinhood account with manual access to credentials and MFA devices

> ⚠️ **Disclaimer:** Automating Robinhood may violate their Terms of Service. Use at your own risk,
> keep automation limited to supervised, non-trading actions, and never store credentials in this
> repository.

## Installation

```bash
npm install
# Optionally install browser binaries once
npx playwright install chromium
```

Copy the sample environment file when bootstrapping a new checkout:

```bash
cp .env.example .env
```

## Usage

Antes de abrir el navegador automatizado revisa el [checklist del Paso 0](docs/checklists/paso-0.md)
para asegurarte de que tienes dependencias, credenciales y directorios listos.

### CLI interactivo principal

El punto de entrada `start:robinhood` inicia una sesión visible en Chromium/Chrome, carga las
credenciales guardadas (si existen) y pausa la ejecución para que inspecciones la interfaz.

```bash
npm run start:robinhood
```

Para iterar rápidamente durante el desarrollo existe un modo en caliente que recompila al detectar
cambios en los archivos fuente:

```bash
npm run dev
```

### Orquestador modular

El orquestador (`npm run orchestrator`) centraliza la ejecución de subprocesos especializados y aplica
los *feature flags* definidos en `.env`/`.env.local` (`HEADLESS`, `DEVTOOLS`, `DEBUG_NETWORK`,
`DEBUG_CONSOLE`, `PERSIST_COOKIES`, etc.). Usa `npm run orchestrator -- list` para inspeccionar los
módulos disponibles y obtén ayuda contextual con `--help`.

```bash
npm run orchestrator -- --module spy-5m-1m --action now
npm run orchestrator -- --module spy-5m-1m --action stream --startAt=2024-10-29T13:30:00Z --endAt=2024-10-29T20:00:00Z
```

Los accesos directos declarados en `package.json` (`npm run sub:spy-5m-1m:now`,
`npm run sub:spy-5m-1m:stream`, `npm run sub:spy-5m-1m:bars`, etc.) delegan en el mismo comando para
alternar acciones sin repetir argumentos.

#### Captura de expiraciones en opciones

Para instrucciones paso a paso sobre cómo cambiar expiraciones, monitorear las peticiones interceptadas
y validar los archivos generados para SPY/SPX (incluyendo Legend), consulta
[`docs/options/expirations.md`](docs/options/expirations.md).

### Environment flags

Runtime behaviour can be adjusted with environment variables stored in `.env` and overridden in
`.env.local`. These files are loaded on startup and validated with `zod`. Only `.env.example` is
committed to version control so you can safely keep local values private.

| Variable          | Type    | Default | Description |
| ----------------- | ------- | ------- | ----------- |
| `HEADLESS`        | boolean | `false` | Enables headless Chromium runs when set to `true`/`1`. |
| `DEVTOOLS`        | boolean | `true` if `HEADLESS` is `false`, otherwise `false` | Forces the DevTools panel open for non-headless sessions. |
| `DEBUG_NETWORK`   | boolean | `false` | Logs failed network requests (excluding known benign domains). |
| `DEBUG_CONSOLE`   | boolean | `false` | Mirrors page `console` output to the terminal. |
| `PERSIST_COOKIES` | boolean | `true`  | Persiste cookies/localStorage en `state/storage/<modulo>.json` al finalizar un subproceso. |
| `PERSIST_INDEXEDDB` | boolean | `false` | Conserva el directorio de perfil (cookies + IndexedDB) entre ejecuciones. |
| `STORAGE_STATE_PATH` | string | `state/storage/robinhood.json` | Ruta base del `storageState` reutilizable durante el bootstrap de sesión. |
| `INDEXEDDB_SEED`  | string  | — | Copia `state/indexeddb-seeds/<valor>` al perfil antes de lanzar Playwright. |
| `INDEXEDDB_PROFILE` | string | — | Directorio de perfil persistente a utilizar (omite la carpeta por defecto). |
| `TZ`              | string  | `UTC`   | Overrides the process timezone (affects timestamps and log rotation). |

> ℹ️ The process timezone is pinned to `UTC` to keep timestamps deterministic across environments.

Adjust these values by editing `.env` (checked in) or `.env.local` (ignored by Git). The second file
takes precedence so you can keep machine-specific tweaks private. For example, to run Playwright in
headless mode while keeping DevTools closed and aligning timestamps with New York time, set:

```bash
HEADLESS=true
DEVTOOLS=false
TZ=America/New_York
DEBUG_NETWORK=1
```

Restart the CLI after editing `.env` files so the new flags take effect.

### Checklist rápido antes de lanzar módulos

1. Completa el [Paso 0](docs/checklists/paso-0.md) y verifica que `npm run lint` o `npm run test`
   funcionen si aplican a tu cambio.
2. Refresca las variables de entorno copiando cambios compartidos en `.env` y ajustes locales en
   `.env.local`.
3. Inicializa la sesión interactiva (`npm run start:robinhood`) para asegurar que las cookies de
   Robinhood sean válidas antes de delegar al orquestador.
4. Lanza el orquestador con el módulo requerido (`npm run orchestrator -- sub:<modulo>:now`) y
   monitorea la carpeta `logs/` para confirmar que el *heartbeat* sigue activo.
5. Al terminar, detén el proceso con `Ctrl+C` y valida que se ejecutó el cierre limpio (sin archivos
   `.lock` ni procesos huérfanos).

Ejemplo de `.env.local` con banderas de depuración y zona horaria personalizada:

```bash
HEADLESS=false
DEVTOOLS=true
DEBUG_NETWORK=1
DEBUG_CONSOLE=1
TZ=America/New_York
```

### Session bootstrap and reuse

- On the first run the script launches a bootstrap browser profile that expects you to authenticate
  manually. Once the home dashboard loads the Playwright context is serialized to `state.json` in the
  repository root so subsequent executions can reuse the stored cookies.
- When `state.json` is present, the CLI automatically spins up a fresh browser context that loads the
  saved state before navigating to `/dashboard`. The run stops immediately if the page redirects to an
  unexpected location so you can refresh the session.

Refresh the storage state manually at any time with:

```bash
rm -f state.json && npm run start:robinhood
```

If Robinhood expires the session (for example after password changes or prolonged inactivity), delete
`state.json` and run the command above again to rebuild it. The CLI will fall back to the manual
bootstrap flow whenever the file is missing.

1. A Chrome/Chromium window opens using a dedicated profile stored at
   `~/.robinhood-playwright-profile` (configurable in `src/config.ts`). The directory is deleted
   automatically when the automation closes the browser so no session or cache data remain on disk.
2. If you are already authenticated, the script goes directly to the dashboard.
3. Otherwise, follow the on-screen prompts to enter credentials and complete MFA manually. The
   script checks every 10 seconds for a redirect away from the login page and confirms that the home
   dashboard at
   `https://robinhood.com/legend/layout?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT`
   has loaded before proceeding.
4. After the dashboard is visible, the automation pauses for two seconds, opens dedicated tabs for
   the vetted modules and then visits the portfolio and watchlist pages. The browser remains visible
   until you close it manually.

The default session launches the following modules automatically:

- `spy-5m-1m`
- `spy-options-chain`
- `spx-options-chain`
- `options`
- `stock-daily-stats`
- `stock-daily-news`
- `stock-daily-orderbook`
- `futures`
- `futures-mes`
- `futures-mnq`
- `futures-overview`
- `futures-detail`

Modules that rely on custom Legend layouts (for example `stocks-generic-chart`, `options-generic` and
the daily stock dashboards) now require an explicit `--url-code` flag or matching
`TRADE_API_URL_CODE_*` environment variable. They stay out of the default session until a real layout
UUID is supplied.

> ℹ️ **Network blocking timing:** Tracking domains are blocked only after the script confirms that
> the post-login UI is ready (either the home dashboard or the `/stocks/SPY` fallback view). This
> avoids interrupting any critical requests that must run during the initial login sequence.

### Resetting the Profile

Normally no manual cleanup is required because the profile directory is removed at the end of each
run. If the process crashes or you enabled profile preservation in `src/config.ts`, remove the
directory manually with:

```bash
npm run clean:profile
```

## Convenciones de almacenamiento y cierre controlado

- **`data/`** – Los módulos que capturan datos usan utilidades como
  [`dataPath`](src/io/paths.ts) para guardar archivos en `data/<CLASE>/<YYYY-MM-DD>/<SÍMBOLO>/`. El
  orquestador imprime la ruta final cuando un *runner* devuelve un string para que puedas localizar
  rápidamente los artefactos (JSONL, CSV, gzip). Crea la carpeta si vas a versionar datos de prueba.
- **`state/futures/known-contracts.json`** – La caché de contratos de futuros se actualiza
  automáticamente cuando los módulos `futures-overview` y `futures-detail` detectan nuevos códigos de
  contrato (por ejemplo `MESZ25`, `MNQZ25`). Consulta y reinicia el archivo siguiendo
  [la guía dedicada](docs/futures/contracts.md).
- **`logs/`** – Cada proceso activa [`createProcessLogger`](src/bootstrap/logger.ts), que genera un
  archivo por ejecución con timestamps ISO y se rota automáticamente en base al nombre del comando.
  Conserva esta carpeta fuera del control de versiones para evitar filtrar información sensible.
- **Heartbeats** – Tanto [`src/main.ts`](src/main.ts) como [`src/orchestrator.ts`](src/orchestrator.ts)
  registran un *heartbeat* cada 30 segundos en sus respectivos logs para indicar que el proceso sigue
  vivo. Si dejan de aparecer entradas nuevas, detén el proceso manualmente y revisa la consola.
- **Cierre limpio** – La infraestructura de señales definida en
  [`src/bootstrap/signals.ts`](src/bootstrap/signals.ts) y el registro de *closers* garantizan que al
  presionar `Ctrl+C` se cierren el navegador, los *streams* de archivos y el intervalo de heartbeat
  en orden inverso. Si un cierre queda incompleto, vuelve a ejecutar el comando y luego deténlo
  normalmente para limpiar recursos.

### Semillas de IndexedDB y credenciales externas

- Almacena semillas sanitizadas en `state/indexeddb-seeds/<nombre>/` (ignoradas por Git). Cada
  subcarpeta debe contener el contenido completo del perfil Chromium que quieras hidratar. Activa la
  semilla con `INDEXEDDB_SEED=<nombre>` o `npm run orchestrator -- --indexedDbSeed <nombre>`.
- Para generar una semilla fresca:
  1. Ejecuta `npm run orchestrator -- --module spy-5m-1m --action now --persistIndexedDb=1 --indexedDbProfile $(mktemp -d)`
     o exporta `INDEXEDDB_PROFILE` a una carpeta temporal.
  2. Navega el flujo deseado y verifica que la base de datos tenga los datos requeridos.
  3. Copia el contenido resultante del perfil temporal a `state/indexeddb-seeds/<nombre>/`.
  4. Elimina el perfil temporal para evitar filtrar cookies sensibles.
- Conserva credenciales externas (tokens, claves API, secretos de servicios de datos) en `creds/` o en
  variables de entorno declaradas dentro de `.env.local`. Ambas rutas están excluidas del control de
  versiones; sincroniza los artefactos sensibles de forma manual y segura.

## Project Structure

```
├─ src/
│  ├─ browser.ts          # Launches persistent browser context with tracing support
│  ├─ config.ts           # Centralized configuration values and selectors
│  ├─ login.ts            # Manual-login orchestration and session detection helpers
│  ├─ main.ts             # CLI entry point that keeps the window open
│  └─ nav.ts              # Helpers to visit portfolio and watchlist pages
├─ scripts/
│  └─ clean-profile.ts    # Removes the persistent profile directory
├─ playwright.config.ts   # Basic Playwright configuration (headless disabled)
├─ package.json           # Scripts and dependencies
└─ tsconfig.json          # TypeScript compiler options
```

## Development Tooling

- `npm run lint` – Lints the TypeScript source with ESLint and Prettier rules.
- `npm run format` – Applies Prettier formatting across the project.

Artifacts such as Playwright traces are stored under `artifacts/trace-<timestamp>.zip` whenever a
run completes. Review these files to debug issues or share reproducible traces.

# Trade API Automation Plan

## Overview
This repository currently serves as a placeholder for developing a Playwright-based TypeScript automation that opens Robinhood in a visible browser window, supports manual login, and keeps the session active between runs.

## Development Plan
1. **Scope and Objective**
   - Launch a non-headless Chromium/Chrome instance using Playwright.
   - Support manual authentication, including 2FA.
   - Navigate to core pages such as the portfolio and watchlists while preserving session state.
2. **Security and Compliance**
   - Store credentials securely outside of the codebase (e.g., OS keychain, password manager).
   - Perform login manually and persist the authenticated profile in a dedicated user-data directory.
   - Handle captchas and sensitive prompts manually; avoid logging sensitive tokens or cookies.
   - Prefer public market data feeds or official brokerage APIs (por ejemplo Alpaca o IBKR) para obtener señales, y limita la automatización en Robinhood a observación manual sin ejecución de órdenes.
3. **Technical Architecture**
   - Stack: Node.js LTS, TypeScript, Playwright.
   - Provide a CLI entry point (e.g., `pnpm start:robinhood`) that creates or reuses a persistent browser context with `headless: false` and `viewport: null` to keep the window visible.
   - Include observability tooling such as screenshots, tracing, and optional video capture on failures.
4. **Login Flow and Persistence**
   - First run: open Robinhood, allow manual credential entry, complete 2FA, and persist the session data.
   - Subsequent runs: reuse the stored session; detect expired sessions and prompt for manual re-authentication when required.
5. **Project Structure**
   - Suggested layout:
     ```
     robinhood-play-browser/
     ├─ src/
     │  ├─ config.ts
     │  ├─ browser.ts
     │  ├─ login.ts
     │  ├─ nav.ts
     │  └─ main.ts
     ├─ scripts/
     │  └─ clean-profile.ts
     ├─ playwright.config.ts
     ├─ package.json
     ├─ tsconfig.json
     └─ README.md
     ```
6. **Browser Configuration Tips**
   - Use `launchPersistentContext` with flags such as `--disable-blink-features=AutomationControlled`.
   - Set default timeouts around 30 seconds and wait for `networkidle` after login actions.
   - Capture tracing data and screenshots on critical errors for easier debugging.
7. **Keeping the Window Visible**
   - Run with `headless: false` to ensure the UI stays on screen.
   - Prevent automatic closure by waiting for the page or process to close explicitly (e.g., `await page.waitForEvent('close')`).
   - Consider OS-level tools if “always-on-top” behavior is required.
8. **Navigation and Validation**
   - Verify dashboard and watchlist pages using stable selectors or ARIA roles.
   - Pause and prompt for manual resolution if security challenges appear.
9. **Error Handling and Resilience**
   - Add limited retries with backoff for network-sensitive steps.
   - Detect session expiration by monitoring for login prompts and restarting the assisted login flow.
10. **QA and Acceptance Criteria**
    - Successful non-headless launch.
    - Manual login flow that persists between runs.
    - Reliable navigation to portfolio and watchlist pages.
    - Resilient handling of session expiration and clean logging.
11. **Supporting Scripts**
    - `start:robinhood` to run the main automation.
    - `clean:profile` to reset the persistent profile directory.
    - `trace:viewer` to inspect generated Playwright traces.
12. **Risks and Mitigations**
    - Respect Robinhood’s Terms of Service and limit automation to supervised use.
    - Abstract selectors to accommodate UI changes.
    - Prepare for enforced MFA or captcha challenges by allowing manual intervention.
13. **Deliverables**
    - Repository scaffold as outlined above.
    - Comprehensive README with setup instructions and login guidance.
    - Dedicated persistent profile directory (e.g., `~/.robinhood-profile`).
    - Optional `.env.example` template without embedded credentials.

## Data Ingestion vs. Order Execution

- Mantén desacoplados los componentes que generan señales (ingestión de datos) y los que actúan sobre ellas (ejecución de órdenes). La automatización de Robinhood debe limitarse a mostrar paneles bajo supervisión manual.
- Ejecuta la ingestión de datos desde fuentes oficiales con APIs soportadas (por ejemplo, Alpaca o Interactive Brokers) en procesos separados o servicios que no tengan acceso a las credenciales de Robinhood.
- Si necesitas enviar órdenes automáticas, hazlo únicamente con corredores que ofrezcan APIs oficiales y cumplan con requisitos regulatorios; evita usar Robinhood para scraping intensivo o ejecuciones no autorizadas.

## Desactivar módulos de scraping

Para usar únicamente la vista manual del navegador:

1. Abre `src/config.ts` y deja el arreglo `MODULES` vacío (`export const MODULES: readonly ModuleDefinition[] = [];`) o comenta las entradas que no quieras abrir.
2. Guarda los cambios y vuelve a ejecutar `npm run start:robinhood`; la CLI omitirá la apertura de pestañas adicionales y solo cargará el tablero principal para observación manual.



Layout SPY con marcos 1D/1H/15m/5m/1m/1s:
https://robinhood.com/legend/layout/6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT

3(spy options chain):
https://robinhood.com/legend/layout/c59d5a8e-397f-421a-a6e4-8ffe753c3456?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT

4(spx options chain):
https://robinhood.com/legend/layout/0413b972-f84e-4ce7-8eae-c0a50b96cc90?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT
