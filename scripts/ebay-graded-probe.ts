/**
 * SOND: en eBay Browse-sökning, noll DB. För att verifiera nycklar, aspektfilter
 * och vad bucketaren gör med riktiga titlar innan svepet slås på.
 *
 *   npx tsx scripts/ebay-graded-probe.ts "Charizard ex 199" [EN|JP] [nummer]
 *
 * Env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (+ EBAY_ENV=sandbox för sandlådan,
 *      EBAY_DELIVERY_COUNTRY="" för att stänga av leveransfiltret).
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { ebayClientFromEnv } from "../src/lib/ebay-browse";
import { bucketGradedAsks } from "../src/lib/graded-ask";

(async () => {
  const query = process.argv[2];
  if (!query) {
    console.error('Användning: npx tsx scripts/ebay-graded-probe.ts "Charizard ex 199" [EN|JP] [nummer]');
    process.exit(1);
  }
  const language = (process.argv[3] === "JP" ? "JP" : "EN") as "EN" | "JP";
  const number = process.argv[4] ?? query.trim().split(/\s+/).pop()!;
  const name = process.argv[4] ? query : query.replace(/\s+\S+$/, "");

  const client = ebayClientFromEnv();
  if (!client) {
    console.error("EBAY_CLIENT_ID/EBAY_CLIENT_SECRET saknas.");
    process.exit(1);
  }
  const items = await client.searchGraded(query);
  console.log(`${items.length} träffar för "${query}":`);
  for (const it of items.slice(0, 40)) {
    console.log(`  ${it.price?.value} ${it.price?.currency}  ${it.buyingOptions?.join("/")}  ${it.title}`);
  }
  const buckets = bucketGradedAsks(items, {
    id: "probe",
    language,
    variantLabel: null,
    card: { name, number, set: { name: "" } },
  });
  console.log(`\n${buckets.length} grupper efter vakterna (produkt "${name}" nr ${number}, ${language}):`);
  for (const b of buckets.sort((a, b) => b.gradeTenths - a.gradeTenths)) {
    console.log(`  ${b.issuer} ${b.gradeTenths / 10}: ${b.amount} ${b.currency} (${b.listingCount} st) — ${b.title}`);
  }
})();
