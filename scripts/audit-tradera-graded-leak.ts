/**
 * MÄTNING (rapport only): hur många annonser i Traderas RAW-kategorier
 * (1001337 Löskort m.fl.) är i själva verket GRADERADE kort?
 *
 * Kategori 1001338 hoppas över av båda svepen — men säljaren väljer kategori,
 * och en graderad slab som ligger i Löskort passerar `traderaCategoryCompatible`
 * (både SINGLE_CARD och GRADED_CARD mappas till gruppen "single") och kan bli
 * offer/såltpunkt på en RAW produkt.
 *
 * Kostar PAGES × antal kategorier sök-anrop. Skriver inget.
 */
import "dotenv/config";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const PAGES = Number(process.env.PAGES ?? 2);
const CATS = [
  { id: 1001337, label: "Löskort/Singles" },
  { id: 1001341, label: "Övrigt sealed" },
] as const;

function dec(t: string): string {
  return t
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function tag(b: string, n: string): string | undefined {
  const m = b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([^<]*)</${n}>`));
  const v = m ? dec(m[1].trim()) : "";
  return v || undefined;
}
function attrs(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<TermAttributeValue>([\s\S]*?)<\/TermAttributeValue>/g)) {
    const name = tag(m[1], "Name");
    const val = [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => dec(x[1].trim())).filter(Boolean).join("+");
    if (name && val) out[name] = val;
  }
  return out;
}

/** Samma signal som den kommande vakten: attribut ELLER titel. */
const TITLE_GRADED =
  /\b(psa|bgs|cgc|sgc|ace|beckett|rauk\s?card|tag\s*grad|hga|gma|isa|ags)\s*(?:gem\s*)?(?:mint\s*)?\d{1,2}(?:[.,]5)?\b|\bgraderad|\bgraded\b|\bslab\b/i;

async function page(cat: number, p: number) {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${cat}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${p}</PageNumber><OrderBy>Relevance</OrderBy><ItemStatus>Active</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${process.env.TRADERA_APP_ID}&appKey=${process.env.TRADERA_APP_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/SearchAdvanced"` },
    body,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const total = parseInt(xml.match(/<TotalNumberOfItems>(\d+)</)?.[1] ?? "0", 10);
  const rows: { title: string; bin: string | undefined; a: Record<string, string> }[] = [];
  for (const m of xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)) {
    const b = m[1];
    const title = tag(b, "ShortDescription");
    if (!title) continue;
    rows.push({ title, bin: tag(b, "BuyItNowPrice"), a: attrs(b) });
  }
  return { rows, total };
}

const pct = (n: number, t: number) => (t ? `${((n / t) * 100).toFixed(1)}%` : "-");

async function main() {
  for (const cat of CATS) {
    const rows: { title: string; bin: string | undefined; a: Record<string, string> }[] = [];
    let total = 0;
    for (let p = 1; p <= PAGES; p++) {
      const r = await page(cat.id, p);
      if (p === 1) total = r.total;
      if (!r.rows.length) break;
      rows.push(...r.rows);
      await new Promise((x) => setTimeout(x, 1000));
    }

    const byAttr = rows.filter((r) => r.a.pokemon_grading_issuer);
    const byTitle = rows.filter((r) => TITLE_GRADED.test(r.title));
    const either = rows.filter((r) => r.a.pokemon_grading_issuer || TITLE_GRADED.test(r.title));
    const onlyTitle = byTitle.filter((r) => !r.a.pokemon_grading_issuer);
    const onlyAttr = byAttr.filter((r) => !TITLE_GRADED.test(r.title));
    const buyable = either.filter((r) => r.bin);

    console.log(`\n=== KATEGORI ${cat.id} ${cat.label} (${total} aktiva totalt) ===`);
    console.log(`  urval: ${rows.length} annonser`);
    console.log(`  GRADERAD enligt attribut:      ${String(byAttr.length).padStart(3)}  ${pct(byAttr.length, rows.length)}`);
    console.log(`  GRADERAD enligt titel:         ${String(byTitle.length).padStart(3)}  ${pct(byTitle.length, rows.length)}`);
    console.log(`  GRADERAD enligt någondera:     ${String(either.length).padStart(3)}  ${pct(either.length, rows.length)}`);
    console.log(`    varav BARA titeln ser den:   ${String(onlyTitle.length).padStart(3)}`);
    console.log(`    varav BARA attributet:       ${String(onlyAttr.length).padStart(3)}`);
    console.log(`  ...med Köp nu-pris (blir offer): ${String(buyable.length).padStart(3)}  ${pct(buyable.length, rows.length)}`);

    const issuers = new Map<string, number>();
    for (const r of byAttr) issuers.set(r.a.pokemon_grading_issuer, (issuers.get(r.a.pokemon_grading_issuer) ?? 0) + 1);
    if (issuers.size) console.log(`  bolag: ${[...issuers.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

    console.log(`  EXEMPEL:`);
    for (const r of either.slice(0, 10)) {
      console.log(
        `    [${(r.a.pokemon_grading_issuer ?? "-").padEnd(8)}/${(r.a.pokemon_grade ?? "-").padEnd(4)}] ${r.bin ? String(r.bin).padStart(5) + " kr" : "  auktion"}  ${r.title.slice(0, 62)}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
