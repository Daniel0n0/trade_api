bien. para los futures, el directorio tiene que ser:
data/
data/futures/
data/futures/<NOMBRE_DEL_FUTURE>/
data/futures/<NOMBRE_DEL_FUTURE>/<fechas_salvadas>
data/futures/<NOMBRE_DEL_FUTURE>/<fechas_salvadas>


directorio para stock:
data/
data/stocks/
data/stocks/<NOMBRE_DEL_STOCK>/
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/ (datos de las temporalidades, noticias y las greek)
.............
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/options/  (datos de los strike)
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/options/in_the_future/<fecha>/  (datos de los proximos dias de expiracion, 2 semanas adelante)



PUNTO 32:

Listo. Te dejé en la **canvas** un script TypeScript de “ETL” para el módulo de *Greeks/estadísticas* que consulta y normaliza los **ETP details de SPY** desde `bonfire.robinhood.com`.

### Qué hace

* Llama al endpoint `…/instruments/{instrument_id}/etp-details/`.
* Genera 4 CSV (`profile`, `performance`, `sectors`, `holdings`) y un `etp_summary.json` con:

  * **Top-10 concentration**, **peso tech**, **HHI sectorial** y *flags* de concentración/diversificación.

### Cómo correrlo

1. En tu terminal:

```bash
export ROBINHOOD_TOKEN="<TU_JWT_sin_la_palabra_Bearer>"
# opcional si quieres otro instrumento:
# export INSTRUMENT_ID="8f92e76f-1e0e-4478-8580-16a6ffcfaef5"  # SPY por defecto

npm init -y
npm i --save-dev ts-node typescript @types/node
npx ts-node etp_spy_etl.ts
```

2. Salida en `./out/`:

* `etp_profile.csv`
* `etp_performance.csv`
* `etp_sectors.csv`
* `etp_holdings.csv`
* `etp_summary.json` (para alertas/UX)

### Señales útiles (para tus alertas)

* `top10>=35%` → concentración alta en principales posiciones.
* `tech-heavy>=30%` → sesgo tecnológico notable.
* `sector-concentration-{moderate|high}` vía **HHI** (suma de pesos²).

---

PUNTO 33:

Listo. Te dejé en el canvas un script **multi-símbolo** en TypeScript que:

* Acepta `--symbols=SPY,QQQ,DIA` o `--instruments=<instrument_id,...>`.
* Resuelve `instrument_id` automáticamente y baja el `etp-details` por cada ETF.
* Calcula métricas clave (Top-10, peso Tech, HHI sectorial, gasto, momentum-proxy, flags).
* Exporta por ETF: `etp_profile.csv`, `etp_performance.csv`, `etp_sectors.csv`, `etp_holdings.csv`, `etp_summary.json`.
* Genera la **ORDEN DEL MOMENTO** (`orden_del_momento.csv/.md/.json`) con ranking por *score* (momentum –55%–, diversificación –25%–, costo –20%–, y penalización de riesgo).
* Incluye ejemplo de **cron** (08:10 ET, días hábiles) y `--overwrite`.

### Cómo correrlo (rápido)

1. Guarda tu token en el entorno (sin el prefijo `Bearer`):

```bash
export ROBINHOOD_TOKEN="tu_jwt"
```

2. Ejecuta:

```bash
npx ts-node etp_batch.ts --symbols=SPY,QQQ,DIA --out=out --overwrite
```

3. Revisa `out/orden_del_momento.md` para la **prioridad operativa del día** y cada carpeta por ETF para los CSV/JSON.

---

PUNTO 34:

¡Listo! Ya tienes en el canvas el módulo **`news_fetch.ts`** que consulta el feed de Dora para SPY (o cualquier símbolo que le pases), puntúa titulares por **recencia/impacto/fuente**, y exporta **CSV/JSON/Markdown**. También genera un agregado **`orden_noticias.md`** y un **`news_signal.json`** para enchufarlo a la **ORDEN DEL MOMENTO** (peso sugerido 10%).

Pasos rápidos:

1. exporta tu token:

```
export ROBINHOOD_TOKEN="<jwt>"
```

2. corre un ejemplo:

```
npx ts-node news_fetch.ts --symbols=SPY --out=out
```

---