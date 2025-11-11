# Options runner module (`runOptionsRunner`)

## 1) Resumen / Propósito
Gestiona el subproceso encargado de capturar cadenas de opciones: lanza/reutiliza un navegador Playwright, instala el recorder de respuestas HTTP, ejecuta el sniffer de sockets y mantiene sincronía con el orquestador enviando estados, manejando flush y apagados.

## 2) Ruta & Nombre
- Ruta relativa: `src/modules/options/runner.ts`
- Nombre del fichero: `runner.ts`

## 3) Tipo de fichero
- Tipo: `TS`
- Formato/convenciones:
  - ESM + TypeScript con tipado estricto y módulos relativos.

## 4) Esquema / API del fichero

### 4.2 Si es **TS** (Código)
- **API (exports)**:
  - `export const DEFAULT_OPTIONS_URL: string`
  - `export const DEFAULT_OPTIONS_SYMBOLS: readonly string[]`
  - `export const OPTIONS_URL_BY_MODULE: Record<string, string>`
  - `export const OPTIONS_SYMBOLS_BY_MODULE: Record<string, readonly string[]>`
  - `export const resolveOptionsSymbols(args, payload?)`
  - `export const resolveOptionsUrl(args, payload, symbols)`
  - `export async function runOptionsRunner(initialArgs: ModuleArgs): Promise<void>`
- **Contrato de funciones principales**:
  - `resolveOptionsSymbols`:
    * **Descripción**: Devuelve la lista final de símbolos a observar priorizando `payload.symbols`, luego `args.symbols`, después el mapeo preconfigurado y, por último, el fallback vacío.
    * **Parámetros**: `args: ModuleArgs`, `payload?: RunnerStartPayload`.
    * **Retorno**: `readonly string[]`.
    * **Errores**: Ninguno (maneja listas vacías).
  - `resolveOptionsUrl`:
    * **Descripción**: Selecciona la URL de navegación según `payload.url`, el `urlMode` (`auto` | `module` | `symbol`), el primer símbolo disponible o el mapeo estático.
    * **Parámetros**: `args`, `payload`, `symbols` (lista resuelta anteriormente).
    * **Retorno**: `string` con la URL de Robinhood.
    * **Errores**: Ninguno; retorna `DEFAULT_OPTIONS_URL` si no hay datos suficientes.
  - `runOptionsRunner`:
    * **Descripción**: Secuencia principal de captura (browser → recorder → navegación → sniffer) y ciclo de vida del subproceso IPC.
    * **Parámetros**: `initialArgs: ModuleArgs`.
    * **Retorno**: `Promise<void>` al finalizar.
    * **Errores**: Normaliza fallos a `Error` mediante `toError` y los reporta al proceso padre antes de cerrar.
    * **Side-effects**: Inicializa Playwright, escribe en disco mediante [`installOptionsResponseRecorder`](./src-modules-options-interceptor.md), envía mensajes `process.send` y registra advertencias/errores en consola.
- **Ejemplo de uso**:
  ```ts
  import { runOptionsRunner } from '../modules/options/runner.js';

  await runOptionsRunner({ module: 'spy-options-chain', action: 'capture' });
  ```

## 5) Variables, funciones y tipos clave

* **Funciones internas destacadas**:
  * `resolveLaunchOverrides(args)`: Construye `PersistentLaunchOverrides` con `mode: 'reuse'`, `headless` y `storageStatePath`.
  * `start(messageArgs, payload?)`: Orquesta instalación de recorder/sniffer, navegación segura (`safeGoto`) y transiciones de estado (`launching-browser`, `navigating`, `sniffing`).
  * `flush()`: Hace pausa corta (50 ms) y devuelve el estado a `sniffing`/`idle`.
  * `shutdown(reason, error?)`: Cierra recorder, sniffer, página y navegador enviando `ended` + estado final (`stopped`/`error`).
  * `handleMessage(message)`: Gestiona comandos IPC (`start`, `flush`, `graceful-exit`, `status-request`).
  * `toError(value)`: Garantiza objetos `Error` con mensaje legible.
* **Tipos de apoyo**:
  * `RunnerStatus`, `RunnerStartPayload`, `RunnerInfo`, `EndReason` provenientes de `src/modules/messages.ts`.
* **Variables de entorno**: No accede directamente; depende de configuración Playwright global.

## 6) Interacciones / Dependencias

* **Lee de**:
  * Mensajes IPC (`process.on('message')`).
  * `ModuleArgs`/`RunnerStartPayload`.
* **Escribe en**:
  * Eventos `status`, `ready`, `ended` hacia el orquestador.
  * Archivos CSV/JSONL generados por [`installOptionsResponseRecorder`](./src-modules-options-interceptor.md) y `runSocketSniffer` (`src/modulos/socket-sniffer.ts`).
  * Logs `console.warn/error` con prefijo `[options-runner]`.
* **Depende de**:
  * `launchPersistentBrowser` (`src/browser.ts`).
  * `safeGoto` (`src/utils/navigation.ts`).
  * `runSocketSniffer` (`src/modulos/socket-sniffer.ts`).
  * `installOptionsResponseRecorder` (`src/modules/options/interceptor.ts`).
* **Motivo**: Mantener la captura continua de cadenas de opciones, delegando almacenamiento en interceptores/sniffer.

## 7) Entradas / Salidas esperadas

* **Entradas**:
  * `ModuleArgs` iniciales (símbolos, `urlMode`, `outPrefix`, `headless`, `storageStatePath`, ventanas temporales `start`/`end`).
  * Mensajes IPC de control (`start`, `flush`, `graceful-exit`, `status-request`).
* **Salidas**:
  * Mensajes al orquestador con `status` (incluye `startedAt`, `url`, `symbols`, `logPrefix`, `logPattern`), `ready` y `ended`.
  * Ficheros en `debug_results/options-*.csv` y registros `.jsonl` generados por recorder/sniffer.
  * Código de salida del proceso (1 si `reason === 'error'`).

## 8) Errores conocidos & manejo

* Fallos al lanzar navegador o crear página → estado `error` con `phase: 'launch' | 'context'` y llamada a `shutdown('error', err)`.
* Errores de navegación (`safeGoto`) → estado `error` (`phase: 'navigation'`).
* Problemas al iniciar sniffer → estado `error` (`phase: 'sniffer'`).
* Excepciones/rechazos globales → manejadores `uncaughtException` / `unhandledRejection` cierran con `shutdown('error', err)`.
* Errores al cerrar recorder/sniffer/página → se capturan y se registran con prefijo `[options-runner]` sin detener el cierre.

## 9) Logging y trazabilidad

* Prefijo fijo `[options-runner]` en advertencias/errores.
* `sendStatus` agrega metadatos (`startedAt`, `url`, `symbols`, `logPrefix`, `logPattern`, `finishedAt`) que el orquestador puede persistir.
* Incluye `module`, `action`, `pid` en `RunnerInfo` para correlación.

## 10) Configuración / Flags

* `ModuleArgs.urlMode`: `auto` (default), `module`, `symbol`.
* `ModuleArgs.headless`, `storageStatePath`: controlan Playwright.
* `ModuleArgs.outPrefix` o `payload.logPrefix`: prefijos de salida para recorder/sniffer.
* `ModuleArgs.start`/`end` y equivalentes en payload.
* `payload.url`, `payload.symbols`: overrides explícitos.

## 11) Rendimiento

* Reutiliza contexto Playwright (`mode: 'reuse'`) para minimizar arranques.
* Evita `start` concurrentes mediante `startPromise`.
* `flush()` limita trabajo a una pausa mínima (50 ms) sin reiniciar recursos.

## 12) Seguridad

* Respeta `storageStatePath` (cuidado con credenciales). Asegurar permisos en archivos de estado.
* No expone datos sensibles en logs; los mensajes IPC no incluyen tokens.
* Limpia manejadores de señales (`SIGINT`, `SIGTERM`, `disconnect`) para evitar procesos colgados.

## 13) Ejemplos

### 13.1 Ejemplo — Captura de SPY

* **Entrada**: `ModuleArgs` `{ module: 'spy-options-chain', urlMode: 'module' }`.
* **Flujo**: `resolveOptionsSymbols` → `['SPY']`; `resolveOptionsUrl` → `https://robinhood.com/options/chains/SPY`; recorder + sniffer generan `debug_results/options-snapshots.csv`.
* **Consumidores**: Herramientas descritas en `docs/src-modules-options-interceptor.md` y datasets `docs/data-debug_results-futures-*.md`.

### 13.2 Ejemplo — URL personalizada

* **Entrada**: `payload.url = 'https://robinhood.com/options/chains/QQQ'`, `symbols: ['QQQ']`.
* **Resultado**: Ignora `urlMode`, navega al URL proporcionado y captura datos de `QQQ`.

## 14) Tests & Validación

* **Unit**:
  * Añadir pruebas para `resolveOptionsSymbols` y `resolveOptionsUrl` con combinaciones (`payload`, `args`, `urlMode`).
* **Integración**:
  * Lanzar el runner con Playwright y verificar que `status` refleja fases esperadas.
  * Confirmar que `shutdown('graceful-exit')` libera navegador/sniffer sin procesos huérfanos.
* **Chequeo de esquema**: Validar que los CSV generados coinciden con la documentación del recorder.

## 15) Mantenimiento

* **Propietario**: Equipo de automatización de mercados.
* **Última actualización**: `2024-08-30`
* **Checklist al cambiar**:
  * Actualizar secciones 4–7 si se agregan nuevos mapeos (`OPTIONS_*_BY_MODULE`) o campos de estado.
  * Documentar cualquier nuevo comando IPC o cambio en `urlMode`.
  * Mantener sincronizados los enlaces con [`src-modules-options-interceptor.md`](./src-modules-options-interceptor.md).
