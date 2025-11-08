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
  las capturas en `data/SPY/<fecha>/`.

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
  --persist-cookies true \
  --persist-indexeddb true
```

- `--options-date` fija la expiración principal cuando quieras priorizar una
  cadena concreta.
- `--options-horizon` limita las expiraciones adicionales que se capturan
  automáticamente.
- Los archivos terminan en `*-options-<expiracion>.csv` dentro de
  `data/SPY/<fecha>/` y los eventos Legend asociados en `*-options-*.jsonl`.

## Runner `spx-options-chain`

Versión para SPX, reutiliza los mismos flags que el módulo de SPY.

```bash
npx trade-api start spx-options-chain now \
  --options-date 2024-06-21 \
  --options-horizon 3 \
  --symbols SPX \
  --url-mode symbol \
  --persist-cookies true \
  --persist-indexeddb true
```

- Usar `--url-mode symbol` fuerza la navegación a `/options/SPX` incluso si el
  runner se configuró con un valor distinto.
- Los CSV se guardan bajo `data/SPX/<fecha>/` y los *logs* en
  `logs/spx-options-chain-socket-sniffer.log`.

## Consultar el estado y detener runners

Después de iniciar cualquier runner puedes comprobar su estado o detenerlo:

```bash
npx trade-api status
npx trade-api stop <ctxId>
```

Esto ayuda a validar rápidamente que los procesos lanzados en los ejemplos se
mantienen activos o finalizan según lo esperado.
