/**
 * MÄTNING: håller köpknapps-detektorn (purchasableFromShopifyPage) mot varje
 * Shopify-butiks feed?
 *
 *   npx tsx scripts/probe-shopify-buy-button.ts <feeds.json> [--sample=3] [--store=Namn]
 *
 * VARFÖR MÄTA FÖRST: detektorn läser butikens TEMA, och teman skiljer sig. Ett tema som
 * alltid renderar knappen `disabled` och aktiverar den med JS hade fått hela butiken att
 * se slutsåld ut — dvs exakt Webhallen-misstaget 2026-08-14 (en vakt byggd på ett fält
 * som lät självklart, som stängde av äkta larm) i ny förklädnad. Regeln är därför:
 * detektorn får bara användas för butiker där den MÄTT stämmer med feeden.
 *
 * Läser kandidaterna ur feed-dumpen (dump-store-feeds.ts) så butikernas kollektions-API
 * inte behöver hämtas igen — bara N produktsidor per butik, sekventiellt med paus.
 *
 * TOLKNING:
 *   överens        → detektorn ser samma sak som feeden
 *   feed=i lager, sida=EJ köpbar → KANDIDAT till buggen (Kortarkivet-fallet)
 *   feed=slut, sida=köpbar       → detektorn är opålitlig för butiken (feeden släpar,
 *                                  eller temat renderar alltid en aktiv knapp)
 *   obestämbar     → detektorn avstår (flera formulär, inget variant-id)
 */
import { readFileSync } from "node:fs";
import { purchasableFromShopifyPage } from "../src/scrapers/stock-verify";

const feedFile = process.argv[2];
const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.slice("--sample=".length) ?? 3);
const onlyStore = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const PAUSE_MS = 900;

const HEADERS = {
  cookie: "localization=SE",
  "accept-language": "sv-SE",
  "user-agent": "FoilioBot/1.0 (+https://foilio.se/bot)",
};

interface Dump {
  groups: { sourceName: string; items: { url: string; title: string; stockStatus: string }[] }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function variantIdFrom(url: string): number | null {
  try {
    const v = new URL(url).searchParams.get("variant");
    return v && /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
}

async function main() {
  const dump = JSON.parse(readFileSync(feedFile, "utf8")) as Dump;
  const rows: { store: string; ok: number; bug: number; unreliable: number; unknown: number; notes: string[] }[] = [];

  for (const g of dump.groups) {
    if (onlyStore && g.sourceName !== onlyStore) continue;
    // Bara Shopify-butiker: deras annons-URL:er innehåller /products/.
    const shopify = g.items.filter((i) => /\/products\//.test(i.url));
    if (shopify.length < 4) continue;

    const inStock = shopify.filter((i) => i.stockStatus === "IN_STOCK").slice(0, sample);
    const outOfStock = shopify.filter((i) => i.stockStatus === "OUT_OF_STOCK").slice(0, sample);
    if (!inStock.length && !outOfStock.length) continue;

    const row = { store: g.sourceName, ok: 0, bug: 0, unreliable: 0, unknown: 0, notes: [] as string[] };
    for (const it of [...inStock, ...outOfStock]) {
      let verdict: boolean | null = null;
      try {
        const res = await fetch(it.url, { headers: HEADERS });
        if (res.ok) verdict = purchasableFromShopifyPage(await res.text(), variantIdFrom(it.url));
        else row.notes.push(`HTTP ${res.status} ${it.title.slice(0, 50)}`);
      } catch (e) {
        row.notes.push(`fel: ${e instanceof Error ? e.message : String(e)}`);
      }
      const feedInStock = it.stockStatus === "IN_STOCK";
      if (verdict === null) row.unknown++;
      else if (verdict === feedInStock) row.ok++;
      else if (feedInStock) {
        row.bug++;
        row.notes.push(`⛔ feed=i lager, sida=EJ köpbar: ${it.title.slice(0, 70)}`);
      } else {
        row.unreliable++;
        row.notes.push(`⚠️ feed=slut, sida=KÖPBAR: ${it.title.slice(0, 70)}`);
      }
      await sleep(PAUSE_MS);
    }
    rows.push(row);
    console.log(
      `${row.store.padEnd(22)} överens ${String(row.ok).padStart(2)}  ` +
        `bug-kandidat ${String(row.bug).padStart(2)}  opålitlig ${String(row.unreliable).padStart(2)}  ` +
        `obestämbar ${String(row.unknown).padStart(2)}`
    );
    for (const n of row.notes) console.log(`      ${n}`);
  }

  console.log("\n=== SLUTSATS ===");
  const usable = rows.filter((r) => r.unreliable === 0 && r.ok > 0);
  const risky = rows.filter((r) => r.unreliable > 0);
  console.log(`Detektorn är ANVÄNDBAR för ${usable.length} butiker: ${usable.map((r) => r.store).join(", ")}`);
  if (risky.length) {
    console.log(
      `⚠️ OPÅLITLIG för ${risky.length}: ${risky.map((r) => `${r.store}(${r.unreliable})`).join(", ")} ` +
        `— temat eller feeden motsäger varandra, använd inte detektorn där.`
    );
  }
  const buggy = rows.filter((r) => r.bug > 0);
  if (buggy.length) {
    console.log(`⛔ FALSKT "I LAGER" HITTAT hos: ${buggy.map((r) => `${r.store}(${r.bug})`).join(", ")}`);
  }
}

main();
