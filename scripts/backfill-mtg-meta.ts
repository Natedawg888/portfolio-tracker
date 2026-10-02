/**
 * Backfill MTG card_colours + card_rarity from Scryfall /cards/collection.
 * Stop the API before running (sql.js must not overwrite on disk).
 *
 *   npm run db:backfill-mtg-meta
 *   npm run db:backfill-mtg-meta -- --force
 */
import { getDb, queryAll, persist, DB_PATH } from '../server/db/index.ts';
import {
  fetchScryfallCollectionMeta,
  coloursToStorage,
} from '../server/quotes/cards.ts';

function coalesce(existing: unknown, next: string | null): string | null {
  if (existing != null) return String(existing);
  return next;
}

async function main() {
  const force = process.argv.includes('--force');
  const db = await getDb();
  const rows = queryAll(
    db,
    force
      ? `SELECT id, name, card_api_id, card_colours, card_rarity FROM holdings
         WHERE asset_class = 'collectable' AND lower(coalesce(card_game,'')) = 'mtg'
           AND card_api_id IS NOT NULL AND trim(card_api_id) != ''`
      : `SELECT id, name, card_api_id, card_colours, card_rarity FROM holdings
         WHERE asset_class = 'collectable' AND lower(coalesce(card_game,'')) = 'mtg'
           AND card_api_id IS NOT NULL AND trim(card_api_id) != ''
           AND (card_colours IS NULL OR card_rarity IS NULL)`,
  );
  console.log(`[backfill-mtg-meta] DB=${DB_PATH}`);
  console.log(`[backfill-mtg-meta] candidates=${rows.length} force=${force}`);
  if (rows.length === 0) {
    console.log('[backfill-mtg-meta] nothing to do');
    return;
  }
  const meta = await fetchScryfallCollectionMeta(rows.map((r) => String(r.card_api_id)));
  console.log(`[backfill-mtg-meta] scryfall fetched=${meta.size}`);
  const nowIso = new Date().toISOString();
  let updated = 0;
  let missing = 0;
  // Batch in-memory updates; persist once (avoids OneDrive EPERM on every row).
  for (const row of rows) {
    const apiId = String(row.card_api_id);
    const m = meta.get(apiId);
    if (!m) {
      missing += 1;
      continue;
    }
    const fillColours = coalesce(force ? null : row.card_colours, coloursToStorage(m.colours));
    const fillRarity = coalesce(force ? null : row.card_rarity, m.rarity);
    if (fillColours === row.card_colours && fillRarity === row.card_rarity) continue;
    db.run(
      `UPDATE holdings SET card_colours=?, card_rarity=?,
        card_image_url=COALESCE(card_image_url, ?),
        card_set=COALESCE(card_set, ?),
        card_number=COALESCE(card_number, ?),
        updated_at=? WHERE id=?`,
      [fillColours, fillRarity, m.imageUrl, m.set, m.number, nowIso, row.id],
    );
    updated += 1;
  }
  persist();
  console.log(`[backfill-mtg-meta] updated=${updated} missing=${missing}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
