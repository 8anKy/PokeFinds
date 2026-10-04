/**
 * Engångsimport av källkontrollerade FYSISKA butiker. Inga antaganden om lager.
 * Källor + adresskoordinater är frysta i JSON-filen; ingen geokodning i appen.
 * --dry är standard. --apply skapar saknade filialer, ändrar ALDRIG befintliga
 * förslag, ägarens modereringsbeslut eller senare adressrättningar.
 * --fill-positions (med --apply) sätter position på BEFINTLIGA källfilialer som
 * saknar en — bara där databasen har null, en satt position skrivs aldrig över.
 */
import { PrismaClient } from "@prisma/client";
import stores from "../src/data/community-stores-curated.json";
import { storeIdentity } from "../src/lib/community-stores";
import { createHash } from "node:crypto";

const db = new PrismaClient();
const apply = process.argv.includes("--apply") && !process.argv.includes("--dry");
async function main() {
  const existing = await db.communityStore.findMany({ select: { identityKey: true } });
  const keys = new Set(existing.map(s => s.identityKey));
  const missing = stores.filter(s => !keys.has(storeIdentity(s.name, s.address, s.city)));
  console.log(`${apply ? "APPLY" : "DRY"}: ${missing.length} saknade av ${stores.length} källkontrollerade butiker.`);
  for (const store of missing) console.log(`${store.name} · ${store.address} · ${store.city}`);
  if (process.argv.includes("--fill-positions")) {
    const positioned = new Map(stores.filter(s => s.latitude != null && s.longitude != null)
      .map(s => [storeIdentity(s.name, s.address, s.city), s]));
    const rows = await db.communityStore.findMany({ where: { latitude: null }, select: { id: true, identityKey: true, name: true } });
    const fill = rows.filter(r => positioned.has(r.identityKey));
    console.log(`${apply ? "APPLY" : "DRY"}: ${fill.length} befintliga filialer får position.`);
    for (const r of fill) console.log(`  ${r.name}`);
    if (apply) for (const r of fill) {
      const s = positioned.get(r.identityKey)!;
      await db.communityStore.updateMany({ where: { id: r.id, latitude: null }, data: { latitude: s.latitude, longitude: s.longitude } });
    }
  }
  if (!apply || !missing.length) return;
  await db.$transaction(missing.map(s => {
    const identityKey = storeIdentity(s.name, s.address, s.city);
    return db.communityStore.upsert({ where: { identityKey }, update: {}, create: {
      id: `store_${createHash("sha256").update(identityKey).digest("hex").slice(0, 24)}`,
      identityKey, name: s.name, address: s.address, city: s.city,
      latitude: s.latitude, longitude: s.longitude, status: "APPROVED",
    } });
  }));
  console.log(`Importerade ${missing.length} butiker. Katalogcachen blir färsk vid nästa deploy.`);
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
