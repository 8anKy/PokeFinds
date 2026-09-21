/**
 * NÄR UPPDATERAR LEVERANTÖREN SINA CARDMARKET-PRISER? — mätsond (2026-09-22).
 *
 * Docs säger bara "refreshed multiple times daily"; svaret bär ingen tidsstämpel och
 * inga cache-headers. Enda vägen är att mäta: ta samma 60 singlar + 20 sealed vid olika
 * klockslag och se NÄR talen byter. Varje körning = 4 RapidAPI-anrop, skriver
 * `.cm-freshness/<ISO-tid>.json` (gitignorerad) och diffar mot alla tidigare körningar.
 *
 * Frågan avgör om cardmarket-refresh kan flyttas till natten (memory
 * `cardmarket-refresh-night-run-parked`): byter talen t.ex. 10:00 UTC stämplar en
 * 02:00-körning gårdagens priser med dagens datum.
 *
 *   npx tsx scripts/probe-cm-freshness.ts         # en mätpunkt + diff mot tidigare
 *   npx tsx scripts/probe-cm-freshness.ts --diff  # bara diff, inga anrop
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const DIR = path.resolve(".cm-freshness");
const EPISODE = 431; // 30th Celebration — nytt, livlig handel ⇒ talen rör sig varje dag
const PAGES = [1, 2, 3];

type Snap = Record<string, { low: number | null; avail: number | null }>;

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

async function take(): Promise<Snap> {
  const snap: Snap = {};
  for (const page of PAGES) {
    const d = await api<{ data: { id: number; name_numbered: string; prices: { cardmarket?: { lowest_near_mint?: number; available_items?: number } } }[] }>(
      `https://${HOST}/pokemon/episodes/${EPISODE}/cards?page=${page}`
    );
    for (const c of d.data) {
      const cm = c.prices?.cardmarket;
      snap[`single:${c.id} ${c.name_numbered}`] = { low: cm?.lowest_near_mint ?? null, avail: cm?.available_items ?? null };
    }
  }
  const p = await api<{ data: { id: number; name: string; prices: { cardmarket?: { lowest?: number; available_items?: number } } }[] }>(
    `https://${HOST}/pokemon/products?page=1`
  );
  for (const s of p.data) {
    const cm = s.prices?.cardmarket;
    snap[`sealed:${s.id} ${s.name}`] = { low: cm?.lowest ?? null, avail: cm?.available_items ?? null };
  }
  return snap;
}

function load(): { at: string; snap: Snap }[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ at: f.replace(".json", ""), snap: JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Snap }));
}

function report(runs: { at: string; snap: Snap }[]) {
  if (runs.length < 2) {
    console.log(`${runs.length} mätpunkt(er) — kör igen vid ett annat klockslag för att se när talen byter.`);
    return;
  }
  console.log("\nÄndrade rader mellan på varandra följande mätpunkter (UTC):");
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1], b = runs[i];
    const keys = Object.keys(b.snap);
    const changed = keys.filter((k) => a.snap[k] && (a.snap[k].low !== b.snap[k].low || a.snap[k].avail !== b.snap[k].avail));
    console.log(`  ${a.at.replace(/-(\d\d)-(\d\d)-(\d\d)Z$/, " $1:$2:$3Z")} → ${b.at.replace(/-(\d\d)-(\d\d)-(\d\d)Z$/, " $1:$2:$3Z")}: ${changed.length}/${keys.length} rader (${changed.filter((k) => a.snap[k].low !== b.snap[k].low).length} pris, ${changed.filter((k) => a.snap[k].avail !== b.snap[k].avail).length} antal)`);
    for (const k of changed.slice(0, 3)) console.log(`      ${k}: ${a.snap[k].low}/${a.snap[k].avail} → ${b.snap[k].low}/${b.snap[k].avail}`);
  }
  console.log("\n0 ändrade = samma leverantörsdata i båda punkterna; ett hopp markerar en refresh däremellan.");
}

async function main() {
  if (!process.argv.includes("--diff")) {
    if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
    const snap = await take();
    fs.mkdirSync(DIR, { recursive: true });
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
    fs.writeFileSync(path.join(DIR, `${at}.json`), JSON.stringify(snap, null, 1));
    console.log(`Mätpunkt ${at}: ${Object.keys(snap).length} rader (4 anrop).`);
  }
  report(load());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
