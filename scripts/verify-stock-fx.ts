import { loadDotEnv } from '../server/akahu/loadEnv.ts';
loadDotEnv();
import { getDb, queryAll, queryOne, persist } from '../server/db/index.ts';
import { syncAkahuPortfolio } from '../server/akahu/sync.ts';

async function main() {
  const db = await getDb();
  const result = await syncAkahuPortfolio(db);
  persist();
  console.log('SYNC', JSON.stringify({ ok: result.ok, fxSources: result.fxSources, stocks: result.stockSymbols }));

  function lookup(assetClass: string, symbolOrAsset: string, qty: number | null) {
    const prefix = assetClass === 'crypto' ? 'CRYPTO' : 'STOCK';
    const key = `${prefix}:${symbolOrAsset}`;
    const q = queryOne(db, 'SELECT price, status, notes FROM price_quotes WHERE asset_key = ?', [key]);
    if (!q || q.status !== 'ok' || q.price == null) {
      return { marketValueNzd: null as number | null, notes: (q?.notes as string) ?? null };
    }
    const unit = Number(q.price);
    const notes = (q.notes as string) ?? null;
    const n = qty != null ? Number(qty) : null;
    let market: number | null = null;
    if (n != null && Number.isFinite(n) && n > 0) market = unit * n;
    else if (notes && /quantity unknown|price holds total/i.test(notes)) market = unit;
    return { marketValueNzd: market, notes };
  }

  function parseNzdValueFromNotes(notes: string | null): number | null {
    if (!notes) return null;
    const arrow = notes.match(/→\s*([\d.]+)\s*NZD\b/i);
    if (arrow) {
      const n = Number(arrow[1]);
      return Number.isFinite(n) ? n : null;
    }
    if (/\b(?:USD|AUD|EUR|GBP)\b/i.test(notes) && /\bno FX\b|\bFX unavailable\b/i.test(notes)) {
      return null;
    }
    const anyNzd = notes.match(/\b([\d.]+)\s*NZD\b/i);
    if (anyNzd) {
      const n = Number(anyNzd[1]);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  for (const row of queryAll(
    db,
    `SELECT asset_class, symbol, shares, asset, amount, notes FROM holdings WHERE asset_class IN ('stock','crypto')`,
  )) {
    const sym = (row.asset_class === 'crypto' ? row.asset : row.symbol) as string;
    const qty = (row.asset_class === 'crypto' ? row.amount : row.shares) as number;
    const m = lookup(row.asset_class as string, sym, qty);
    const ui = m.marketValueNzd != null ? m.marketValueNzd : parseNzdValueFromNotes(row.notes as string);
    console.log(
      'HOLDING',
      JSON.stringify({
        sym,
        apiMarketValueNzd: m.marketValueNzd,
        uiValueWouldShow: ui,
        note: row.notes,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
