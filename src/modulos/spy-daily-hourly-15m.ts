// src/modulos/spy-daily-hourly-15m.ts
import fs from 'fs';
import path from 'path';
import type { BrowserContext, Page } from 'playwright';

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// --- Resolver directorio del archivo (funciona en CJS y ESM/tsx) ---
async function resolveThisFileDir(): Promise<string> {
  // CJS: __dirname existe
  // ESM/tsx: usamos import.meta.url -> fileURLToPath
  try {
    // @ts-ignore
    if (typeof __dirname !== 'undefined' && __dirname) {
      return __dirname;
    }
  } catch {}
  try {
    const { fileURLToPath } = await import('url');
    // @ts-ignore
    const __filename = fileURLToPath(import.meta.url);
    return path.dirname(__filename);
  } catch {
    return process.cwd();
  }
}

async function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function waitForSections(page: Page, minCount = 1, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await page.locator('section').count().catch(() => 0);
    if (count >= minCount) return count;
    await page.waitForTimeout(300);
  }
  return 0;
}

async function autoScroll(page: Page, steps = 6, stepPx = 800, delayMs = 250) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollBy(0, y), stepPx);
    await page.waitForTimeout(delayMs);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Guarda outerHTML de la sección i (1-indexed)
async function saveSectionHtml(page: Page, fileDir: string, index1: number, stamp: string) {
  const locator = page.locator('section').nth(index1 - 1);
  const exists = await locator.count();
  if (!exists) {
    console.warn(`⚠️ [spy] section #${index1} no existe (count=0)`);
    return null;
  }
  const h = await locator.elementHandle();
  if (!h) {
    console.warn(`⚠️ [spy] section #${index1} no tiene handle`);
    return null;
  }
  const html = await h.evaluate((el) => (el as HTMLElement).outerHTML);
  const fname = `section-${index1}-${stamp}.html`;
  const fpath = path.join(fileDir, fname);
  fs.writeFileSync(fpath, html, 'utf-8');
  console.log(`✅ [spy] Guardado ${fname} en ${fileDir}`);
  return fpath;
}

// Permite que lo llames con BrowserContext o con Page
export async function runSpyDailyHourly15mModule(ctxOrPage: BrowserContext | Page) {
  const fileDir = await resolveThisFileDir();
  await ensureDir(fileDir);

  let page: Page | null = null;
  if (typeof (ctxOrPage as any).newPage === 'function') {
    // Parece BrowserContext
    const context = ctxOrPage as BrowserContext;
    page = await context.newPage();
  } else {
    // Parece Page
    page = ctxOrPage as Page;
  }

  if (!page) throw new Error('[spy] No se pudo obtener la Page');

  console.log('🟢 [spy] Modo: guardar las 3 primeras <section> de la pestaña actual');
  console.log('📂 [spy] Directorio destino:', fileDir);

  // Si esta función creó la página, navega a SPY; si no, usa la pestaña actual
  const mustNavigate = (await page.title().catch(() => '')) === '' || !page.url().startsWith('https://robinhood.com/');
  if (mustNavigate) {
    await page.goto('https://robinhood.com/stocks/SPY', { waitUntil: 'domcontentloaded' });
  }

  // Espera un poco a que hidrate
  await page.waitForTimeout(1200);

  // Intento 1: buscar sections
  let count = await waitForSections(page, 1, 8000);

  // Si hay pocas, haz scroll para forzar render lazy y vuelve a contar
  if (count < 3) {
    await autoScroll(page, 8, 900, 200);
    count = await waitForSections(page, 1, 8000);
  }

  console.log(`ℹ️ [spy] Se detectaron ${count} <section> (tras scroll/espera)`);

  const stamp = nowStamp();
  let saved = 0;
  for (let i = 1; i <= Math.min(3, count); i++) {
    const out = await saveSectionHtml(page, fileDir, i, stamp);
    if (out) saved++;
  }

  if (saved === 0) {
    console.warn('⚠️ [spy] No se guardó ninguna sección. Revisa permisos de escritura y el directorio de salida.');
  } else if (saved < 3) {
    console.warn(`ℹ️ [spy] Se guardaron ${saved} secciones (menos de 3 disponibles).`);
  } else {
    console.log('🏁 [spy] Guardadas las 3 secciones correctamente.');
  }

  // No cierres la pestaña: lo controlas tú manualmente
  // Si prefieres cerrarla cuando terminamos, descomenta:
  // await page.close();
}
