/**
 * Fyll `Offer.cartUrl` för en butik NU, utan att vänta på nattkedjan.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-cart-urls.ts "MaxGaming" "Swepoke" --apply
 *
 * Läser butikens feed via dess adapter (samma kod som nattkedjan), matchar på offerns
 * URL och skriver BARA `cartUrl` — pris, lager och lastSeenAt rörs inte (det är
 * nattkedjans/hitarnas jobb, och en lagerdiff här hade kunnat larma). Utan --apply
 * bara rapport. Skrevs 2026-09-18 när Quickbutik + MaxGaming fick korglänkar.
 */
import { SourceType } from "@prisma/client";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";
import { fetchWatchedListing } from "../src/scrapers/watched-listing";
import { exitJob } from "../src/lib/job-exit";

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const names = args.filter((a) => !a.startsWith("--"));
  if (names.length === 0) throw new Error("Ange minst ett butiksnamn (ScrapeSource.name).");
  await ensureDbAwake();
  for (const name of names) {
    const retailer = await prisma.retailer.findUnique({ where: { name }, select: { id: true } });
    if (!retailer) {
      console.log(`${name}: ingen Retailer med det namnet — hoppar`);
      continue;
    }
    const adapter = getAdapter(SourceType.SCRAPER, name);
    const feed = await adapter.fetchProducts();
    const byUrl = new Map<string, string>();
    for (const p of feed.products) if (p.cartUrl) byUrl.set(norm(p.url), p.cartUrl);
    // Bevakade länkar (WatchedListing) står utanför feeden — fråga dem som lanen gör.
    const watched = await prisma.watchedListing.findMany({
      where: { retailerId: retailer.id, isActive: true },
      select: { url: true },
    });
    let watchedHits = 0;
    for (const w of watched) {
      if (byUrl.has(norm(w.url))) continue;
      const { item } = await fetchWatchedListing(name, w.url);
      if (item?.cartUrl) {
        byUrl.set(norm(w.url), item.cartUrl);
        watchedHits++;
      }
    }
    const offers = await prisma.offer.findMany({
      where: { retailerId: retailer.id },
      select: { id: true, url: true, cartUrl: true },
    });
    let changed = 0;
    let unmatched = 0;
    for (const o of offers) {
      const next = byUrl.get(norm(o.url));
      if (!next) {
        unmatched++;
        continue;
      }
      if (o.cartUrl === next) continue;
      changed++;
      if (apply) await prisma.offer.update({ where: { id: o.id }, data: { cartUrl: next } });
    }
    console.log(
      `${name}: feed ${feed.products.length} + bevakade ${watchedHits}/${watched.length} (${byUrl.size} med korglänk), offers ${offers.length}, ` +
        `${apply ? "skrev" : "skulle skriva"} ${changed}, utan feedträff ${unmatched}` +
        (feed.errors.length ? ` — fel: ${feed.errors.join("; ")}` : "")
    );
  }
}

main()
  .then(() => exitJob(0))
  .catch(async (e) => {
    console.error(e);
    await exitJob(1);
  });
