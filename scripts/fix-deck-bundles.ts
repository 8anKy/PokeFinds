/**
 * Sanerar deck-produkter (League/Battle/Theme/Starter Deck) som den gamla
 * matcharen rörde ihop:
 *   1. RADERAR felmatchade butiks-offers — en offer vars läsbara URL-slug
 *      beskriver en ANNAN karaktär än produkten (t.ex. en Inteleon VMAX-offer
 *      på "Palkia VSTAR League Battle Deck", eller en Mega Gengar-offer som satt
 *      fel pris på "Mega Lucario ex League Battle Deck").
 *   2. SLÅR IHOP dubblettprodukter — samma deck i olika ordföljd
 *      ("League Battle Deck Palkia VSTAR" ↔ "Palkia VSTAR League Battle Deck").
 *   3. Räknar om pris-cachen så att lägsta pris speglar de korrekta offers.
 *
 * Karaktärsidentiteten = deckIdentity() (särskiljande ord minus linje-orden
 * league/battle/deck/mega/…). Jämförelsen är prefix-tolerant (4 tecken) så att
 * trunkerade slugs ("…vstar-palk" för Palkia) inte felflaggas. Offers med
 * oläsbar/numerisk slug (kan ej verifieras) lämnas orörda.
 *
 *   npx tsx scripts/fix-deck-bundles.ts          (dry-run)
 *   APPLY=1 npx tsx scripts/fix-deck-bundles.ts  (utför)
 */
import { PrismaClient } from "@prisma/client";
import { classifyForm, deckIdentity } from "../src/scrapers/matching";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

/** Läsbar titel ur en produkt-URL:s slug (null för sök-/numeriska URL:er). */
function titleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname.includes("search") || u.search.length > 0) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    let slug = decodeURIComponent(segments[segments.length - 1]);
    slug = slug.replace(/\.(html?|php|aspx?)$/i, "");
    slug = slug.replace(/^\d{3,}-/, ""); // inledande artikelnummer
    const words = slug.replace(/[-_+]/g, " ").trim();
    if (words.length < 6) return null;
    return words;
  } catch {
    return null;
  }
}

/** Delar två identiteter minst ett karaktärsord? Prefix-tolerant (≥4 tecken). */
function charsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      if (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)) return true;
    }
  }
  return false;
}

type P = {
  id: string;
  title: string;
  slug: string;
  imageUrl: string | null;
  language: string;
  offers: { id: string; url: string; retailerId: string; condition: string; language: string }[];
  _count: { offers: number };
};

function score(p: P): number {
  let s = p._count.offers;
  if (p.imageUrl) s += 1000;
  if (!/\(/.test(p.title)) s += 100;
  s -= p.title.length * 0.01;
  return s;
}

async function mergeInto(canonical: P, dup: P) {
  for (const o of dup.offers) {
    const clash = await prisma.offer.findUnique({
      where: {
        productId_retailerId_condition_language: {
          productId: canonical.id,
          retailerId: o.retailerId,
          condition: o.condition as any,
          language: o.language as any,
        },
      },
      select: { id: true },
    });
    if (clash) await prisma.offer.delete({ where: { id: o.id } });
    else await prisma.offer.update({ where: { id: o.id }, data: { productId: canonical.id } });
  }
  const watches = await prisma.watchlistItem.findMany({
    where: { productId: dup.id },
    select: { id: true, userId: true },
  });
  for (const w of watches) {
    const clash = await prisma.watchlistItem.findUnique({
      where: { userId_productId: { userId: w.userId, productId: canonical.id } },
      select: { id: true },
    });
    if (!clash)
      await prisma.watchlistItem.update({ where: { id: w.id }, data: { productId: canonical.id } });
  }
  await prisma.collectionItem.updateMany({
    where: { productId: dup.id },
    data: { productId: canonical.id },
  });
  await prisma.alert.updateMany({ where: { productId: dup.id }, data: { productId: canonical.id } });
  await prisma.product.delete({ where: { id: dup.id } });
}

async function main() {
  // Alla produkter vars titel är en deck (oavsett kategori).
  const all = (await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true,
      title: true,
      slug: true,
      imageUrl: true,
      language: true,
      offers: {
        select: { id: true, url: true, retailerId: true, condition: true, language: true },
      },
      _count: { select: { offers: true } },
    },
  })) as P[];

  const decks = all.filter((p) => classifyForm(p.title) === "deck");
  console.log(`🎴 ${decks.length} deck-produkter granskas.\n`);

  // ---- STEG 1: radera felmatchade offers (fel karaktär) ----
  const offersToDelete: { id: string; why: string }[] = [];
  for (const p of decks) {
    const pid = deckIdentity(p.title);
    if (pid.size === 0) continue; // produkten saknar karaktärsord → kan ej validera
    for (const o of p.offers) {
      const t = titleFromUrl(o.url);
      if (!t) continue; // sök-/numerisk slug → kan ej verifiera
      const oid = deckIdentity(t);
      if (oid.size === 0) continue;
      if (!charsOverlap(pid, oid)) {
        offersToDelete.push({
          id: o.id,
          why: `"${t}" [${[...oid].join(",")}] ≠ "${p.title}" [${[...pid].join(",")}]`,
        });
      }
    }
  }
  console.log(`=== STEG 1: ${offersToDelete.length} felmatchade offers ===`);
  for (const d of offersToDelete) console.log(`  ✗ ${d.why}`);

  // ---- STEG 2: slå ihop dubbletter (samma karaktär, olika ordföljd) ----
  const byKey = new Map<string, P[]>();
  for (const p of decks) {
    const id = deckIdentity(p.title);
    if (id.size === 0) continue;
    const key = `${p.language}|${[...id].sort().join(" ")}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(p);
  }
  const merges: { canonical: P; dups: P[] }[] = [];
  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    group.sort((a, b) => score(b) - score(a));
    merges.push({ canonical: group[0], dups: group.slice(1) });
  }
  console.log(`\n=== STEG 2: ${merges.length} dubblett-kluster ===`);
  let totalDups = 0;
  for (const m of merges) {
    totalDups += m.dups.length;
    console.log(`  ✔ BEHÅLL "${m.canonical.title}"`);
    for (const d of m.dups) console.log(`      ⨉ slå ihop "${d.title}"`);
  }

  if (!APPLY) {
    console.log(`\nDry-run — kör med APPLY=1 för att utföra.`);
    return;
  }

  // Utför: radera offers först (så att merge flyttar bara korrekta), sedan merge.
  if (offersToDelete.length > 0) {
    const res = await prisma.offer.deleteMany({ where: { id: { in: offersToDelete.map((d) => d.id) } } });
    console.log(`\n🗑️  Raderade ${res.count} felmatchade offers.`);
  }
  for (const m of merges) for (const d of m.dups) await mergeInto(m.canonical, d);
  console.log(`🔀 Slog ihop ${totalDups} dubbletter.`);

  console.log(`\n♻️  Räknar om pris-cache…`);
  await recomputeProductPriceCache();
  console.log(`✅ Klart.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
