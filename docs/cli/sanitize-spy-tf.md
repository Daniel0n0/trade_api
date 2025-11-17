# Comando `sanitize-spy-tf`

Sanea y actualiza velas de SPY en las temporalidades `5m`, `15m` y `1h`,
reaprovechando el módulo CLI principal.

## Configuración de endpoints

Los endpoints se definen en `src/modules/spy/sanitize-timeframes.ts` con
placeholders a rellenar cuando se tengan las URLs reales:

```ts
export const SPY_TF_ENDPOINTS: Record<Timeframe, string> = {
  '5m': '<<TODO_URL_5M_SPY>>',
  '15m': '<<TODO_URL_15M_SPY>>',
  '1h': '<<TODO_URL_1H_SPY>>',
};
```

Cada URL debe devolver velas compatibles con el esquema `RawSpyCandle`
(`begins_at`, `open_price`, `high_price`, `low_price`, `close_price`,
`volume`, `vwap?`).

## Uso CLI

```bash
npx trade-api sanitize-spy-tf \
  --since 2025-10-01 \
  --tfs 5m,15m,1h
```

- `--since` (opcional): fecha `YYYY-MM-DD`. Descarta velas anteriores.
- `--tfs` (opcional): lista separada por coma; si se omite procesa las tres
  temporalidades.

El comando valida O/H/L/C, volumen y alineación de timestamp con el marco de
tiempo recibido, normaliza los valores numéricos y upserta cada vela en
`data/stock/SPY/<YYYY-MM-DD>/<tf>.csv` con encabezado
`timestamp,open,high,low,close,volume,vwap,source_transport,source_url`.
