/**
 * KATALOGSVEPNING (rapport, ALDRIG skrivningar, NOLL LLM-anrop): letar dubbletter,
 * främmande produkter och andra fel i sealed-katalogen med flera oberoende tekniker.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/sweep-catalog-issues.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/sweep-catalog-issues.ts --out "d:\\AI Hemsidor\\Catalog-sweep.txt"
 *
 * Teknikerna (ägarens observation 2026-08-08 är A: dubbletter saknar oftast set):
 *   A. SETLÖS STUB → bästa set-länkade tvilling (Dice på städad titel, vakter redovisas)
 *   B. Delad tillverkar-GTIN mellan olika produkter (bevisat samma SKU)
 *   C. Nära identiska titlar inom SAMMA set + kategori
 *   D. Vaktbrott på befintliga produkter (tillbehör/annan franchise/sortiment/singel/
 *      merch/blockerat språk) = främmande produkter
 *   E. Karaktärslösa blister/mini tin-stubbar (setlösa) — trolig dubblett av en
 *      karaktärsprodukt, men målet kan inte väljas mekaniskt → ägaren avgör
 *
 * Utdata: ägarens eget markeringsformat ("Duplicates … Goes to …") så raderna kan
 * bockas av/strykas direkt och matas tillbaka som facit.
 */
import * as fs from "node:fs";
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { isBlockedListingLanguage } from "../src/lib/listing-language";
import { isPokemonManufacturerGtin } from "../src/lib/gtin";
import {
  cleanListingTitle,
  characterNames,
  isAccessoryListing,
  isMerchandiseListing,
  isOtherFranchiseListing,
  isSingleCardListing,
  isStoreBundleListing,
  isUnspecifiedCharacterListing,
  languageMismatch,
  mergeEquivalent,
  productsConflict,
  scoreSimilarity,
} from "../src/scrapers/matching";

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER", "OTHER"] as const;
const URL = (slug: string) => `https://www.foilio.se/en/produkter/${slug}`;

type P = {
  id: string;
  title: string;
  slug: string;
  category: string;
  setId: string | null;
  gtin: string | null;
  language: string;
  clean: string;
  norm: string;
  cm: boolean;
  snapshots: number;
  offers: { retailer: string; url: string | null }[];
};

async function main() {
  const rows = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: {
      id: true, title: true, slug: true, category: true, setId: true, gtin: true, language: true,
      _count: { select: { priceSnapshots: true } },
      offers: { select: { url: true, retailer: { select: { name: true } } } },
      set: { select: { name: true } },
    },
  });
  const setNames = new Map<string, string>();
  const products: P[] = rows.map((r) => {
    if (r.setId && r.set) setNames.set(r.setId, r.set.name);
    const clean = cleanListingTitle(r.title);
    return {
      id: r.id, title: r.title, slug: r.slug, category: r.category, setId: r.setId,
      gtin: r.gtin, language: r.language, clean, norm: normalizeTitle(clean),
      cm: r.offers.some((o) => o.retailer.name === "Cardmarket"),
      snapshots: r._count.priceSnapshots,
      offers: r.offers.map((o) => ({ retailer: o.retailer.name, url: o.url })),
    };
  });
  console.log(`${products.length} sealed-produkter.`);

  const lines: string[] = [];
  const reported = new Set<string>(); // par-nycklar så samma par inte står i två sektioner
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const meta = (p: P) =>
    `[${p.category}${p.setId ? `, set: ${setNames.get(p.setId) ?? p.setId}` : ", INGET SET"}` +
    `${p.cm ? ", CM" : ""}, ${p.offers.length} offers, ${p.snapshots} snap] ${p.title}`;

  // ── A. Setlös stub → bästa set-länkade tvilling ─────────────────────────────
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("A. SETLÖSA STUBBAR med en trolig set-länkad tvilling (ägarens mönster)");
  lines.push("   Stryk raden om det INTE är samma vara. Poäng = titellikhet 0–1.");
  lines.push("═══════════════════════════════════════════════════════════════");
  const setless = products.filter((p) => !p.setId);
  const linked = products.filter((p) => p.setId);
  type Hit = { stub: P; twin: P; score: number; flags: string[] };
  const aHits: Hit[] = [];
  for (const stub of setless) {
    let best: Hit | null = null;
    for (const twin of linked) {
      if (twin.category !== stub.category && !(stub.category === "OTHER" || twin.category === "OTHER")) {
        // blister/pack förväxlas ofta av butiker — tillåt det paret också
        const compat = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);
        if (!compat.has(`${stub.category}|${twin.category}`)) continue;
      }
      const score = scoreSimilarity(stub.clean, twin.title);
      if (score < 0.72) continue;
      if (!best || score > best.score) {
        const flags: string[] = [];
        if (productsConflict(stub.title, twin.title)) flags.push("vakt-konflikt");
        if (languageMismatch(stub.clean, twin.title)) flags.push("språk-skiljer");
        if (mergeEquivalent(stub.clean, twin.title)) flags.push("IDENTISK ORDMÄNGD");
        best = { stub, twin, score, flags };
      }
    }
    if (best) aHits.push(best);
  }
  aHits.sort((x, y) => y.score - x.score);
  for (const h of aHits) {
    if (reported.has(pairKey(h.stub.id, h.twin.id))) continue;
    reported.add(pairKey(h.stub.id, h.twin.id));
    lines.push("");
    lines.push(`Duplicates? (poäng ${h.score.toFixed(3)}${h.flags.length ? " · " + h.flags.join(", ") : ""})`);
    lines.push(`  ${meta(h.stub)}`);
    lines.push(`  ${URL(h.stub.slug)}`);
    lines.push(`Goes to`);
    lines.push(`  ${meta(h.twin)}`);
    lines.push(`  ${URL(h.twin.slug)}`);
  }
  console.log(`A: ${aHits.length} setlösa stubbar med trolig tvilling.`);

  // ── B. Delad tillverkar-GTIN ────────────────────────────────────────────────
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("B. SAMMA TILLVERKAR-STRECKKOD på flera produkter (bevisat samma SKU)");
  lines.push("═══════════════════════════════════════════════════════════════");
  const byGtin = new Map<string, P[]>();
  for (const p of products) {
    if (p.gtin && isPokemonManufacturerGtin(p.gtin)) {
      byGtin.set(p.gtin, [...(byGtin.get(p.gtin) ?? []), p]);
    }
  }
  let bCount = 0;
  for (const [gtin, group] of byGtin) {
    if (group.length < 2) continue;
    bCount++;
    lines.push("");
    lines.push(`Duplicates (GTIN ${gtin})`);
    const sorted = [...group].sort((x, y) => Number(y.cm) - Number(x.cm) || y.snapshots - x.snapshots);
    for (const p of sorted.slice(1)) lines.push(`  ${meta(p)}\n  ${URL(p.slug)}`);
    lines.push("Goes to");
    lines.push(`  ${meta(sorted[0])}\n  ${URL(sorted[0].slug)}`);
    for (const p of group) for (const q of group) if (p !== q) reported.add(pairKey(p.id, q.id));
  }
  console.log(`B: ${bCount} GTIN-grupper.`);

  // ── C. Nära identiska titlar inom samma set + kategori ─────────────────────
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("C. TVÅ SET-LÄNKADE produkter i SAMMA set som liknar varandra starkt");
  lines.push("═══════════════════════════════════════════════════════════════");
  let cCount = 0;
  for (let i = 0; i < linked.length; i++) {
    for (let j = i + 1; j < linked.length; j++) {
      const a = linked[i], b = linked[j];
      if (a.setId !== b.setId || a.category !== b.category) continue;
      const score = scoreSimilarity(a.clean, b.title);
      if (score < 0.9) continue;
      if (productsConflict(a.title, b.title)) continue; // bevisat olika (karaktär/antal/version)
      if (reported.has(pairKey(a.id, b.id))) continue;
      reported.add(pairKey(a.id, b.id));
      cCount++;
      lines.push("");
      lines.push(`Duplicates? (poäng ${score.toFixed(3)}${mergeEquivalent(a.clean, b.title) ? " · IDENTISK ORDMÄNGD" : ""})`);
      const keep = a.cm !== b.cm ? (a.cm ? a : b) : a.snapshots >= b.snapshots ? a : b;
      const drop = keep === a ? b : a;
      lines.push(`  ${meta(drop)}\n  ${URL(drop.slug)}`);
      lines.push("Goes to");
      lines.push(`  ${meta(keep)}\n  ${URL(keep.slug)}`);
    }
  }
  console.log(`C: ${cCount} set-interna par.`);

  // ── D. Vaktbrott = främmande produkter ─────────────────────────────────────
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("D. FRÄMMANDE PRODUKTER (dagens vakter flaggar titeln — radera + denylista?)");
  lines.push("═══════════════════════════════════════════════════════════════");
  const guards: [string, (p: P) => boolean][] = [
    ["tillbehör", (p) => isAccessoryListing(p.title)],
    ["annan franchise", (p) => isOtherFranchiseListing(p.title)],
    ["sortiment/bundle", (p) => isStoreBundleListing(p.title)],
    ["enskilt kort", (p) => isSingleCardListing(p.title)],
    ["merch", (p) => isMerchandiseListing(p.title)],
    ["blockerat språk", (p) => isBlockedListingLanguage(p.title, p.slug)],
  ];
  let dCount = 0;
  for (const [why, fn] of guards) {
    for (const p of products.filter(fn)) {
      dCount++;
      lines.push("");
      lines.push(`Delete? (${why})`);
      lines.push(`  ${meta(p)}\n  ${URL(p.slug)}`);
      for (const o of p.offers) if (o.url) lines.push(`    ${o.retailer}: ${o.url}`);
    }
  }
  console.log(`D: ${dCount} vaktbrott.`);

  // ── E. Karaktärslösa blister/mini tin-stubbar (setlösa, ej redan i A) ──────
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("E. KARAKTÄRSLÖSA blister/mini tin UTAN set — troliga dubbletter av en");
  lines.push("   karaktärsprodukt, men målet måste väljas av en människa.");
  lines.push("═══════════════════════════════════════════════════════════════");
  let eCount = 0;
  const aStubIds = new Set(aHits.map((h) => h.stub.id));
  for (const p of setless) {
    if (!isUnspecifiedCharacterListing(p.title)) continue;
    if (aStubIds.has(p.id)) continue;
    eCount++;
    lines.push("");
    lines.push(`Granska (karaktärslös ${p.category})`);
    lines.push(`  ${meta(p)}\n  ${URL(p.slug)}`);
  }
  console.log(`E: ${eCount} karaktärslösa setlösa stubbar (utöver A).`);

  // ── F. Övrigt: helt offerlösa sealed-produkter utan set (död vikt) ─────────
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("F. SETLÖSA produkter UTAN EN ENDA OFFER (ingen källa pekar på dem längre)");
  lines.push("═══════════════════════════════════════════════════════════════");
  let fCount = 0;
  for (const p of setless.filter((x) => x.offers.length === 0)) {
    fCount++;
    lines.push(`  ${meta(p)}\n  ${URL(p.slug)}`);
  }
  console.log(`F: ${fCount} offerlösa setlösa.`);

  const report = lines.join("\n") + "\n";
  if (OUT) {
    fs.writeFileSync(OUT, report, "utf8");
    console.log(`\nRapport skriven till: ${OUT}`);
  } else {
    console.log("\n" + report);
  }
}

main().finally(() => prisma.$disconnect());
