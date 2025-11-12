# Futures runner module (`runFuturesRunner`)

## 1) Resumen / Propósito
Coordina la ejecución del módulo de futuros: abre un navegador persistente, instala los interceptores de red, inicia el sniffer de websockets y reporta el estado al orquestador padre. Controla el ciclo de vida completo (inicio, flush, apagado, manejo de errores) del subproceso encargado de capturar datos de futuros.

## 2) Ruta & Nombre
- Ruta relativa: `src/modules/futures/runner.ts`
- Nombre del fichero: `runner.ts`

## 3) Tipo de fichero
- Tipo: `TS`
- Formato/convenciones:
  - ESM + TypeScript estricto (según la configuración global del repo).
  - Importaciones relativas a `src/`.

## 4) Esquema / API del fichero

### 4.2 Si es **TS** (Código)
- **API (exports)**:
  - `export async function runFuturesRunner(initialArgs: ModuleArgs): Promise<void>`: Punto de entrada del runner de futuros que espera mensajes del proceso padre y orquesta la captura.
- **Contrato de `runFuturesRunner`**:
  - **Descripción**: Arranca un navegador persistente, instala el `FuturesRecorder`, ejecuta el `SocketSniffer`, recibe comandos (`start`, `flush`, `graceful-exit`, `status-request`) y publica eventos de estado al padre.
  - **Parámetros**: `initialArgs` (estructura `ModuleArgs` con flags del orquestador como `module`, `action`, `headless`, `symbols`, `start`, `end`, `storageStatePath`).
  - **Retorno**: `Promise<void>` resuelta cuando el runner termina y libera recursos.
  - **Errores**: Propaga excepciones fatales no atrapadas; errores operativos se encapsulan con `toError` y disparan `sendStatus('error', ...)` + `shutdown('error', err)`.
  - **Side-effects**: Lanzamiento de navegador Playwright, escritura en disco a través de [`installFuturesRecorder`](./src-modules-futures-interceptor.md), logs `console.warn/error`, envío de mensajes IPC (`process.send`).
- **Ejemplo de uso**:
  ```ts
  import { runFuturesRunner } from '../modules/futures/runner.js';
  import { type ModuleArgs } from '../orchestrator/messages.js';

  const args: ModuleArgs = { module: 'futures-mes', action: 'capture' };
  await runFuturesRunner(args);
  ```

## 5) Variables, funciones y tipos clave

* **Funciones internas relevantes**:
  * `resolveUrl(args, payload?)`: Determina la URL objetivo combinando payload, mapeos de [`routes.ts`](./src-modules-futures-routes.md) y el fallback `DEFAULT_URL`.
  * `resolveSymbols(args, payload?)`: Resuelve la lista de símbolos usando `payload.symbols`, `args.symbols` o `FUTURES_SYMBOLS_BY_MODULE`.
  * `resolveLaunchOverrides(args)`: Construye `PersistentLaunchOverrides` (`mode: 'reuse'`, `headless`, `storageStatePath`).
  * `start(messageArgs, payload?)`: Secuencia principal para abrir navegador, instalar recorder/sniffer y emitir estados.
  * `flush()`: Pone el estado en `flushing`, espera 50 ms y vuelve a `sniffing`/`idle`.
  * `shutdown(reason, error?)`: Cierra sniffer, recorder, página y navegador; finaliza el proceso con estado `stopped`/`error`.
  * `handleMessage(message)`: Despacha comandos recibidos por IPC.
  * `toError(value)`: Normaliza valores a `Error` con mensaje legible.
* **Tipos internos**:
  * `RunnerStatus`: estados (`'idle'`, `'launching-browser'`, `'navigating'`, `'sniffing'`, `'flushing'`, `'stopping'`, `'stopped'`, `'error'`).
  * `RunnerStartPayload`: payload opcional con `url`, `symbols`, `logPrefix`, `start`, `end`.
  * `EndReason`: `'graceful-exit' | 'shutdown' | 'error' | ...` (definido en `messages.ts`).
* **Variables de entorno**: No usa directamente; el navegador persistente puede heredar configuración global (p. ej. Playwright).

## 6) Interacciones / Dependencias

* **Lee de**:
  * `process.on('message')`: comandos enviados por el orquestador.
  * `ModuleArgs` inicial y `RunnerStartPayload` (IPC).
* **Escribe en**:
  * Mensajes IPC (`sendToParent`) con estados (`ready`, `status`, `ended`).
  * `console.warn/error` para diagnósticos.
  * Ficheros `debug_results/futures-*.csv` mediante [`installFuturesRecorder`](./src-modules-futures-interceptor.md).
* **Depende de**:
  * `launchPersistentBrowser` (`src/browser.ts`): crea o reutiliza un contexto Playwright persistente.
  * `runSocketSniffer` (`src/modulos/socket-sniffer.ts`): captura tráfico WS/HTTP y lo vuelca según configuración.
  * `safeGoto` (`src/utils/navigation.ts`): navegación con reintentos/control de errores.
  * `FUTURES_URL_BY_MODULE`, `FUTURES_SYMBOLS_BY_MODULE` ([`routes.ts`](./src-modules-futures-routes.md)).
* **Motivo**: Orquestar la obtención de datos de futuros manteniendo consistencia entre recorder, sniffer y control de estado del runner.

## 7) Entradas / Salidas esperadas

* **Entradas**:
  * Argumentos iniciales `ModuleArgs` (símbolos, flags headless, rangos temporales, prefijos de log).
  * Mensajes IPC: `start`, `flush`, `graceful-exit`, `status-request`.
* **Salidas**:
  * Eventos IPC `ready`, `status`, `ended` con metadatos (URL, símbolos, `logPrefix`, timestamps, patrones de log del sniffer).
  * Archivos CSV/JSONL producidos indirectamente por recorder/sniffer.
  * Código de salida del proceso (`process.exitCode = 1` cuando `reason === 'error'`).

## 8) Errores conocidos & manejo

* Errores al lanzar navegador (`launchPersistentBrowser`) → transición a estado `error`, llamada a `shutdown('error', err)`.
* Fallos al crear página o navegar (`safeGoto`) → estado `error` con `phase` (`'context'`, `'navigation'`).
* Errores en `runSocketSniffer` → estado `error` (`phase: 'sniffer'`).
* Excepciones no controladas / rechazos de promesas → manejadores `uncaughtException` y `unhandledRejection` convierten a `Error` y cierran ordenadamente.
* Cierre de recursos (`sniffer.close`, `browser.close`, `page.close`) envueltos en `try/catch` con logs de advertencia.

## 9) Logging y trazabilidad

* Usa `console.warn` y `console.error` con prefijo `[futures-runner]` para problemas al cerrar recursos o mensajes inválidos.
* Información operacional se envía en `sendStatus` (`startedAt`, `url`, `symbols`, `logPrefix`, `logPattern`, `finishedAt`).
* IDs de correlación: se incluye `module`, `pid`, `action`, `logPrefix` en mensajes hacia el padre.

## 10) Configuración / Flags

* `ModuleArgs.headless`: fuerza modo headless del navegador.
* `ModuleArgs.storageStatePath`: reutiliza sesión Playwright.
* `ModuleArgs.start`/`end` o `payload.start`/`payload.end`: límites temporales para `runSocketSniffer`.
* `payload.logPrefix` o `ModuleArgs.outPrefix`: prefijo de archivos generados por sniffer/recorder.

## 11) Rendimiento

* Reutiliza el navegador (`mode: 'reuse'`) para reducir arranques costosos.
* `flush()` evita cierres completos: pausa breve (50 ms) para drenar colas antes de retomar `sniffing`.
* Control de `startPromise` impide ejecuciones concurrentes de `start`.

## 12) Seguridad

* `storageStatePath` permite trabajar con sesiones autenticadas; asegurar permisos de archivo.
* No persiste cookies ni credenciales fuera de Playwright.
* Cierra manejadores de señales para evitar zombies.

## 13) Ejemplos

### 13.1 Ejemplo — Ejecución básica desde el orquestador

* **Ruta**: `src/orchestrator` (módulo padre) envía `start` con `{ module: 'futures-mes', symbols: ['MESZ25'] }`.
* **Flujo**: Runner resuelve URL `https://robinhood.com/us/en/markets/futures/MESZ25/`, instala recorder/sniffer y empieza a escribir `debug_results/futures-*.csv`.
* **Consumidores**: Herramientas de depuración (`docs/data-debug_results-futures-bars.csv.md`).

### 13.2 Ejemplo — Flush programado

* **Entrada**: Mensaje `flush` durante captura continua.
* **Resultado**: Runner emite `status`=`flushing`, espera 50 ms y vuelve a `sniffing` sin reiniciar navegador.

## 14) Tests & Validación

* **Unit**: No hay pruebas dedicadas. Se recomienda añadir tests para `resolveUrl`/`resolveSymbols` con distintos módulos y payloads.
* **Integración**:
  * Ejecutar el runner con Playwright apuntando a `staging` y verificar que `sendStatus` refleja fases correctas.
  * Validar que `shutdown('graceful-exit')` cierra sniffer y recorder sin dejar procesos colgados.
* **Chequeo de esquema**: Confirmar que los CSV producidos cumplen la documentación correspondiente (`docs/data-debug_results-futures-*.md`).

## 15) Mantenimiento

* **Propietario**: Equipo de automatización de mercados.
* **Última actualización**: `2024-08-30`
* **Checklist al cambiar**:
  * Actualizar secciones 4–7 si se añaden nuevos estados o comandos IPC.
  * Documentar nuevos campos en `RunnerInfo` cuando se envíen al padre.
  * Revisar links cruzados a [`src-modules-futures-interceptor.md`](./src-modules-futures-interceptor.md) si cambian contratos.
