/**
 * TRADERA FAS 2-SOND — verifierar GetSellerItems-kontraktet mot LIVE Tradera.
 *
 *   npx tsx scripts/tradera-seller-items-probe.ts
 *   npx tsx scripts/tradera-seller-items-probe.ts --seller 123456   (hoppa över söksteget)
 *
 * TVÅ Tradera-anrop, NOLL Neon (importerar svepets rena hjälpare; Prisma-klienten
 * skapas men frågas aldrig):
 *   1. SearchService.SearchAdvanced (pokemon, Löskort, fastpris, sida 1) → säljar-id:n
 *   2. PublicService.GetSellerItems(top-säljaren) med SAMMA kuvert som Fas 2
 *      (categoryId=0, Active, All) → hur många block parsern ser, ItemType-
 *      fördelningen i råsvaret, hur många som ligger i Pokémon-trädet och hur
 *      många som filtreras bort. `--type PureBuyItNow|ShopItem|Auction` byter
 *      filtret i kuvertet för att mäta vad Tradera tappar.
 *
 * VARFÖR: Fas 2 loggade "+0 nya" varje natt (kategori-id i kuvertet, fel
 * blockform i parsern OCH PureBuyItNow-filtret som tappar butikernas ShopItem —
 * se .claude/rules/marketplace-tradera.md). Sonden är facit när den raden ser
 * fel ut igen — sweep-loggen svarar först nästa natt, det här på sekunder.
 */
import "dotenv/config";
import {
  buildGetSellerItemsBody,
  isPokemonListingCategory,
  parseItemsFromXml,
} from "../src/jobs/tradera-sweep";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const PUBLIC_API = "https://api.tradera.com/v3/publicservice.asmx";

const strip = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const appId = strip(process.env.TRADERA_APP_ID ?? "");
const appKey = strip(process.env.TRADERA_APP_KEY ?? "");

async function call(endpoint: string, action: string, body: string): Promise<string> {
  const res = await fetch(`${endpoint}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/${action}"` },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const xml = await res.text();
  const fault = xml.match(/<faultstring>([^<]*)</)?.[1];
  if (fault) throw new Error(`SOAP-fel: ${fault.slice(0, 200)}`);
  return xml;
}

async function main() {
  if (!appId || !appKey) {
    console.error("TRADERA_APP_ID/TRADERA_APP_KEY saknas i miljön.");
    process.exitCode = 1;
    return;
  }

  const argIdx = process.argv.indexOf("--seller");
  let sellerId = argIdx >= 0 ? Number.parseInt(process.argv[argIdx + 1] ?? "", 10) : NaN;

  if (!Number.isFinite(sellerId)) {
    // SearchAdvanced med ItemType=BuyItNow (samma form som svepets SS.SearchAdvanced)
    // så toppsäljaren är en FASTPRIS-säljare — det är dem Fas 2 ska hitta mer hos.
    const xml = await call(
      SEARCH_API, "SearchAdvanced",
      `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>pokemon</SearchWords><CategoryId>1001337</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>1</PageNumber><OrderBy>PriceAscending</OrderBy><ItemStatus>Active</ItemStatus><ItemType>BuyItNow</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`
    );
    // Säljar-id:n ur RÅ-XML:en — sida 1 i PriceAscending är ofta bara auktioner
    // (BuyItNowPrice nil), som parsern med rätta hoppar över.
    const { items } = parseItemsFromXml(xml);
    const counts = new Map<number, number>();
    for (const m of xml.matchAll(/<SellerId>(\d+)<\/SellerId>/g)) {
      const id = Number.parseInt(m[1], 10);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(
      `1. Search: ${counts.size} säljare på sidan (${items.length} fastpris-träffar)` +
        (top ? `, topp = ${top[0]} (${top[1]} annonser)` : "")
    );
    if (!top) {
      console.error("Ingen säljare i sökträffarna — kan inte fortsätta. Svarets början:");
      console.error(xml.slice(0, 600).replace(/\s+/g, " "));
      process.exitCode = 2;
      return;
    }
    sellerId = top[0];
  }

  const typeIdx = process.argv.indexOf("--type");
  const itemType = typeIdx >= 0 ? process.argv[typeIdx + 1] ?? "All" : "All";
  const body = buildGetSellerItemsBody(appId, appKey, sellerId).replace(
    "<trad:filterItemType>All</trad:filterItemType>",
    `<trad:filterItemType>${itemType}</trad:filterItemType>`
  );
  const xml = await call(PUBLIC_API, "GetSellerItems", body);
  if (process.argv.includes("--dump")) console.log("   rått:", xml.slice(0, 900).replace(/\s+/g, " "));
  const rawItemBlocks = (xml.match(/<Item>/g) ?? []).length;
  const rawItemsBlocks = (xml.match(/<Items>/g) ?? []).length;
  const { items } = parseItemsFromXml(xml);

  // Fördelning i RÅ-svaret: vilken ItemType bär säljarens fastpris-annonser, och
  // hur många har ett BuyItNowPrice > 0 / bud? Avgör om PureBuyItNow-filtret i
  // kuvertet tappar ShopItem/auktioner-med-köp-nu.
  const typeDist = new Map<string, { n: number; bin: number; bids: number }>();
  for (const m of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const b = m[1];
    const t = b.match(/<ItemType>([^<]*)<\/ItemType>/)?.[1] ?? "?";
    const bin = Number.parseInt(b.match(/<BuyItNowPrice>([^<]*)<\/BuyItNowPrice>/)?.[1] ?? "0", 10) || 0;
    const bids = Number.parseInt(b.match(/<TotalBids>([^<]*)<\/TotalBids>/)?.[1] ?? "0", 10) || 0;
    const e = typeDist.get(t) ?? { n: 0, bin: 0, bids: 0 };
    e.n++;
    if (bin > 0) e.bin++;
    if (bids > 0) e.bids++;
    typeDist.set(t, e);
  }
  if (typeDist.size > 0) console.log("   ItemType-fördelning (n / med BuyItNowPrice>0 / med bud):", Object.fromEntries(typeDist));
  const pokemon = items.filter((i) => isPokemonListingCategory(i.categoryId));
  const byCat = new Map<string, number>();
  for (const it of items) {
    const k = String(it.categoryId ?? "okänd");
    byCat.set(k, (byCat.get(k) ?? 0) + 1);
  }
  console.log(
    `2. GetSellerItems(${sellerId}, categoryId=0, ${itemType}): ${xml.length} B, ` +
      `<Item>-block ${rawItemBlocks}, <Items>-block ${rawItemsBlocks}, parsade ${items.length}, ` +
      `Pokémon ${pokemon.length}, utanför ${items.length - pokemon.length}`
  );
  console.log("   per kategori:", Object.fromEntries([...byCat.entries()].sort((a, b) => b[1] - a[1])));
  if (pokemon[0]) {
    const p = pokemon[0];
    console.log(`   exempel: ${p.itemId} "${p.title}" ${p.priceOre / 100} kr ${p.url}`);
  }
  process.exitCode = items.length > 0 ? 0 : 3;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
