# Futures routes module (`routes.ts`)

## 1) Resumen / Propósito
Define las rutas soportadas por el módulo de futuros, normaliza símbolos/slug, genera URLs de Robinhood y expone mapas auxiliares para resolver URLs y símbolos según el nombre del submódulo.

## 2) Ruta & Nombre
- Ruta relativa: `src/modules/futures/routes.ts`
- Nombre del fichero: `routes.ts`

## 3) Tipo de fichero
- Tipo: `TS`
- Formato/convenciones:
  - Módulo ESM con exports nombrados.
  - TypeScript estricto.

## 4) Esquema / API del fichero

### 4.2 Si es **TS** (Código)
- **API (exports)**:
  - `export type FuturesRouteDefinition`
  - `export function createFuturesRoute(input: FuturesRouteInput): FuturesRouteDefinition`
  - `export const FUTURES_ROUTES: readonly FuturesRouteDefinition[]`
  - `export const FUTURES_URL_BY_MODULE: Record<string, string>`
  - `export const FUTURES_SYMBOLS_BY_MODULE: Record<string, readonly string[]>`
  - `export const FUTURES_MODULE_NAMES: readonly string[]`
  - `export function getFuturesRoute(module: string): FuturesRouteDefinition | undefined`
- **Contrato de cada función/export**:
  - `createFuturesRoute`:
    * **Descripción**: Limpia el `symbol` (trim/uppercase), construye un `slug` alfanumérico (`[^0-9A-Za-z_-]` → `-`), genera alias opcionales y forma la URL final `https://robinhood.com/us/en/markets/futures/<slug>/`.
    * **Parámetros**: `input` con `module` obligatorio, `symbol` obligatorio, `slug?`, `aliases?`.
    * **Retorno**: `FuturesRouteDefinition` con campos normalizados.
    * **Errores**: Lanza `Error` si `symbol` o `slug` (implícito) queda vacío tras `trim`.
  - `FUTURES_ROUTES`: Lista inmutable de rutas predefinidas (`MESZ25`, `MNQZ25`, `MYMZ25`, `M2KZ25`, `MGCZ25`, `SILZ25`, `MCLZ25`).
  - `FUTURES_URL_BY_MODULE`: Mapa `{ module → url }` generado por reducción.
  - `FUTURES_SYMBOLS_BY_MODULE`: Mapa `{ module → [symbol, ...aliases] }`.
  - `FUTURES_MODULE_NAMES`: Lista de `module` extraídos de `FUTURES_ROUTES`.
  - `getFuturesRoute(module)`: Busca en `FUTURES_ROUTES` por `module`; retorna `undefined` si no existe.
- **Ejemplo de uso**:
  ```ts
  import { getFuturesRoute, FUTURES_URL_BY_MODULE } from './routes.js';

  const mes = getFuturesRoute('futures-mes');
  // mes?.url === 'https://robinhood.com/us/en/markets/futures/MESZ25/'
  const url = FUTURES_URL_BY_MODULE['futures-mes'];
  ```

## 5) Variables, funciones y tipos clave

* **Tipos internos**:
  * `FuturesRouteInput`: Tipo privado con `module`, `symbol`, `slug?`, `aliases?`.
* **Funciones internas**:
  * `normalizeSymbol(value)`: `trim` + uppercase; lanza error si queda vacío.
  * `normalizeSlug(value)`: `trim` y reemplazo de caracteres no permitidos por `-`; lanza error si queda vacío.
* **Variables de entorno**: No aplica.

## 6) Interacciones / Dependencias

* **Lee de**: Constante `FUTURES_BASE_URL` local (`https://robinhood.com/us/en/markets/futures`).
* **Escribe en**: No tiene efectos secundarios; solo exporta estructuras inmutables.
* **Depende de**: Ningún módulo externo (solo utilidades internas).
* **Motivo**: Centralizar la definición de rutas/símbolos para que `runner.ts` y otros componentes usen un único origen de verdad.

## 7) Entradas / Salidas esperadas

* **Entradas**: Datos estáticos definidos en el array `FUTURES_ROUTE_DEFINITIONS` o `FuturesRouteInput` cuando se invoca `createFuturesRoute`.
* **Salidas**: Objetos `FuturesRouteDefinition`, mapas `Record<string, ...>` y listas de módulos.

## 8) Errores conocidos & manejo

* `normalizeSymbol('   ')` → `Error('Symbol cannot be empty')`.
* `normalizeSlug('   ')` → `Error('Slug cannot be empty')`.
* `createFuturesRoute` no controla duplicados; si se añaden entradas con mismo `module` puede sobreescribir en `FUTURES_URL_BY_MODULE`.

## 9) Logging y trazabilidad

* No produce logs.

## 10) Configuración / Flags

* Ninguna.

## 11) Rendimiento

* Uso constante: mapas reducidos una sola vez al cargar el módulo.
* Operaciones de normalización O(n) sobre longitud de cadenas; impacto despreciable.

## 12) Seguridad

* No manipula datos sensibles.

## 13) Ejemplos

### 13.1 Ejemplo — Añadir nuevo módulo personalizado

* **Código**:
  ```ts
  const custom = createFuturesRoute({
    module: 'futures-custom',
    symbol: 'ABCZ25',
    aliases: ['ABCZ5'],
  });
  ```
* **Resultado**: `custom.symbols === ['ABCZ25', 'ABCZ5']`, `custom.url` apunta a `/ABCZ25/`.
* **Consumidores**: `FUTURES_URL_BY_MODULE['futures-custom'] = custom.url` tras agregar a la lista fuente.

### 13.2 Ejemplo — Resolver símbolos desde `runner`

* `runner.ts` usa `FUTURES_SYMBOLS_BY_MODULE['futures-mgc']` para completar `symbols` cuando no se proporcionan en el payload.

## 14) Tests & Validación

* **Unit**:
  * Verificar que `createFuturesRoute` normaliza `symbol`/`slug` y conserva aliases.
  * Asegurar que entradas vacías lanzan errores.
* **Integración**:
  * Al agregar nuevos módulos, ejecutar el runner y confirmar que navega a la URL esperada.
* **Chequeo de esquema**: No aplica (estructura estática).

## 15) Mantenimiento

* **Propietario**: Equipo de automatización de mercados.
* **Última actualización**: `2024-08-30`
* **Checklist al cambiar**:
  * Añadir documentación al agregar módulos/símbolos nuevos.
  * Mantener sincronía con `docs/src-modules-futures-runner.md` (resolución de URL/símbolos).
  * Si cambia el dominio base, actualizar `FUTURES_BASE_URL` y avisar a consumidores.
