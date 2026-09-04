/**
 * MÄTNING (rapport only): Tradera-kategorin 1001338 "Graderade kort".
 *
 * ⛔ Titeln är INTE datakällan. Tradera bär STRUKTURERADE attribut i sök-svaret:
 * `pokemon_grading_issuer`, `pokemon_grade`, `pokemon_language`, `pokemon_era`.
 * Skriptet mäter täckningen för dem och listar den observerade vokabulären.
 *
 * Kostar PAGES_ENDED + PAGES_ACTIVE sök-anrop ur Traderas dygnskvot. Skriver inget.
 */
import "dotenv/config";

const SEARCH_API = "https://api.tradera.com/v3/searchservice.asmx";
const CAT = 1001338;
const PAGES_ENDED = Number(process.env.PAGES_ENDED ?? 6);
const PAGES_ACTIVE = Number(process.env.PAGES_ACTIVE ?? 4);

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
function kr(t?: string): number | null {
  const n = t ? parseFloat(t.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function attrs(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<TermAttributeValue>([\s\S]*?)<\/TermAttributeValue>/g)) {
    const name = tag(m[1], "Name");
    const val = [...m[1].matchAll(/<string>([^<]*)<\/string>/g)]
      .map((x) => dec(x[1].trim()))
      .filter(Boolean)
      .join("+");
    if (name && val) out[name] = val;
  }
  return out;
}

interface Row {
  id: string;
  title: string;
  itemType: string;
  hasBids: boolean;
  maxBid: number | null;
  bin: number | null;
  ended: boolean;
  endDate: string;
  a: Record<string, string>;
  status: string;
}

async function page(status: "Ended" | "Active", p: number): Promise<{ rows: Row[]; total: number }> {
  const order = status === "Ended" ? "EndDateDescending" : "Relevance";
  const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SearchAdvanced xmlns="http://api.tradera.com"><request><SearchWords></SearchWords><CategoryId>${CAT}</CategoryId><SearchInDescription>false</SearchInDescription><PageNumber>${p}</PageNumber><OrderBy>${order}</OrderBy><ItemStatus>${status}</ItemStatus><ItemType>All</ItemType><ItemsPerPage>50</ItemsPerPage><CountyId>0</CountyId><OnlyAuctionsWithBuyNow>false</OnlyAuctionsWithBuyNow><OnlyItemsWithThumbnail>false</OnlyItemsWithThumbnail></request></SearchAdvanced></soap:Body></soap:Envelope>`;
  const res = await fetch(`${SEARCH_API}?appId=${process.env.TRADERA_APP_ID}&appKey=${process.env.TRADERA_APP_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"http://api.tradera.com/SearchAdvanced"` },
    body,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const total = parseInt(xml.match(/<TotalNumberOfItems>(\d+)</)?.[1] ?? "0", 10);
  const rows: Row[] = [];
  for (const m of xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)) {
    const b = m[1];
    const id = tag(b, "Id");
    const title = tag(b, "ShortDescription");
    if (!id || !title) continue;
    rows.push({
      id,
      title,
      itemType: tag(b, "ItemType") ?? "",
      hasBids: tag(b, "HasBids") === "true",
      maxBid: kr(tag(b, "MaxBid")),
      bin: kr(tag(b, "BuyItNowPrice")),
      ended: tag(b, "IsEnded") === "true",
      endDate: tag(b, "EndDate") ?? "",
      a: attrs(b),
      status,
    });
  }
  return { rows, total };
}

const pct = (n: number, t: number) => (t ? `${((n / t) * 100).toFixed(1)}%` : "-");
function med(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
}
function count(xs: Row[], f: (x: Row) => string | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = f(x) ?? "(saknas)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function push(m: Map<string, number[]>, k: string, v: number) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

async function main() {
  const all: Row[] = [];
  let calls = 0;
  let endedTotal = 0;
  let activeTotal = 0;
  for (const [status, n] of [
    ["Ended", PAGES_ENDED],
    ["Active", PAGES_ACTIVE],
  ] as const) {
    for (let p = 1; p <= n; p++) {
      const { rows, total } = await page(status, p);
      calls++;
      if (p === 1) {
        if (status === "Ended") endedTotal = total;
        else activeTotal = total;
      }
      if (!rows.length) break;
      all.push(...rows);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const ended = all.filter((r) => r.status === "Ended");
  const dates = ended.map((r) => r.endDate).filter(Boolean).sort();
  const spanH =
    dates.length > 1 ? (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 3.6e6 : 0;

  console.log(`\n=== TRADERA 1001338 "Graderade kort" ===`);
  console.log(`Sok-anrop: ${calls} | rader: ${all.length} (${ended.length} avslutade, ${all.length - ended.length} aktiva)`);
  console.log(`Kategorin: ${activeTotal} aktiva, ${endedTotal} avslutade totalt`);
  console.log(
    `Avslutade i urvalet spanner ${spanH.toFixed(1)} h => ~${Math.round((ended.length / (spanH || 1)) * 24)} avslutade/dygn\n`
  );

  console.log("--- ATTRIBUTTACKNING ---");
  for (const k of ["pokemon_grading_issuer", "pokemon_grade", "pokemon_language", "pokemon_era", "condition"]) {
    const n = all.filter((r) => r.a[k]).length;
    console.log(`  ${k.padEnd(24)} ${String(n).padStart(4)}/${all.length}  ${pct(n, all.length)}`);
  }
  const both = all.filter((r) => r.a.pokemon_grading_issuer && r.a.pokemon_grade);
  console.log(`  ${"BOLAG + BETYG bada".padEnd(24)} ${String(both.length).padStart(4)}/${all.length}  ${pct(both.length, all.length)}\n`);

  console.log("--- GRADERINGSBOLAG (attributets egen vokabular) ---");
  for (const [k, n] of count(all, (r) => r.a.pokemon_grading_issuer)) {
    console.log(`  ${k.padEnd(20)} ${String(n).padStart(4)}  ${pct(n, all.length)}`);
  }

  console.log("\n--- BETYG ---");
  for (const [k, n] of count(all, (r) => r.a.pokemon_grade).sort(
    (a, b) => (parseFloat(b[0]) || -1) - (parseFloat(a[0]) || -1)
  )) {
    console.log(`  ${k.padEnd(10)} ${String(n).padStart(4)}  ${pct(n, all.length)}`);
  }

  console.log("\n--- SPRAK ---");
  for (const [k, n] of count(all, (r) => r.a.pokemon_language)) {
    console.log(`  ${k.padEnd(20)} ${String(n).padStart(4)}  ${pct(n, all.length)}`);
  }

  const bidSold = ended.filter((r) => r.ended && r.itemType.startsWith("Auction") && r.hasBids && r.maxBid);
  const needGetItem = ended.filter((r) => r.ended && !(r.itemType.startsWith("Auction") && r.hasBids));
  console.log(`\n--- SALT-BEVIS ---`);
  console.log(`  Budbevisat salda (gratis ur sokningen): ${bidSold.length}/${ended.length}  ${pct(bidSold.length, ended.length)}`);
  console.log(`  Kraver GetItem (1 anrop/annons):        ${needGetItem.length}/${ended.length}  ${pct(needGetItem.length, ended.length)}`);

  console.log(`\n--- BUDBEVISADE SLUTPRISER PER BOLAG (kr) ---`);
  const perG = new Map<string, number[]>();
  for (const r of bidSold) push(perG, r.a.pokemon_grading_issuer ?? "(saknas)", r.maxBid!);
  for (const [g, xs] of [...perG.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(
      `  ${g.padEnd(16)} n=${String(xs.length).padStart(3)}  median ${String(med(xs)).padStart(6)}  min ${String(
        Math.min(...xs)
      ).padStart(5)}  max ${String(Math.max(...xs)).padStart(6)}`
    );
  }

  console.log(`\n--- PSA PER BETYG (budbevisat salt) ---`);
  const perGrade = new Map<string, number[]>();
  for (const r of bidSold.filter((r) => r.a.pokemon_grading_issuer === "PSA")) push(perGrade, r.a.pokemon_grade ?? "?", r.maxBid!);
  for (const [g, xs] of [...perGrade.entries()].sort((a, b) => (parseFloat(b[0]) || -1) - (parseFloat(a[0]) || -1))) {
    console.log(`  PSA ${g.padEnd(5)} n=${String(xs.length).padStart(3)}  median ${String(med(xs)).padStart(6)} kr`);
  }

  console.log(`\n--- EXEMPEL (budbevisat salda) ---`);
  for (const r of bidSold.slice(0, 18)) {
    console.log(
      `  ${String(r.maxBid).padStart(6)} kr  ${(r.a.pokemon_grading_issuer ?? "-").padEnd(10)} ${(r.a.pokemon_grade ?? "-").padEnd(4)} ${(r.a.pokemon_language ?? "-").padEnd(10)} ${r.title.slice(0, 58)}`
    );
  }

  console.log(`\n--- EXEMPEL: SAKNAR BOLAG ELLER BETYG ---`);
  for (const r of all.filter((r) => !r.a.pokemon_grading_issuer || !r.a.pokemon_grade).slice(0, 12)) {
    console.log(`  [${r.a.pokemon_grading_issuer ?? "-"}/${r.a.pokemon_grade ?? "-"}] ${r.title.slice(0, 74)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
