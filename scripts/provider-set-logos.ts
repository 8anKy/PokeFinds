/**
 * RIKTIG LOGOTYP FÖRE RITAD BRICKA (2026-10-23, ägaren: "set-symboler som reserv för de 184
 * ritade brickorna" — beslutet blev logotypen, inte symbolen).
 *
 *   npx railway run --service PokeFinds -- node scripts/with-prod-db.mjs npx tsx scripts/provider-set-logos.ts           # torrkörning
 *   npx railway run --service PokeFinds -- node scripts/with-prod-db.mjs npx tsx scripts/provider-set-logos.ts --apply   # laddar ner + pekar om
 *
 * Set som visar en ritad bricka (`/set-logos/generated/`, scripts/generate-set-tiles.ts) eller
 * saknar logotyp får leverantörens episodlogotyp när den finns och laddar. Filen läggs i
 * `public/set-logos/jp/{KOD}.png` (JP, samma regel som sync-jp-sets-from-api.ts) resp.
 * `public/set-logos/provider/{setId}.png` (EN) — ingen annans CDN per sidvisning. Filerna
 * måste checkas in.
 *
 * Matchningen är EXAKT: vårt `externalId` = `tcggo:<episod-id>` / `tcggo-jp:<episod-id>`. Inga
 * namnalias: ett CardTrader-set ("Futsal Promos", `ct:2112`) är inte leverantörens episod
 * ("Pokémon Futsal Collection") bara för att namnen liknar varandra — en lånad logotyp hade
 * påstått att två set är samma.
 *
 * MÄTT 2026-10-23: 168 set har ritad bricka; 167 är CardTrader-expansioner (`ct:`) som
 * leverantören inte har någon episod för (deckkit, WCD, tränarkit, Battle Academy …), 1
 * (Super-Burst Impact SM8) har fått en logotyp hos leverantören sedan brickan ritades.
 * `symbol` (EN 174 av 187 episoder, JP 0) används inte: den är 1–2 cm stor och har ingen
 * plats i UI:t — alla set har redan en logotyp eller bricka, så `CardSet.symbolUrl`-reserven i
 * set-bevakningen nås aldrig.
 *
 * ~11 anrop (episodlistorna, EN + JP). Kör efter generate-set-tiles när leverantören fått nya
 * logotyper; körs inte i ett jobb (filen måste in i repot).
 */
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { prisma } from "../src/lib/db";
import { jpSetLogoPath } from "../src/lib/jp-set-name";

const APPLY = process.argv.includes("--apply");
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";

interface Episode { id: number; name: string; logo: string | null }

async function episodes(game: "pokemon" | "pokemon-jp"): Promise<Episode[]> {
  const out: Episode[] = [];
  let page = 1, total = 1;
  do {
    const r = await fetch(`https://${HOST}/${game}/episodes?page=${page}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!r.ok) throw new Error(`${game}/episodes sida ${page}: HTTP ${r.status}`);
    const body = (await r.json()) as { data: Episode[]; paging: { total: number } };
    out.push(...body.data);
    total = body.paging.total;
    await new Promise((res) => setTimeout(res, 250));
  } while (page++ < total);
  return out;
}

/** Hämtar bilden och kräver att det faktiskt ÄR en bild av rimlig storlek. */
async function fetchLogo(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "ScoutrSetLogos/1.0 (+https://scoutr.se)" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1024 ? buf : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas — kör via `npx railway run`.");
  const byExternal = new Map<string, Episode>();
  for (const e of await episodes("pokemon")) byExternal.set(`tcggo:${e.id}`, e);
  for (const e of await episodes("pokemon-jp")) byExternal.set(`tcggo-jp:${e.id}`, e);

  const sets = await prisma.cardSet.findMany({
    where: { OR: [{ logoUrl: null }, { logoUrl: "" }, { logoUrl: { startsWith: "/set-logos/generated/" } }] },
    select: { id: true, name: true, language: true, externalId: true },
  });
  let swapped = 0;
  for (const s of sets) {
    const ep = s.externalId ? byExternal.get(s.externalId) : undefined;
    if (!ep?.logo) continue;
    const rel = s.language === "JP" ? jpSetLogoPath(s.name) : `/set-logos/provider/${s.id}.png`;
    console.log(`LOGO  ${s.name} ← ${ep.logo}  →  ${rel}`);
    if (!APPLY) { swapped++; continue; }
    const img = await fetchLogo(ep.logo);
    if (!img) { console.warn(`  ! laddade inte, behåller brickan`); continue; }
    const file = path.join(process.cwd(), "public", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Leverantörens original är upp till 1250 px / 1 MB — våra logotyper är ~200 px / 20 kB.
    fs.writeFileSync(file, await sharp(img).resize({ width: 400, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer());
    await prisma.cardSet.update({ where: { id: s.id }, data: { logoUrl: rel } });
    swapped++;
  }
  console.log(`\n${APPLY ? "SKRIVET" : "TORRKÖRNING"}: ${swapped} av ${sets.length} set med ritad bricka/utan logotyp får leverantörens logotyp.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
