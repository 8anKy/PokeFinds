/**
 * MÄTER VÄGEN TILLBAKA TILL OSS I DISCORD-INLÄGGEN.
 *
 * Frågan skriptet svarar på: av allt de bevakade butikerna har i lager just nu, hur
 * många annonser skulle få en PRODUKTLÄNK ("Se på Foilio", med prishistorik) och hur
 * många får bara en SETLÄNK ("Hos oss")? Och hur mycket av setlänks-svansen skulle en
 * titelmatchning mot katalogen kunna lyfta till en produktlänk?
 *
 * Ägaren rapporterade 2026-08-17 att inläggen ibland pekar på hela setet i stället för
 * varan. Setlänken är reserven för URL:er som saknas i ruttabellen (butiks-URL →
 * produkt); den byggs bara ur Offer + bunden StoreListing, så en vara vi ALDRIG
 * importerat — eller en URL som per konstruktion inte kan få en egen offer — har ingen
 * produktsida att peka på. Katalogen kan ändå känna igen VARAN via titeln.
 *
 * ⛔ EN läsning ur Neon (ruttabell + katalogens sealed-titlar), resten är ren HTTP mot
 *    butikernas feedar — samma fas 1 som lanen själv kör. Kör den inte i en loop.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/audit-discord-product-links.ts
 *      … --dump <fil>   skriver hela matchningslistan som JSON för granskning
 */
import "./load-env";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { runRestockScan, type FeedItem } from "../src/scrapers/runner";
import { buildRestockRoutes } from "./lib/restock-routes";
import { setDynamicDenylist } from "../src/scrapers/import-denylist";
import {
  buildDiscordFilterContext,
  buildKnownSets,
  classifyDiscordListing,
  matchKnownSet,
} from "../src/lib/discord-restock-filter";
import { matchListingToProduct } from "../src/scrapers/matching";

async function main() {
  const payload = await buildRestockRoutes();
  if (!payload) throw new Error("Ingen ruttabell kunde byggas — inga restock-bevakade källor?");
  const { sources, routes } = payload;
  setDynamicDenylist(payload.deniedUrls);
  const ctx = buildDiscordFilterContext(payload);
  const knownSets = buildKnownSets(payload);

  // Katalogens SEALED-produkter. Singlar utesluts: de fälls av vakterna före det här
  // steget, och 20k kortrader hade gjort kandidatslingan meningslöst dyr.
  const products = await prisma.product.findMany({
    where: { cardId: null },
    select: {
      slug: true,
      title: true,
      normalizedTitle: true,
      variantLabel: true,
      setId: true,
      language: true,
    },
  });
  const bySet = new Map<string, typeof products>();
  for (const p of products) {
    if (!p.setId) continue;
    const list = bySet.get(p.setId) ?? [];
    list.push(p);
    bySet.set(p.setId, list);
  }
  console.log(
    `[audit] ${Object.keys(routes).length} rutter, ${products.length} sealed-produkter ` +
      `(${bySet.size} set har minst en), ${knownSets.length} kända setnamn.`
  );

  const fetched: { sourceName: string; items: FeedItem[] }[] = [];
  await runRestockScan({
    sources,
    shouldProcess: async (groups) => {
      fetched.push(...groups);
      return false; // ⛔ rör aldrig DB-fasen
    },
  });

  type Row = { postable: number; route: number; matched: number; setOnly: number; nothing: number };
  const perStore = new Map<string, Row>();
  const matched: {
    store: string;
    title: string;
    url: string;
    set: string;
    product: string;
    slug: string;
    score: number;
  }[] = [];
  const unmatched: { store: string; title: string; set: string; candidates: number }[] = [];
  const nothing: { store: string; title: string }[] = [];

  for (const g of fetched) {
    const row: Row = { postable: 0, route: 0, matched: 0, setOnly: 0, nothing: 0 };
    for (const it of g.items) {
      if (it.stockStatus !== "IN_STOCK") continue;
      const verdict = classifyDiscordListing({ title: it.title, url: it.url, category: it.category }, ctx);
      const route = routes[it.url];
      // En fälld annons MED rutt postas ändå (rutten övertrumfar vakterna, utom
      // språk/denylist) — samma regel som deriveRestockPosts.
      const rescued = Boolean(route) && verdict.reason !== "language" && verdict.reason !== "denylist";
      if (!verdict.ok && !rescued) continue;
      row.postable++;
      if (route) {
        row.route++;
        continue;
      }
      const guessed = matchKnownSet(it.title, knownSets, verdict.language);
      if (!guessed?.id) {
        row.nothing++;
        if (nothing.length < 300) nothing.push({ store: g.sourceName, title: it.title });
        continue;
      }
      const candidates = bySet.get(guessed.id) ?? [];
      let best: { slug: string; title: string; score: number } | null = null;
      for (const c of candidates) {
        if ((c.language ?? "EN") !== verdict.language) continue;
        const score = matchListingToProduct(it.title, {
          normalizedTitle: c.normalizedTitle,
          card: null,
          variantLabel: c.variantLabel,
        });
        if (score == null) continue;
        if (!best || score > best.score) best = { slug: c.slug, title: c.title, score };
      }
      if (best) {
        row.matched++;
        if (matched.length < 1000) {
          matched.push({
            store: g.sourceName,
            title: it.title,
            url: it.url,
            set: guessed.name,
            product: best.title,
            slug: best.slug,
            score: best.score,
          });
        }
      } else {
        row.setOnly++;
        if (unmatched.length < 1000) {
          unmatched.push({
            store: g.sourceName,
            title: it.title,
            set: guessed.name,
            candidates: candidates.length,
          });
        }
      }
    }
    perStore.set(g.sourceName, row);
  }

  const tot: Row = { postable: 0, route: 0, matched: 0, setOnly: 0, nothing: 0 };
  for (const r of perStore.values()) {
    tot.postable += r.postable;
    tot.route += r.route;
    tot.matched += r.matched;
    tot.setOnly += r.setOnly;
    tot.nothing += r.nothing;
  }

  console.log("\n=== PER BUTIK (postbara i lager nu) ===");
  console.log(
    "butik".padEnd(24),
    "postbara".padStart(9),
    "rutt".padStart(6),
    "titelm.".padStart(8),
    "bara set".padStart(9),
    "utan länk".padStart(10)
  );
  for (const [name, r] of [...perStore].sort((a, b) => b[1].setOnly - a[1].setOnly)) {
    console.log(
      name.padEnd(24),
      String(r.postable).padStart(9),
      String(r.route).padStart(6),
      String(r.matched).padStart(8),
      String(r.setOnly).padStart(9),
      String(r.nothing).padStart(10)
    );
  }

  const pct = (n: number) => `${((100 * n) / Math.max(1, tot.postable)).toFixed(1)} %`;
  console.log("\n=== TOTALT ===");
  console.log(`  Postbara i Discord             : ${tot.postable}`);
  console.log(`  …produktlänk via RUTT          : ${tot.route} (${pct(tot.route)})`);
  console.log(`  …produktlänk via TITELMATCH    : ${tot.matched} (${pct(tot.matched)})  ← nytt`);
  console.log(`  …bara setlänk ("Hos oss")      : ${tot.setOnly} (${pct(tot.setOnly)})`);
  console.log(`  …ingen länk alls (okänt set)   : ${tot.nothing} (${pct(tot.nothing)})`);

  console.log("\n=== TITELMATCHADE (stickprov 50 — GRANSKA DEM) ===");
  for (const m of matched.slice(0, 50)) {
    console.log(`  ${m.score.toFixed(3)}  ${m.store}: "${m.title}"`);
    console.log(`         → ${m.product}   /produkter/${m.slug}`);
  }
  console.log("\n=== BARA SETLÄNK (stickprov 40) ===");
  for (const u of unmatched.slice(0, 40)) {
    console.log(`  ${u.store}: "${u.title}"  [${u.set}, ${u.candidates} kandidater]`);
  }
  console.log("\n=== INGEN LÄNK ALLS (stickprov 20) ===");
  for (const n of nothing.slice(0, 20)) console.log(`  ${n.store}: "${n.title}"`);

  const dumpIdx = process.argv.indexOf("--dump");
  if (dumpIdx > 0 && process.argv[dumpIdx + 1]) {
    writeFileSync(process.argv[dumpIdx + 1], JSON.stringify({ matched, unmatched, nothing }, null, 1));
    console.log(`\n[audit] hela listan → ${process.argv[dumpIdx + 1]}`);
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
