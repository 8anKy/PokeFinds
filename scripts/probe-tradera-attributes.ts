/**
 * TORRKÖRNING: vilka attribut kan en Tradera-annons i Pokémon-kategorierna bära?
 *
 * Varför ett skript: `LANGUAGE_ATTRIBUTE_ID = 124` i `lib/tradera-sell.ts` är
 * ett tal någon en gång läste ur referensdatan. Ska vi skicka BOLAG och BETYG
 * som strukturerade attribut (det scrapern läser som `pokemon_grading_issuer` /
 * `pokemon_grade`, mätt 2026-09-04) måste id:n och tillåtna termer komma ur
 * samma källa — aldrig gissas. Referensdatan kräver bara app-nyckeln, ingen
 * användartoken, så den går att fråga utan att någon loggar in.
 *
 * Kör: npx tsx scripts/probe-tradera-attributes.ts
 */
import "dotenv/config";

const stripQuotes = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const APP_ID = stripQuotes(process.env.TRADERA_APP_ID ?? "");
const APP_KEY = stripQuotes(process.env.TRADERA_APP_KEY ?? "");
const BASE = "https://api.tradera.com";

/** Kategorierna `traderaCategoryId()` kan välja. */
const CATEGORIES = [1001337, 1001339, 1001340, 1001341];

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-App-Id": APP_ID, "X-App-Key": APP_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

async function main() {
  if (!APP_ID || !APP_KEY) {
    console.error("TRADERA_APP_ID / TRADERA_APP_KEY saknas i .env.");
    process.exit(1);
  }
  for (const categoryId of CATEGORIES) {
    console.log(`\n=== kategori ${categoryId} ===`);
    for (const path of [
      `/v4/categories/${categoryId}/attribute-definitions`,
    ]) {
      try {
        const data = await get(path);
        console.log(`--- ${path}`);
        console.log(JSON.stringify(data, null, 1).slice(0, 8000));
        break;
      } catch (e) {
        console.log(`(miss) ${path}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

void main();
