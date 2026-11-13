/**
 * TRADERA × ONE PIECE — dumpar kategorins AKTIVA annonser till tradera-op-listings.json (artefakt).
 * Underlag för att bygga och handgranska One Piece-matcharen FÖRE något skrivs. Ingen databas.
 * Körs i Actions (tradera-probe.yml). ~140 sökanrop.
 */
import { writeFileSync } from "node:fs";
export {};
const appId = process.env.TRADERA_APP_ID ?? "";
const appKey = process.env.TRADERA_APP_KEY ?? "";
if (!appId || !appKey) { console.error("TRADERA_APP_ID/TRADERA_APP_KEY saknas."); process.exit(1); }
const SEARCH = "https://api.tradera.com/v3/searchservice.asmx";
const CATEGORY = 1001268;

async function page(n: number): Promise<string> {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${CATEGORY}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${n}</PageNumber><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/SearchAdvanced"` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.text();
}
const tag = (b: string, t: string) => b.match(new RegExp("<" + t + ">([^<]*)</" + t + ">"))?.[1] ?? "";

async function main() {
  const out: Record<string, string | number>[] = [];
  let total = 1;
  const attrs = new Map<string, number>();
  let rawSample = "";
  for (let n = 1; n <= Math.min(total, 200); n++) {
    const xml = await page(n);
    total = Number(xml.match(/<TotalNumberOfPages>([0-9]+)<\/TotalNumberOfPages>/)?.[1] ?? 1);
    const items = xml.split("<Items>").slice(1).map((s) => s.split("</Items>")[0]);
    if (items.length === 0) break;
    for (const b of items) {
      // Strukturerade attribut (språk?) — Pokémon-kategorierna bär `pokemon_language`.
      for (const m of b.matchAll(/<Name>([^<]+)<\/Name>([\s\S]*?)<\/TermAttributeValues>/g)) {
        const values = [...m[2].matchAll(/>([^<>]+)</g)].map((x) => x[1].trim()).filter(Boolean);
        for (const v of values.length ? values : ["(tomt)"]) {
          const k = `${m[1]} = ${v}`;
          attrs.set(k, (attrs.get(k) ?? 0) + 1);
        }
      }
      if (b.includes("AttributeValues") && !rawSample) rawSample = b.slice(0, 3000);
      out.push({
        attrs: [...b.matchAll(/<Name>([^<]+)<\/Name>([\s\S]*?)<\/TermAttributeValues>/g)]
          .map((m) => `${m[1]}=${[...m[2].matchAll(/>([^<>]+)</g)].map((x) => x[1].trim()).filter(Boolean).join("|")}`).join(";"),
        itemId: tag(b, "Id"), title: tag(b, "ShortDescription"), type: tag(b, "ItemType"),
        buyNow: Number(tag(b, "BuyItNowPrice") || 0), maxBid: Number(tag(b, "MaxBid") || 0),
        seller: tag(b, "SellerId"), url: tag(b, "ItemUrl"), image: tag(b, "ThumbnailLink"),
      });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  writeFileSync("tradera-op-listings.json", JSON.stringify(out));
  const types = new Map<string, number>();
  for (const o of out) types.set(String(o.type), (types.get(String(o.type)) ?? 0) + 1);
  console.log("Attribut (namn = värde → antal):");
  for (const [k, n] of [...attrs].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`  ${n}\t${k}`);
  console.log("Rått exempel:\n" + rawSample);
  console.log(`${out.length} annonser på ${total} sidor. Typer:`, Object.fromEntries(types));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
