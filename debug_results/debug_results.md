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



PUNTO 31:

¡Excelente captura! Este endpoint de **ETP details** es justo el que alimenta la ficha “fundamental/estática” de SPY en la vista de acciones/opciones. Te dejo la integración completa del módulo con mapeos, normalización, cálculos y alertas útiles para trading con opciones.

# Qué entrega este endpoint (y para qué nos sirve)

**GET** `bonfire.robinhood.com/instruments/{instrument_id}/etp-details/` (tu `instrument_id`= `8f92e76f-...`)

Campos clave que ya viste y cómo los usaremos:

* **Identidad**: `instrument_id`, `symbol`, `index_tracked`, `category`, `broad_category_group`, `is_actively_managed`, `is_leveraged`, `is_inverse`, `is_volatility_linked`, `is_crypto_futures`.
* **Estructura/costos**: `aum` (AUM en USD), `gross_expense_ratio`, `sec_yield`, `documents.prospectus`.
* **Performance**:

  * `quarter_end_date` + `quarter_end_performance` (market/nav: 1Y/3Y/5Y/10Y/since_inception).
  * `month_end_date` + `month_end_performance` (idem).
* **Composición**:

  * `total_holdings`, `sectors_portfolio_date`, `sectors:[{name, weight}]`.
  * `holdings_portfolio_date`, `holdings:[{symbol, name, weight, sector, description}]`.
  * `show_holdings_visualization` (bandera UI).

---

# Normalización (tablas/CSV)

### 1) `etp_profile`

```
instrument_id,symbol,index_tracked,category,broad_category_group,
is_actively_managed,is_leveraged,is_inverse,is_volatility_linked,is_crypto_futures,
aum_usd,expense_ratio,sec_yield,prospectus_url,inception_date,total_holdings,
last_sectors_date,last_holdings_date,show_holdings_visualization,asof_ts
```

**Transformaciones**

* `aum_usd = parseFloat(aum)`
* `expense_ratio = parseFloat(gross_expense_ratio)` (porcentaje, ej. 0.0945% → guarda como 0.0945)
* `sec_yield = parseFloat(sec_yield)`
* `asof_ts = now()`.

### 2) `etp_performance`

```
instrument_id,asof_type,asof_date,kind,period,return_pct
```

* **Ejemplos**:

  * `(SPY, 'quarter_end','2025-09-30','market','1Y', 17.513640)`
  * `(SPY, 'month_end','2025-10-31','nav','5Y', 17.526450)`
* `period ∈ {1Y,3Y,5Y,10Y,since_inception}`, `kind ∈ {market, nav}`.

### 3) `etp_sectors`

```
instrument_id,asof_date,sector,weight_pct
```

* De `sectors_portfolio_date` + `sectors[].weight`.

### 4) `etp_holdings`

```
instrument_id,asof_date,rank,symbol,name,sector,weight_pct
```

* Asigna `rank` por orden descendente de `weight`. (En tu payload vienen top holdings: NVDA 8.00, AAPL 6.93, MSFT 6.44, …).

---

# Cálculos derivados (lo “bonito” de este módulo)

### A) Concentración y diversificación

* **Top-10 %**: suma de `weight_pct` de los 10 mayores.
* **Herfindahl-Hirschman (HHI)** sectorial: `Σ(weight_sector^2)`.

  * **Interpretación** (regla interna):

    * HHI < 1200 → Bien diversificado
    * 1200–2500 → Moderada concentración
    * > 2500 → Alta concentración
* **Bandera de concentración tecnológica**: sector *Technology* > 30% → “tech-heavy” (tu caso: **35.95%**).

### B) “Costos/eficiencia”

* **Expense Ratio anual**: 0.0945% (ultra bajo).
* **SEC Yield** (rendimiento corriente anualizado): 1.04% → contexto de carry vs. T-Bills (para decisiones de puts covered o cash-secured puts).

### C) Rendimientos (para backtests simples de estrategias)

* **Pick de “as-of”**: Preferimos **month_end** para reporting en UI (más fresco: 2025-10-31).
* **Market vs NAV**: muestra ambos; diferencia suele ser mínima en SPY (tracking fuerte).

### D) Lecturas rápidas para opciones

* **Sesgo macro**: tech 36% → **beta a growth/semis** más alta; vega del subyacente tiende a reaccionar a megacaps (NVDA, AAPL, MSFT).
* **Eventos**: con `prospectus_url` listo para link, y combinable con calendario de dividendos (si luego conectamos dividend endpoints) para ajustes de calls ITM/assignment.

---

# UI/UX (secciones nuevas que sumamos al módulo Greeks & Stats)

1. **Tarjeta ETP “Perfil SPY”**

   * **AUM** (USD), **Expense Ratio**, **SEC Yield**.
   * **Index Tracked**: *S&P 500 TR USD*.
   * Chips: *Passive*, *No leverage*, *No inverse*, *Equity—Large Blend*.
   * Link: **Prospectus** (abre en nueva pestaña).

2. **Performance (selector Month-end / Quarter-end)**

   * Mini tabla: Market & NAV → 1Y | 3Y | 5Y | 10Y | SI.
   * Tooltip: “Fuentes: Robinhood Bonfire (as-of: {date}).”

3. **Sectors**

   * Barra apilada o donut: pesos sectoriales.
   * Badges de alerta:

     * *Tech >30%* (ON en tu payload: 35.95).
     * *Energy <3%* (2.88) → cobertura limitada a shocks de crudo (útil si operas XLE puts como hedge alternativo).

4. **Top Holdings**

   * Tabla compacta: Rank, Ticker, Peso, Sector.
   * Nota: para **estrategias de opciones en SPY**, vigilar earnings/flows de **NVDA/AAPL/MSFT**: impactos en la skew y IV de SPY.

---

# Reglas de refresco & caching

* **ETP details** no cambia intradía con alta frecuencia:

  * **Sectors/Holdings**: refrescar **diario** (o cuando `*_portfolio_date` cambie).
  * **Performance**: refrescar **mensual** (month_end) y **trimestral** (quarter_end).
  * **AUM**: semanal o cuando detectes cambio >1%.

---

# Validaciones & saneamiento

* `weight_pct` debe sumar ~100% (tolerancia ±0.5%).
* Si `total_holdings` > filas reales en `holdings`, marcar que son **top holdings** (no el universo completo) → ya es lo normal en front.
* Si `prospectus_url` falta → ocultar CTA.
* Tipos booleanos (is_leveraged/inverse/volatility_linked/crypto_futures) → chips y filtros.

---

# Alertas útiles (para tu tablero de opciones)

1. **Concentración sectorial**

   * Trigger: `Technology ≥ 30%` → *“SPY tech-heavy: considera la sensibilidad a resultados mega-cap; IV puede inflarse en ventanas de earnings de NVDA/AAPL/MSFT.”*
2. **Top-10 > 35%**

   * Si supera el umbral → *“Riesgo idiosincrático de mega-cap en un ETF broad.”*
3. **Expense Ratio > 0.3%** (no aplica a SPY, pero deja la regla genérica).
4. **Diferencia Market vs NAV** fuera de banda (tracking error) → alerta si |Market−NAV| en 1Y difiere >50 bps (en SPY es raro).

---

# Cómo conectarlo con tu módulo de Greeks

* En la **cabecera** de SPY: añade un **panel lateral** “Fundamentals” alimentado por este endpoint.
* En la **sección de estrategias**:

  * Si *Tech concentration* alerta = ON y **IV Rank** (de tu módulo) > 0.7 → favorece **ventas de prima** (credit spreads/iron condors) salvo evento binario próximo (CPI/FOMC/earnings NVDA).
  * Si *Tech* alta pero **IV Rank** bajo → calls débiles (debit) posiblemente ineficientes; mejor **verticales** o **diagonales** con calendario sobre vencimientos de mega-caps.

---

# Pseudocódigo (parse/guardar)

```ts
type EtpDetails = {
  instrument_id:string; symbol:string; index_tracked:string; category:string;
  broad_category_group:string; is_actively_managed:boolean; is_leveraged:boolean;
  is_inverse:boolean; is_volatility_linked:boolean; is_crypto_futures:boolean;
  aum:string; sec_yield:string; gross_expense_ratio:string;
  documents?:{prospectus?:string};
  inception_date?:string; total_holdings?:number;
  quarter_end_date?:string; quarter_end_performance?:any;
  month_end_date?:string; month_end_performance?:any;
  sectors_portfolio_date?:string; sectors?:{name:string; weight:string}[];
  holdings_portfolio_date?:string; holdings?:{symbol:string; name:string; weight:string; sector?:string}[];
};

function parseEtpDetails(raw:EtpDetails){
  const profile = {
    instrument_id: raw.instrument_id,
    symbol: raw.symbol,
    index_tracked: raw.index_tracked,
    category: raw.category,
    broad_category_group: raw.broad_category_group,
    is_actively_managed: !!raw.is_actively_managed,
    is_leveraged: !!raw.is_leveraged,
    is_inverse: !!raw.is_inverse,
    is_volatility_linked: !!raw.is_volatility_linked,
    is_crypto_futures: !!raw.is_crypto_futures,
    aum_usd: num(raw.aum),
    expense_ratio: num(raw.gross_expense_ratio),
    sec_yield: num(raw.sec_yield),
    prospectus_url: raw.documents?.prospectus ?? null,
    inception_date: raw.inception_date ?? null,
    total_holdings: raw.total_holdings ?? null,
    last_sectors_date: raw.sectors_portfolio_date ?? null,
    last_holdings_date: raw.holdings_portfolio_date ?? null,
    show_holdings_visualization: !!raw.show_holdings_visualization,
    asof_ts: new Date().toISOString(),
  };

  const perf = [];
  for (const asof of ['quarter','month'] as const){
    const key = asof==='quarter'?'quarter_end_performance':'month_end_performance';
    const dkey = asof==='quarter'?'quarter_end_date':'month_end_date';
    const asof_date = (raw as any)[dkey] ?? null;
    if (!asof_date || !(raw as any)[key]) continue;
    for (const kind of ['market','nav'] as const){
      const bucket = (raw as any)[key]?.[kind];
      if (!bucket) continue;
      for (const period of ['1Y','3Y','5Y','10Y','since_inception'] as const){
        const v = num(bucket[period]);
        if (v!=null) perf.push({
          instrument_id: raw.instrument_id, asof_type: asof+'_end', asof_date,
          kind, period, return_pct: v
        });
      }
    }
  }

  const sectors = (raw.sectors??[]).map(s=>({
    instrument_id: raw.instrument_id,
    asof_date: raw.sectors_portfolio_date ?? null,
    sector: s.name,
    weight_pct: num(s.weight)
  }));

  const holdings = (raw.holdings??[])
    .sort((a,b)=>num(b.weight)-num(a.weight))
    .map((h,idx)=>({
      instrument_id: raw.instrument_id,
      asof_date: raw.holdings_portfolio_date ?? null,
      rank: idx+1,
      symbol: h.symbol,
      name: h.name,
      sector: h.sector ?? null,
      weight_pct: num(h.weight)
    }));

  return {profile, perf, sectors, holdings};
}

function num(x:any){ if(x==null) return null; const v=parseFloat(String(x)); return Number.isFinite(v)?v:null; }
```

---

# “Mentor tips” para operativa real (SPY)

* **Concentración tech (36%)** → cuando haya **earnings de NVDA/AAPL/MSFT**, la **smile** de SPY suele sesgar puts (skew) y subir IV: aprovecha con **put credit spreads** lejos del spot si **IVR alto** y spreads <0.5%.
* **Expense 0.0945%** + **tracking perfecto** → para **diagonales** y **calendars** usa SPY como subyacente estándar (mejor que productos apalancados).
* Si tu módulo de **Greeks** detecta **ΣGamma** cercano a flip y el panel **ETP** marca **Top-10>30%**, ten cuidado con gaps por single-name megacaps.

---