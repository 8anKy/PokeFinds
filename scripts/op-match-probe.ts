/**
 * Butikernas One Piece-annonser → One Piece-matcharen (lib/one-piece-listing) mot prod-katalogen.
 * Läser bara (butikernas feedar + Product/CardSet), skriver ingenting. Setkoderna hämtas ur
 * leverantören (~5 anrop) så proben fungerar även innan CardSet.code är ifylld.
 *
 *   railway run npx tsx scripts/op-match-probe.ts                       (standardbutikerna)
 *   railway run npx tsx scripts/op-match-probe.ts "Sweet Nerds,Kortarkivet"
 */
import { SourceType } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";
import { isOnePieceListing, isAsianOnePieceListing, matchOnePieceListing } from "../src/lib/one-piece-listing";
import { exitJob } from "../src/lib/job-exit";
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY!;
(async () => {
  const codeByName = new Map<string, string>();
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`https://${HOST}/one-piece/episodes?page=${p}`, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
    for (const e of ((await r.json()).data ?? []) as { name: string; code: string | null }[]) if (e.code) codeByName.set(e.name, e.code);
  }
  const sets = (await prisma.cardSet.findMany({ where: { game: "ONE_PIECE" }, select: { id: true, name: true } })).map((s) => ({ ...s, code: codeByName.get(s.name) ?? null }));
  const products = await prisma.product.findMany({ where: { game: "ONE_PIECE" }, select: { id: true, title: true, setId: true } });
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  const shops = (process.argv[2] ?? "Kortarkivet,Speltrollet,Yonko TCG,MaxGaming,Spelexperten,Swepoke,Sweet Nerds,Card Club,Firegames").split(",");
  let tot = 0, en = 0, hit = 0;
  for (const name of shops) {
    try {
      const a = getAdapter(SourceType.SCRAPER, name);
      const { products: feed, errors } = await a.fetchProducts();
      const op = feed.filter((f) => isOnePieceListing(f.title, f.url));
      const eng = op.filter((f) => !isAsianOnePieceListing(f.title));
      const matched = eng.map((f) => ({ f, id: matchOnePieceListing(f.title, { sets, products }) }));
      tot += op.length; en += eng.length; hit += matched.filter((m) => m.id).length;
      console.log(`\n== ${name}: ${feed.length} annonser, ${op.length} One Piece, ${eng.length} engelska, ${matched.filter((m) => m.id).length} matchade${errors.length ? ` (fel: ${errors[0]})` : ""}`);
      for (const m of matched.slice(0, 14)) console.log(`  ${m.id ? "✓" : "·"} ${m.f.title}${m.id ? `  →  ${titleById.get(m.id)}` : ""}`);
    } catch (e) { console.log(`== ${name}: FEL ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`\nTOTALT: ${tot} One Piece-annonser, ${en} engelska, ${hit} matchade`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => exitJob());
