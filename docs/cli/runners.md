# Ejemplos CLI por runner

La utilidad `trade-api` permite lanzar cada runner del orquestador sin escribir
scripts adicionales. Todos los comandos pueden ejecutarse con `npx`:

```bash
npx trade-api <comando>
```

o reutilizando el script definido en `package.json`:

```bash
npm run trade-api -- <comando>
```

En los ejemplos se asume que ya ejecutaste `npm install` y que tienes los
binarios de Playwright configurados. Cada runner acepta la acción `now` por
defecto; se incluyen `--start` y `--end` solo cuando ayudan a delimitar la
captura.

> 💡 Usa `--symbols` para fijar el subyacente cuando el módulo lo permite y
> `--url-code` para apuntar al layout Legend correcto cuando el UUID por
> defecto no coincida con tu cuenta. Ambos parámetros también están disponibles
> en `trade-api orchestrator` mediante el archivo de configuración.

## Runner `spy-5m-1m`

Captura el *socket sniffer* para SPY en marcos de 5 y 1 minuto.

```bash
npx trade-api start spy-5m-1m now \
  --symbols SPY \
  --start 2024-05-20T13:30:00Z \
  --end 2024-05-20T20:00:00Z \
  --persist-cookies true \
  --persist-indexeddb true
```

- El comando imprime el `ctxId` asignado al runner y el prefijo de archivos
  sugerido (`spy-5m-1m-now-YYYYMMDD-HHMMSS-SPY`).
- Los *logs* del sniffer se guardan bajo `logs/spy-5m-1m-socket-sniffer.log` y
  las capturas en `data/stock/<fecha>/SPY/`.

## Runner `spy-daily-hourly-15m`

Placeholder para vistas Legend de SPY en 1D/1H/15m. Aunque actualmente no
emite archivos, sirve para validar la integración con el orquestador.

```bash
npx trade-api start spy-daily-hourly-15m now --persist-cookies false
```

- Útil para comprobar que el orquestador inicia y finaliza módulos sin lógica
  adicional.
- El comando responde inmediatamente con el `ctxId`; puedes seguir su estado
  con `npx trade-api status`.

## Runner `spy-options-chain`

Habilita el interceptor de opciones para SPY y genera CSV por expiración.

```bash
npx trade-api start spy-options-chain now \
  --options-date 2024-06-21 \
  --options-horizon 7 \
  --symbols SPY \
  --url-mode auto \
  --url-code c59d5a8e-397f-421a-a6e4-8ffe753c3456 \
  --persist-cookies true \
  --persist-indexeddb true
```

- `--options-date` fija la expiración principal cuando quieras priorizar una
  cadena concreta.
- `--options-horizon` limita las expiraciones adicionales que se capturan
  automáticamente.
- Los archivos terminan en `*-options-<expiracion>.csv` dentro de
  `data/options/<fecha>/SPY/options/` y los eventos Legend asociados en
  `*-options-*.jsonl`.
- `--url-code` permite sobrescribir el UUID del layout Legend en caso de que el
  predeterminado no coincida.

## Runner `spx-options-chain`

Versión para SPX, reutiliza los mismos flags que el módulo de SPY.

```bash
npx trade-api start spx-options-chain now \
  --options-date 2024-06-21 \
  --options-horizon 3 \
  --symbols SPX \
  --url-mode symbol \
  --url-code 0413b972-f84e-4ce7-8eae-c0a50b96cc90 \
  --persist-cookies true \
  --persist-indexeddb true
```

- Usar `--url-mode symbol` fuerza la navegación a `/options/SPX` incluso si el
  runner se configuró con un valor distinto.
- Los CSV se guardan bajo `data/options/<fecha>/SPX/options/` y los *logs* en
  `logs/spx-options-chain-socket-sniffer.log`.
- `--url-code` te permite navegar a un layout Legend alternativo sin modificar
  el archivo de configuración.

## Runner `options-generic`

Captura cadenas de opciones para cualquier subyacente aceptando parámetros en
tiempo de ejecución.

```bash
npx trade-api start options-generic now \
  --symbols TSLA \
  --options-date 2024-08-16 \
  --options-horizon 2 \
  --url-mode symbol \
  --url-code 00000000-0000-0000-0000-000000000102
```

- Define siempre `--symbols` para limitar el sniffer a los contratos deseados.
- Los CSV se generan en `data/options/<fecha>/<SIMBOLO>/options/*-options-*.csv` y los eventos
  Legend en `*-options.jsonl`.
- Ajusta `--url-code` cuando necesites otro layout personalizado (por ejemplo,
  una lista de vigilancia propia).

## Runner `stocks-generic-chart`

Ideal para capturar velas, *quotes* y *trades* de cualquier acción soportada
por Legend.

```bash
npx trade-api start stocks-generic-chart now \
  --symbols NVDA \
  --start 2024-05-20T13:30:00Z \
  --end 2024-05-20T20:00:00Z \
  --url-code 00000000-0000-0000-0000-000000000101
```

- Los archivos se almacenan en `data/stock/<fecha>/<SIMBOLO>/bars/` con CSV rotados por
  timeframe (`1min`, `5min`, etc.) y los *logs* en `logs/stocks-generic-chart-*.log`.
- Cambia `--url-code` para reutilizar tus propios layouts Legend guardados.
- Omite `--start`/`--end` si deseas capturar en tiempo real sin recorte.

## Runners diarios de acciones

Los módulos `stock-daily-stats`, `stock-daily-news` y `stock-daily-orderbook`
se publican como plantillas documentadas. Por ahora no generan artefactos, pero
puedes invocarlos para validar la navegación automática con `--url-code` y
añadir la lógica de captura correspondiente en futuras iteraciones.

## Runners de futuros

Los módulos `futures-overview` y `futures-detail` actúan como esqueletos
documentados para soportar dashboards de futuros. Emplea `--symbols` y
`--url-code` para perfilar el contrato y layout mientras se implementa la
persistencia de datos.

## Consultar el estado y detener runners

Después de iniciar cualquier runner puedes comprobar su estado o detenerlo:

```bash
npx trade-api status
npx trade-api stop <ctxId>
```

Esto ayuda a validar rápidamente que los procesos lanzados en los ejemplos se
mantienen activos o finalizan según lo esperado.
