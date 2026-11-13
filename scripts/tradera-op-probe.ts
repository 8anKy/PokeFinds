/**
 * TRADERA × ONE PIECE — mätning FÖRE bygge. Rapport, aldrig skrivning; ingen databas.
 * Körs i Actions (tradera-probe.yml): de lokala Tradera-nycklarna är roterade sedan 2026-10-22.
 * Svarar på: finns en egen One Piece-kategori, hur många aktiva/avslutade annonser, hur ser titlarna ut?
 * ~10 anrop mot Tradera.
 */
export {}; // modul, inte globalt skript (annars krockar main() med andra sonder i tsc)
const appId = process.env.TRADERA_APP_ID ?? "";
const appKey = process.env.TRADERA_APP_KEY ?? "";
if (!appId || !appKey) { console.error("TRADERA_APP_ID/TRADERA_APP_KEY saknas."); process.exit(1); }
const SEARCH = "https://api.tradera.com/v3/searchservice.asmx";
const PUBLIC = "https://api.tradera.com/v3/publicservice.asmx";

async function call(endpoint: string, body: string, action: string): Promise<string> {
  const res = await fetch(`${endpoint}?appId=${appId}&appKey=${appKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/${action}"` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${action} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.text();
}
const adv = (words: string, cat: number, status: "Active" | "Ended", page = 1) =>
  call(
    SEARCH,
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords>${words}</SearchWords><CategoryId>${cat}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${page}</PageNumber><OrderBy>Relevance</OrderBy><ItemStatus>${status}</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`,
    "SearchAdvanced"
  );
const num = (xml: string, tag: string) => Number(xml.match(new RegExp(String.raw`<${tag}>(\d+)</${tag}>`))?.[1] ?? -1);
const blocks = (xml: string) => [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
const field = (b: string, tag: string) => b.match(new RegExp(String.raw`<${tag}>([\s\S]*?)</${tag}>`))?.[1] ?? "";

async function main() {
  const tree = await call(
    PUBLIC,
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trad="http://api.tradera.com"><soap:Header><trad:AuthenticationHeader><trad:AppId>${appId}</trad:AppId><trad:AppKey>${appKey}</trad:AppKey></trad:AuthenticationHeader><trad:ConfigurationHeader><trad:Sandbox>0</trad:Sandbox><trad:MaxResultAge>0</trad:MaxResultAge></trad:ConfigurationHeader></soap:Header><soap:Body><trad:GetCategories/></soap:Body></soap:Envelope>`,
    "GetCategories"
  );
  const nodes = [...tree.matchAll(/<Category Id="(\d+)" Name="([^"]*)"/g)].map((m) => ({ id: m[1], name: m[2] }));
  console.log(`Kategorier: ${nodes.length}`);
  const pk = nodes.findIndex((n) => n.id === "1001337");
  if (pk >= 0) console.log("Runt Pokémon-löskort:\n  " + nodes.slice(Math.max(0, pk - 15), pk + 40).map((n) => `${n.id} ${n.name}`).join("\n  "));
  const opCats = nodes.filter((n) => /one\s*piece/i.test(n.name));
  console.log("Kategorier med 'One Piece' i namnet:", opCats.length ? opCats.map((n) => `${n.id} ${n.name}`).join(" | ") : "INGA");

  const catName = new Map(nodes.map((n) => [n.id, n.name]));
  for (const status of ["Active", "Ended"] as const) {
    const x = await adv("one piece", 0, status);
    const bs = blocks(x);
    const perCat = new Map<string, number>();
    for (const b of bs) { const c = field(b, "CategoryId"); perCat.set(c, (perCat.get(c) ?? 0) + 1); }
    console.log(`\n=== ${status} "one piece", alla kategorier: ${num(x, "TotalNumberOfItems")} annonser (${num(x, "TotalNumberOfPages")} sidor)`);
    console.log("Kategorier på sida 1:", [...perCat].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${catName.get(c) ?? "?"} ×${n}`).join(" | "));
    for (const b of bs.slice(0, 40)) console.log(`  [${field(b, "CategoryId")}] ${field(b, "ShortDescription")} — ${field(b, "BuyItNowPrice") || field(b, "MaxBid")} kr (${field(b, "ItemType")})`);
  }
  // Egen kategori ⇒ mät den utan sökord (så svepen skulle köra), aktiva + avslutade.
  for (const c of opCats.slice(0, 6)) {
    for (const status of ["Active", "Ended"] as const) {
      const x = await adv("", Number(c.id), status);
      console.log(`\n=== ${status} i kategori ${c.id} ${c.name} (utan sökord): ${num(x, "TotalNumberOfItems")} annonser`);
      for (const b of blocks(x).slice(0, 25)) console.log(`  ${field(b, "ShortDescription")} — ${field(b, "BuyItNowPrice") || field(b, "MaxBid")} kr (${field(b, "ItemType")})`);
    }
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
