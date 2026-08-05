/**
 * FELLÄNKADE PROMO-SINGLAR — kort utan pokemontcg.io-id vars `cardmarketId` pekar
 * på en ANNAN Cardmarket-produkt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-promo-cm-links.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fix-promo-cm-links.ts --apply
 *
 * Bakgrund (2026-08-05): korten i promo-seten saknar `tcgExternalId`, så hela deras
 * identitet hänger på `cardmarketId`. Är den fel når feeden dem aldrig och priset
 * fryser — Makuhita · MEP 068 låg på 22,02 kr sedan 12 juli därför att kortet var
 * länkat till 282777, som hos Cardmarket heter "Energy Switch".
 *
 * ⛔ TVÅ OBEROENDE BEVIS KRÄVS, precis som i recover-cm-idproduct.ts:
 *   1. NUVARANDE länk måste vara BEVISAT fel — CM:s egen singelkatalog ger ett namn
 *      som inte är kortets. Går namnen ihop rörs raden aldrig, hur lockande feedens
 *      id än ser ut (MEP 023 är rätt länkad hos oss och FEL i feeden — den ska
 *      absolut inte skrivas om).
 *   2. ERSÄTTAREN måste vara bevisat rätt — feedens rad hittas på set + samlarnummer,
 *      och dess `cardmarket_id` måste bära VÅRT kortnamn enligt CM:s katalog.
 * Saknas något av bevisen: rapportera, skriv inte. Numret ensamt är inte identitet.
 *
 * ⛔ TOM KATALOG (CDN-fel) ⇒ ingen körning. Utan CM:s namnlista finns inga bevis,
 *    och "inga träffar" hade då lästs som "allt är friskt".
 */
import { prisma } from "../src/lib/db";
import { cmNumberKeyNoSetCode, cmSetNameKey, cmCardNameAgrees } from "../src/jobs/cardmarket-refresh";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const APPLY = process.argv.includes("--apply");
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";
const SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

const api = async <T>(u: string): Promise<T | null> => {
  const r = await fetch(u, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
  if (!r.ok) { console.warn(`  HTTP ${r.status} ${u}`); return null; }
  return (await r.json()) as T;
};

interface Row { name?: string | null; card_number?: string | number | null; cardmarket_id?: number | null }

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", card: { tcgExternalId: null, cardmarketId: { not: null } } },
    select: {
      id: true, title: true,
      card: { select: { id: true, name: true, number: true, cardmarketId: true } },
      set: { select: { name: true } },
      offers: { where: { retailerId: cm.id }, select: { id: true, url: true }, take: 1 },
    },
  });
  console.log(`${products.length} singlar utan tcgExternalId.`);
  if (!products.length) return;

  // CM:s EGEN singelkatalog = facit för vad ett idProduct heter.
  const catalog = (await fetch(SINGLES).then((r) => r.json())) as { products: { idProduct: number; name: string }[] };
  if (!catalog?.products?.length) {
    console.error("CM:s singelkatalog är tom — avbryter. Utan facit finns inga bevis.");
    process.exitCode = 1;
    return;
  }
  const cmName = new Map(catalog.products.map((p) => [p.idProduct, p.name]));
  console.log(`CM-katalog: ${cmName.size} singlar.`);

  // Bara de set som faktiskt har sådana kort — vi hämtar inte hela feeden i onödan.
  const wantedSets = new Set(products.map((p) => p.set?.name).filter((n): n is string => !!n));
  const eps: { id: number; name?: string | null }[] = [];
  let page = 1, total = 1;
  do {
    const d = await api<{ data: typeof eps; paging: { total: number } }>(`https://${HOST}/pokemon/episodes?page=${page}`);
    if (!d) break;
    total = d.paging.total;
    eps.push(...d.data);
  } while (page++ < total);

  /** setnamn → (nummernyckel → feedrad). Tvetydigt nummer i episoden ⇒ null. */
  const feedBySet = new Map<string, Map<string, Row | null>>();
  for (const ep of eps) {
    const match = [...wantedSets].find((s) => cmSetNameKey(s) === cmSetNameKey(ep.name));
    if (!match) continue;
    const rows: Row[] = [];
    let p = 1, tot = 1;
    do {
      const d = await api<{ data: Row[]; paging: { total: number } }>(`https://${HOST}/pokemon/episodes/${ep.id}/cards?page=${p}`);
      if (!d) break;
      tot = d.paging.total;
      rows.push(...d.data);
    } while (p++ < tot);
    const byNum = new Map<string, Row | null>();
    for (const r of rows) {
      const k = cmNumberKeyNoSetCode(r.card_number);
      if (!k) continue;
      byNum.set(k, byNum.has(k) ? null : r);
    }
    feedBySet.set(match, byNum);
    console.log(`  episod ${ep.id} "${ep.name}" → ${rows.length} rader (${byNum.size} nummernycklar)`);
  }

  let ok = 0, broken = 0, fixed = 0, unresolved = 0;
  for (const p of products) {
    const card = p.card!;
    const current = cmName.get(card.cardmarketId!);
    // BEVIS 1 — är nuvarande länk fel?
    if (current && cmCardNameAgrees(card.name, current)) { ok++; continue; }
    broken++;
    console.log(`\nFEL LÄNK  ${p.title}`);
    console.log(`  kortets cardmarketId ${card.cardmarketId} = CM:"${current ?? "SAKNAS I KATALOGEN"}"`);

    // BEVIS 2 — vad säger feeden, och håller CM:s katalog med om det namnet?
    const row = feedBySet.get(p.set?.name ?? "")?.get(cmNumberKeyNoSetCode(card.number));
    const candidate = row?.cardmarket_id ?? null;
    const candName = candidate != null ? cmName.get(candidate) : undefined;
    if (!row) { console.log("  → ingen entydig feedrad på det numret. Lämnas orörd."); unresolved++; continue; }
    if (candidate == null || !candName) { console.log(`  → feedradens cardmarket_id (${candidate}) finns inte i CM:s katalog. Lämnas orörd.`); unresolved++; continue; }
    if (!cmCardNameAgrees(card.name, candName)) { console.log(`  → feedens ${candidate} = CM:"${candName}" — inte vårt kort. Lämnas orörd.`); unresolved++; continue; }

    const url = cardmarketProductUrl(candidate, { nearMint: true, firstEd: "exclude" });
    console.log(`  → ${candidate} = CM:"${candName}" ✔ båda källorna eniga`);
    console.log(`     ny länk: ${url}`);
    if (APPLY) {
      await prisma.card.update({ where: { id: card.id }, data: { cardmarketId: candidate } });
      if (p.offers[0]) await prisma.offer.update({ where: { id: p.offers[0].id }, data: { url } });
      fixed++;
    }
  }

  console.log(`\n${ok} korrekta, ${broken} felaktiga (${unresolved} utan bevisad ersättare).`);
  console.log(APPLY ? `${fixed} skrivna.` : "TORRKÖRNING — inget skrivet. Kör med --apply.");
}
main().finally(() => prisma.$disconnect());
