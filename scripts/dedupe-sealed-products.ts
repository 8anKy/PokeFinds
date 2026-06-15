/**
 * Slår ihop dubblett-sealed-produkter. Identitet = Cardmarket idProduct (ur
 * offer-URL:er). Inom varje idProduct-grupp klustras produkter på en kanonisk
 * nyckel (varumärke/set-kod/era/antals-suffix borttaget) så att ENDAST verkligt
 * identiska produkter slås ihop — olika produkter som felaktigt delar idProduct
 * (t.ex. en Vileplume-blister + en Sleeved Booster) får olika nyckel och rörs ej.
 *
 * Kanonisk produkt per kluster = den med bild, ren titel (utan "(6)"), "Pokémon
 * TCG:"-prefix, flest offers. Dubbletternas offers/bevakningar/samlingsposter
 * flyttas dit (krockar löses), resten kaskad-raderas med produkten.
 *
 *   npx tsx scripts/dedupe-sealed-products.ts            (dry-run)
 *   MERGE=1 npx tsx scripts/dedupe-sealed-products.ts    (utför)
 */
import { PrismaClient } from "@prisma/client";
import { normalizeTitle } from "../src/lib/utils";

const prisma = new PrismaClient();
const MERGE = process.env.MERGE === "1";

function cmId(url: string): string | null {
  return url.match(/idProduct=(\d+)/)?.[1] ?? null;
}

/** Kanonisk nyckel: tar bort varumärke, era, set-kod och antals-suffix. */
function canonKey(title: string): string {
  let t = normalizeTitle(title);
  t = t.replace(/\b(pokémon|pokemon|tcg|the|engelsk|english|sealed)\b/g, " ");
  t = t.replace(/\bmega evolution\b|\bscarlet (and )?violet\b|\bsword (and )?shield\b|\bsun (and )?moon\b/g, " ");
  t = t.replace(/\b(me|sv|swsh|sm|xy|bw|hgss|dp)\d+[a-z]?\b/g, " "); // set-koder me4, sv10…
  t = t.replace(/\(\s*\d+[^)]*\)/g, " "); // antals-annotering (6), (36 boosters)
  t = t.replace(/\bcopy of\b|\bkopia\b/g, " ");
  // Formsynonym: en booster display ÄR en booster box.
  t = t.replace(/\bdisplay(låda|er)?\b/g, "box");
  // OBS: inline-siffror behålls medvetet (Vol 4, Series 9, 4-pocket, 2008,
  // 3-pack) — de särskiljer produkter och får ALDRIG strippas.
  return t.split(/\s+/).filter((w) => w.length >= 2).sort().join(" ");
}

function score(p: { title: string; imageUrl: string | null; _count: { offers: number } }): number {
  let s = p._count.offers;
  if (p.imageUrl) s += 1000;
  if (!/\(/.test(p.title)) s += 100;
  if (/pok[eé]mon tcg/i.test(p.title)) s += 50;
  s -= p.title.length * 0.01;
  return s;
}

type P = {
  id: string; title: string; slug: string; imageUrl: string | null; language: string;
  offers: { id: string; url: string; retailerId: string; condition: string; language: string }[];
  _count: { offers: number };
};
const cmIdsOf = (p: P) => new Set(p.offers.map((o) => cmId(o.url)).filter(Boolean) as string[]);

async function mergeInto(canonical: P, dup: P) {
  // Offers: flytta unika, radera krockande (samma retailer/skick/språk).
  for (const o of dup.offers) {
    const clash = await prisma.offer.findUnique({
      where: { productId_retailerId_condition_language: { productId: canonical.id, retailerId: o.retailerId, condition: o.condition as any, language: o.language as any } },
      select: { id: true },
    });
    if (clash) await prisma.offer.delete({ where: { id: o.id } });
    else await prisma.offer.update({ where: { id: o.id }, data: { productId: canonical.id } });
  }
  // Watchlist: flytta, hoppa krockar (samma user bevakar redan canonical).
  const watches = await prisma.watchlistItem.findMany({ where: { productId: dup.id }, select: { id: true, userId: true } });
  for (const w of watches) {
    const clash = await prisma.watchlistItem.findUnique({ where: { userId_productId: { userId: w.userId, productId: canonical.id } }, select: { id: true } });
    if (!clash) await prisma.watchlistItem.update({ where: { id: w.id }, data: { productId: canonical.id } });
  }
  // Samlingsposter + alerts: peka om till canonical (ingen unik-nyckel).
  await prisma.collectionItem.updateMany({ where: { productId: dup.id }, data: { productId: canonical.id } });
  await prisma.alert.updateMany({ where: { productId: dup.id }, data: { productId: canonical.id } });
  // Resten (priceObservation/snapshot/restockEvent + ev. kvarvarande) kaskad-raderas.
  await prisma.product.delete({ where: { id: dup.id } });
}

async function main() {
  const sealed = (await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true, title: true, slug: true, imageUrl: true, language: true,
      offers: { select: { id: true, url: true, retailerId: true, condition: true, language: true } },
      _count: { select: { offers: true } },
    },
  })) as P[];

  // Gruppera på CM idProduct (= CM:s produktidentitet). Klustra SEDAN inom varje
  // grupp på (språk + kanonisk nyckel). idProduct-grupperingen gör era-/setkod-
  // normaliseringen säker: olika produkter som felmappats till samma idProduct
  // (t.ex. Vileplume-blister + Sleeved Booster) får olika nyckel och rörs ej, och
  // olika bas-set (Sun&Moon vs Sword&Shield) hamnar i olika idProduct-grupper.
  const byCmId = new Map<string, P[]>();
  for (const p of sealed) {
    for (const id of cmIdsOf(p)) {
      if (!byCmId.has(id)) byCmId.set(id, []);
      byCmId.get(id)!.push(p);
    }
  }

  const merges: { canonical: P; dups: P[] }[] = [];
  const seen = new Set<string>();
  for (const [, group] of byCmId) {
    const clusters = new Map<string, P[]>();
    for (const p of group) {
      const k = `${p.language}|${canonKey(p.title)}`;
      if (!clusters.has(k)) clusters.set(k, []);
      clusters.get(k)!.push(p);
    }
    for (const [, members] of clusters) {
      const uniq = members.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      if (uniq.length < 2) continue;
      uniq.sort((a, b) => score(b) - score(a));
      merges.push({ canonical: uniq[0], dups: uniq.slice(1) });
    }
  }

  console.log(`=== ${merges.length} merge-kluster (dubbletter) ===`);
  let totalDups = 0;
  for (const m of merges) {
    totalDups += m.dups.length;
    console.log(`  ✔ BEHÅLL "${m.canonical.title}" (${m.canonical._count.offers}o)`);
    for (const d of m.dups) console.log(`      ⨉ slå ihop "${d.title}" (${d._count.offers}o)`);
  }
  console.log(`\nProdukter som tas bort: ${totalDups}`);

  if (MERGE) {
    for (const m of merges) for (const d of m.dups) await mergeInto(m.canonical, d);
    console.log(`\n🔀 Sammanslagning klar. ${totalDups} dubbletter borttagna.`);
  } else {
    console.log("\nDry-run — kör med MERGE=1 för att slå ihop.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
