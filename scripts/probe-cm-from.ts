/**
 * PROBE: vad returnerar RapidAPI för ett enskilt kort, och vad säger CM:s egen
 * prisguide om samma idProduct? Används för att avgöra om `lowest_near_mint`
 * verkligen är CM:s visade "From (NM, engelska)" eller något annat.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/probe-cm-from.ts base1-2 hgss1-107 …
 *
 * Skriver ALDRIG ut nyckeln. Ett anrop per tcgid (räkna in i RapidAPI-kvoten).
 */
import { PrismaClient } from "@prisma/client"; // laddar .env

new PrismaClient(); // sidoeffekt: .env in i process.env

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

const TCGIDS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function api<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
  if (!r.ok) {
    console.error(`  HTTP ${r.status}`);
    return null;
  }
  return (await r.json()) as T;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas i .env");
  const g = await fetch(CM_GUIDE);
  const guide = new Map<number, Record<string, number>>(
    ((await g.json()) as { priceGuides: Record<string, number>[] }).priceGuides.map((e) => [e.idProduct, e])
  );
  console.log(`CM-prisguide: ${guide.size} produkter\n`);

  for (const id of TCGIDS) {
    const d = await api<{ data: unknown[] }>(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(id)}`);
    const rows = (d?.data ?? []) as {
      name?: string;
      tcgid?: string;
      cardmarket_id?: number;
      episode?: { name?: string };
      prices?: { cardmarket?: Record<string, unknown> };
    }[];
    if (rows.length === 0) {
      console.log(`${id}: INGEN TRÄFF\n`);
      continue;
    }
    for (const card of rows) {
      const cm = card.prices?.cardmarket ?? {};
      console.log(`${id}  →  ${card.name}  (${card.episode?.name})  cmid=${card.cardmarket_id}`);
      console.log(`   RapidAPI.cardmarket = ${JSON.stringify(cm)}`);
      const gp = card.cardmarket_id != null ? guide.get(card.cardmarket_id) : undefined;
      console.log(`   CM-guide            = ${gp ? JSON.stringify(gp) : "saknas"}`);
      console.log(
        `   CM-sida: https://www.cardmarket.com/en/Pokemon/Products?idProduct=${card.cardmarket_id}&language=1&minCondition=2\n`
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
