/**
 * ENGELSKA SINGLAR FÖR ETT NYTT SET UR PRISLEVERANTÖREN (2026-09-17).
 *
 * Normalvägen är pokemontcg.io (import-tcg-data.ts, söndagar). Men ett släpp
 * ligger hos leverantören (RapidAPI/TCGGO) på släppdagen, medan pokemontcg.io
 * kommer dagar–veckor senare (och svarade 500 när 30th Celebration släpptes).
 * Det här skriptet skapar korten + singelprodukterna ur leverantörens episod så
 * setet finns i katalogen (sök, skanner, bevakning) från dag ett.
 *
 * IDENTITET: `Card.tcgExternalId = "tcggo:<id>"` (samma mönster som JP:s
 * "tcggo-jp:"). ⛔ Setets `externalId` lämnas ORÖRD (null) — pokemontcg.io-importen
 * adopterar setet på namn när det dyker upp där, och adopterar KORTEN på
 * set + nummer + namn (se import-tcg-data.ts) i stället för att skapa dubbletter.
 *
 * PRIS: leverantören ger `cardmarket_id` på korten → cardmarket-refresh prissätter
 * dem dagligen via Card.cardmarketId utan att något mer behövs. Ingen offer
 * skrivs här — hellre "–" i ett dygn än ett pris ur en annan väg.
 *
 * NÄMNARE: leverantören säger cards_printed_total 0 = okänt ⇒ totalCards lämnas
 * (0 = ingen stapel, se CLAUDE.md "TRE TAL OM ETT SET"). Titeln bär då inget "/N".
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/import-en-set-from-provider.ts --episode 431
 *      (--dry visar bara vad som hade skapats)
 */
import { prisma } from "@/lib/db";
import { normalizeTitle, slugify } from "@/lib/utils";
import { normalizeJpRarity } from "@/jobs/jp-singles-refresh";
import { exitJob } from "@/lib/job-exit";

const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";
export const EN_PROVIDER_PREFIX = "tcggo:";

interface Episode {
  id: number;
  name: string;
  code?: string | null;
  lang?: string | null;
  released_at?: string | null;
  logo?: string | null;
  cards_printed_total?: number | null;
  cards_total?: number | null;
  series?: { name?: string | null } | null;
}
interface ProviderCard {
  id: number;
  name: string;
  card_number: number | string | null;
  rarity: string | null;
  hp?: number | null;
  image?: string | null;
  cardmarket_id: number | null;
  tcgid: string | null;
  lang?: string | null;
  artist?: { name?: string | null } | null;
}

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

/** Titel som import-tcg-data: "Namn · Set N/Total", utan "/Total" när nämnaren är okänd. */
export function enProductTitle(name: string, setName: string, number: string, printedTotal: number | null): string {
  const denom = printedTotal && printedTotal > 0 ? `/${printedTotal}` : "";
  return `${name} · ${setName} ${number}${denom}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const epArg = args[args.indexOf("--episode") + 1];
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  if (!epArg) throw new Error("--episode <id> krävs");

  const ep = await api<{ data: Episode }>(`https://${HOST}/pokemon/episodes/${epArg}`).then((d) => d.data).catch(async () => {
    // Vissa versioner av API:t saknar detalj-endpointen — hitta episoden i listan.
    for (let page = 1; page <= 40; page++) {
      const d = await api<{ data: Episode[] }>(`https://${HOST}/pokemon/episodes?page=${page}`);
      const hit = d.data.find((e) => String(e.id) === epArg);
      if (hit) return hit;
      if (d.data.length === 0) break;
    }
    throw new Error(`Episod ${epArg} hittades inte`);
  });
  if ((ep.lang ?? "en") !== "en") throw new Error(`Episoden är ${ep.lang}, inte en — JP går via jp-singles-refresh`);
  console.log(`Episod ${ep.id} "${ep.name}" (${ep.code ?? "?"}), släpp ${ep.released_at ?? "?"}, serie ${ep.series?.name ?? "?"}`);

  // Vårt set: befintligt EN-set på exakt namn (stubben skapas av CM-katalogen i förväg),
  // annars nytt — utan externalId, så pokemontcg.io kan adoptera det på namn.
  let set = await prisma.cardSet.findFirst({
    where: { language: "EN", name: { equals: ep.name, mode: "insensitive" } },
    select: { id: true, name: true, logoUrl: true, releaseDate: true, totalCards: true },
  });
  if (!set) {
    if (dry) {
      console.log(`[dry] Hade skapat set "${ep.name}"`);
      set = { id: "dry", name: ep.name, logoUrl: null, releaseDate: null, totalCards: 0 };
    } else {
      set = await prisma.cardSet.create({
        data: {
          name: ep.name,
          series: ep.series?.name ?? "Unknown",
          language: "EN",
          releaseDate: ep.released_at ? new Date(ep.released_at) : new Date(),
          logoUrl: ep.logo ?? null,
          totalCards: ep.cards_printed_total ?? 0,
          totalCardsFull: ep.cards_total ?? 0,
        },
        select: { id: true, name: true, logoUrl: true, releaseDate: true, totalCards: true },
      });
      console.log(`Skapade set ${set.id}`);
    }
  } else {
    console.log(`Befintligt set ${set.id} "${set.name}" (${set.totalCards} kort enligt nämnaren)`);
    if (!dry && !set.logoUrl && ep.logo) {
      await prisma.cardSet.update({ where: { id: set.id }, data: { logoUrl: ep.logo } });
    }
  }
  const printedTotal = set.totalCards > 0 ? set.totalCards : (ep.cards_printed_total ?? 0) > 0 ? ep.cards_printed_total! : null;

  // Alla kort i episoden.
  const cards: ProviderCard[] = [];
  for (let page = 1; page <= 60; page++) {
    const d = await api<{ data: ProviderCard[]; paging?: { total?: number } }>(`https://${HOST}/pokemon/episodes/${ep.id}/cards?page=${page}`);
    cards.push(...d.data);
    if (d.data.length === 0 || (d.paging?.total != null && page >= d.paging.total)) break;
    await new Promise((r) => setTimeout(r, 220));
  }
  console.log(`${cards.length} kort hos leverantören (cardmarket_id på ${cards.filter((c) => c.cardmarket_id).length}, tcgid på ${cards.filter((c) => c.tcgid).length})`);

  // Redan importerade via pokemontcg.io? Då är vi klara — det här är bara för gapet.
  const existingCount = await prisma.card.count({ where: { setId: set.id } });
  if (existingCount > 0) console.log(`⚠️ Setet har redan ${existingCount} kort — befintliga rader uppdateras, inga dubbletter skapas (matchas på nummer + namn).`);
  const existing = await prisma.card.findMany({
    where: { setId: set.id },
    select: { id: true, number: true, name: true, tcgExternalId: true, cardmarketId: true, products: { where: { category: "SINGLE_CARD", variantLabel: null }, select: { id: true }, take: 1 } },
  });
  const byKey = new Map(existing.map((c) => [`${c.number}\t${c.name.toLowerCase()}`, c]));
  const byExt = new Map(existing.filter((c) => c.tcgExternalId).map((c) => [c.tcgExternalId!, c]));

  let created = 0, updated = 0, products = 0, skipped = 0;
  for (const c of cards) {
    if ((c.lang ?? "en") !== "en") { skipped++; continue; }
    const name = (c.name ?? "").trim();
    // Leverantören blandar 147 och "056"; pokemontcg.io skriver utan nollor ("56") —
    // samma form här, så adoptionen på nummer + namn möts senare.
    const number = String(c.card_number ?? "").trim().replace(/^0+(?=\d)/, "");
    if (!name || !number) { skipped++; continue; }
    const ext = `${EN_PROVIDER_PREFIX}${c.id}`;
    const rarity = normalizeJpRarity(c.rarity);
    const imageUrl = c.image ?? null;
    const hit = byExt.get(ext) ?? byKey.get(`${number}\t${name.toLowerCase()}`);

    let cardId: string;
    if (hit) {
      cardId = hit.id;
      if (!dry) {
        await prisma.card.update({
          where: { id: cardId },
          data: {
            rarity: hit.tcgExternalId?.startsWith(EN_PROVIDER_PREFIX) || !hit.tcgExternalId ? rarity : undefined,
            imageUrl: imageUrl ?? undefined,
            // CM-id är prisnyckeln — fyll om den saknas, kapa aldrig ett annat korts.
            ...(hit.cardmarketId == null && c.cardmarket_id ? { cardmarketId: c.cardmarket_id } : {}),
            ...(hit.tcgExternalId ? {} : { tcgExternalId: ext }),
            hp: c.hp ?? undefined,
          },
        }).catch((e) => console.warn(`  ⚠️ ${name} ${number}: ${e instanceof Error ? e.message.split("\n")[0] : e}`));
      }
      updated++;
    } else {
      if (dry) { console.log(`[dry] + ${name} ${number} (${rarity}) cm=${c.cardmarket_id ?? "-"}`); created++; continue; }
      const row = await prisma.card.create({
        data: {
          setId: set.id, number, name, rarity, imageUrl, language: "EN", tcgExternalId: ext,
          hp: c.hp ?? null, artist: c.artist?.name ?? null,
          ...(c.cardmarket_id ? { cardmarketId: c.cardmarket_id } : {}),
        },
        select: { id: true },
      }).catch(async (e) => {
        // cardmarketId @unique: ett annat kort bär redan id:t (leverantörsfel) → skapa utan.
        console.warn(`  ⚠️ ${name} ${number}: ${e instanceof Error ? e.message.split("\n")[0] : e} — skapar utan cardmarketId`);
        return prisma.card.create({
          data: { setId: set.id, number, name, rarity, imageUrl, language: "EN", tcgExternalId: ext, hp: c.hp ?? null, artist: c.artist?.name ?? null },
          select: { id: true },
        });
      });
      cardId = row.id;
      created++;
    }

    // Singelprodukten (samma form som import-tcg-data).
    const title = enProductTitle(name, set.name, number, printedTotal);
    const existingProduct = hit?.products[0]?.id ?? (await prisma.product.findFirst({ where: { cardId, category: "SINGLE_CARD" }, select: { id: true } }))?.id;
    if (existingProduct) {
      await prisma.product.update({ where: { id: existingProduct }, data: { title, normalizedTitle: normalizeTitle(title), imageUrl: imageUrl ?? undefined, setId: set.id } });
    } else {
      const baseSlug = slugify(`${name}-${(ep.code ?? ep.name).toLowerCase()}-${number}`);
      let slug = baseSlug;
      if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${baseSlug}-${c.id}`;
      await prisma.product.create({
        data: { title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", cardId, setId: set.id, imageUrl, language: "EN" },
      });
      products++;
    }
  }
  console.log(`Klart: ${created} kort skapade, ${updated} uppdaterade, ${products} produkter skapade, ${skipped} hoppade.`);
  console.log(`Nästa: cardmarket-refresh (13:00 UTC) prissätter via cardmarket_id; konstavtryck byggs i samma jobb.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => exitJob());
