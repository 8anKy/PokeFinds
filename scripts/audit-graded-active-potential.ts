/**
 * MÄTNING (rapport only): hur många KATALOGPRODUKTER skulle få en graderad
 * prisrad om vi också tog med AKTIVA annonser (begärt pris), inte bara sålda?
 *
 * Bakgrund: sålt-lanen ser ~128 avslutade annonser/dygn i kategori 1001338 och
 * byggs FRAMÅT — den gav 81 produkter dag ett. Men kategorin har ~3 800 AKTIVA
 * annonser LIGGANDE just nu, och Traderas graderingsattribut sitter på dem också.
 * Det är alltså en beståndsmängd, inte ett flöde — den finns tillgänglig direkt.
 *
 * ⛔ ETT UTROPSPRIS ÄR INTE ETT SLUTPRIS. Skriptet mäter TÄCKNING, inte att vi
 * ska visa talen som "marknadspris". Samma skäl som håller "Tradera sålt" skild
 * från annonskurvan gäller en nivå djupare här.
 *
 * Kostar PAGES sök-anrop. Skriver inget.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { matchProduct } from "../src/scrapers/matching";
import { detectGrading } from "../src/lib/graded-listing";
import { isBlockedListingLanguage } from "../src/lib/listing-language";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const CAT = 1001338;
const PAGES = Number(process.env.PAGES ?? 8);

function dec(t: string): string {
  return t.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function tag(b: string, n: string): string | undefined {
  const m = b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([^<]*)</${n}>`));
  const v = m ? dec(m[1].trim()) : "";
  return v || undefined;
}
function attrOf(block: string, name: string): string | undefined {
  for (const m of block.matchAll(/<TermAttributeValue>([\s\S]*?)<\/TermAttributeValue>/g)) {
    if (tag(m[1], "Name") !== name) continue;
    const v = [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => dec(x[1].trim())).filter(Boolean)[0];
    if (v) return v;
  }
  return undefined;
}

async function page(p: number) {
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${CAT}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${p}</PageNumber><OrderBy>Relevance</OrderBy><ItemStatus>Active</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${process.env.TRADERA_APP_ID}&appKey=${process.env.TRADERA_APP_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/SearchAdvanced"` },
    body,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const total = parseInt(xml.match(/<TotalNumberOfItems>(\d+)</)?.[1] ?? "0", 10);
  const rows: { title: string; url: string; issuer?: string; grade?: string }[] = [];
  for (const m of xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)) {
    const b = m[1];
    const title = tag(b, "ShortDescription");
    const id = tag(b, "Id");
    if (!title || !id) continue;
    const raw = tag(b, "ItemUrl") ?? tag(b, "ItemLink");
    const url = raw && /tradera\.com\/item\//.test(raw) ? raw.replace(/^http:\/\//, "https://") : `https://www.tradera.com/item/0/${id}/`;
    rows.push({ title, url, issuer: attrOf(b, "pokemon_grading_issuer"), grade: attrOf(b, "pokemon_grade") });
  }
  return { rows, total };
}

async function main() {
  const rows: { title: string; url: string; issuer?: string; grade?: string }[] = [];
  let total = 0;
  for (let p = 1; p <= PAGES; p++) {
    const r = await page(p);
    if (p === 1) total = r.total;
    if (!r.rows.length) break;
    rows.push(...r.rows);
    await new Promise((x) => setTimeout(x, 1000));
  }

  const graded = rows.filter((r) => detectGrading({ title: r.title, attrIssuer: r.issuer, attrGrade: r.grade }));
  const langOk = graded.filter((r) => !isBlockedListingLanguage(r.title, r.url));

  const products = new Set<string>();
  const issuers = new Map<string, number>();
  let matchedRows = 0;
  for (const r of langOk) {
    const g = detectGrading({ title: r.title, attrIssuer: r.issuer, attrGrade: r.grade })!;
    issuers.set(g.issuer, (issuers.get(g.issuer) ?? 0) + 1);
    const m = await matchProduct(normalizeTitle(r.title));
    if (!m) continue;
    matchedRows++;
    products.add(m.productId);
  }

  const pct = (n: number, t: number) => (t ? `${((n / t) * 100).toFixed(1)} %` : "-");
  console.log(`\n=== AKTIVA GRADERADE ANNONSER (kategori ${CAT}) ===`);
  console.log(`Kategorin har ${total} aktiva annonser totalt`);
  console.log(`Urval: ${rows.length} annonser (${PAGES} sidor)`);
  console.log(`  graderade enligt vakten:      ${graded.length}  ${pct(graded.length, rows.length)}`);
  console.log(`  efter språkvakten:            ${langOk.length}`);
  console.log(`  MATCHADE mot katalogen:       ${matchedRows}  ${pct(matchedRows, langOk.length)} av de graderade`);
  console.log(`  DISTINKTA produkter i urvalet: ${products.size}`);
  console.log(`\nBolag i urvalet: ${[...issuers.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  // Extrapolering till hela beståndet — TYDLIGT märkt som en uppskattning.
  if (rows.length) {
    const perListing = products.size / rows.length;
    console.log(
      `\n≈ UPPSKATTNING (linjär, INTE mätt): hela beståndet ${total} aktiva ⇒ ~${Math.round(
        total * perListing
      )} produkter med minst en graderad annons (färre i praktiken — samma kort återkommer).`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
