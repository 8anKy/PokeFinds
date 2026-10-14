/**
 * OMPRÖVNING: kör singel-identiteten (singleListingContradiction) över allt Tradera-data
 * som redan ligger på SINGELKORT — skena-rader, offers och grafpunkter (annons + sålt).
 *
 * Varför (2026-10-14): setnamnet "30th Celebration: Classic Collection" bär formordet
 * "collection". Annonsen lästes då som en sealed kollektion, singel-identiteten (namn +
 * nummer) hoppades över, och "N 101/None …" blev skena-rad + "60 kr" på 22 kort i setet.
 * Vakten är lagad i matching.ts; det här skriptet städar det som hann skrivas.
 *
 * Domen ÅTERANVÄNDS härifrån — städningen och ingångsspärren kan inte glida isär.
 * Varje bortplockat (annons, produkt)-par får TraderaMatch(ok=false) så svepet aldrig
 * skriver tillbaka det. En offer som faller ersätts med nästa annons som klarar domen.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/revalidate-tradera-singles.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/revalidate-tradera-singles.ts --apply  # skriver
 *   … --sold   tar även med "Tradera sålt"-punkter (rapporteras alltid, raderas bara med flaggan)
 */
import { PrismaClient, type CardLanguage } from "@prisma/client";
import { singleListingContradiction, listingCarriesCardNumber } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { recomputeProductPriceCache, TRADERA_SOLD_SOURCE_NAME } from "../src/services/products";
import { listingItemIdFromUrl, purgeMismatchedMarketplaceOffer } from "../src/services/marketplace-offers";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SOLD = process.argv.includes("--sold");
const REASON = "singel-identitet (setnamnets formord, omprövning 2026-10-14)";

type Single = {
  id: string;
  slug: string;
  normalizedTitle: string;
  language: CardLanguage;
  variantLabel: string | null;
  card: { name: string; number: string; setId: string } | null;
  /** Setet har ett annat kort med samma namn ⇒ namnet ensamt pekar inte ut kortet. */
  ambiguous?: boolean;
};

/**
 * BARA BEVISAT FEL ELLER OAVGJORT tas bort: fel tryckt nummer, varken kortnamn eller
 * nummer, eller ett namn som finns på flera nummer i setet utan att annonsen säger vilket —
 * nummer i en annons utan "X/Y". Svepets fulla matchning är strängare (ordöverlapp,
 * tryckning, språk) — den hade också kastat korrekta rader som en äldre väg skrev.
 */
function fits(title: string, _url: string | null, p: Single): boolean {
  if (p.card == null) return true;
  if (singleListingContradiction(title, { normalizedTitle: p.normalizedTitle, card: p.card }) != null) return false;
  // Samma namn finns på ett annat nummer i setet och annonsen säger inte vilket.
  return !(p.ambiguous && !listingCarriesCardNumber(p.card.number, normalizeTitle(title)));
}

function slugTitle(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "").replace(/-/g, " ");
}

async function main() {
  console.log(`läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}${SOLD ? " (+ sålt)" : ""}\n`);
  const singles = new Map<string, Single>();
  for (const p of await prisma.product.findMany({
    where: { category: "SINGLE_CARD", card: { isNot: null } },
    select: { id: true, slug: true, normalizedTitle: true, language: true, variantLabel: true, card: { select: { name: true, number: true, setId: true } } },
  })) singles.set(p.id, p);
  const numbersByName = new Map<string, Set<string>>();
  for (const c of await prisma.card.findMany({ select: { setId: true, name: true, number: true } })) {
    const key = `${c.setId}|${normalizeTitle(c.name)}`;
    (numbersByName.get(key) ?? numbersByName.set(key, new Set()).get(key)!).add(c.number);
  }
  for (const p of singles.values()) {
    if (p.card) p.ambiguous = (numbersByName.get(`${p.card.setId}|${normalizeTitle(p.card.name)}`)?.size ?? 0) > 1;
  }
  console.log(`singlar: ${singles.size}`);

  const sources = await prisma.scrapeSource.findMany({
    where: { name: { in: ["Tradera", TRADERA_SOLD_SOURCE_NAME] } },
    select: { id: true, name: true },
  });
  const listedId = sources.find((s) => s.name === "Tradera")?.id;
  const soldId = sources.find((s) => s.name === TRADERA_SOLD_SOURCE_NAME)?.id;

  // ── Grafpunkter (sidvis på id — rawData är tungt) ───────────────────────
  const titleByUrl = new Map<string, string>();
  const badObs = { listed: [] as string[], sold: [] as string[] };
  const examples = { listed: [] as string[], sold: [] as string[] };
  for (const [kind, sourceId] of [["listed", listedId], ["sold", soldId]] as const) {
    if (!sourceId) continue;
    let cursor: string | undefined;
    let scanned = 0;
    for (;;) {
      const page = await prisma.priceObservation.findMany({
        where: { sourceId, product: { category: "SINGLE_CARD" } },
        select: { id: true, productId: true, rawData: true },
        orderBy: { id: "asc" },
        take: 5000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;
      for (const o of page) {
        scanned++;
        const raw = o.rawData as { title?: string; url?: string } | null;
        const p = singles.get(o.productId);
        if (!raw?.title || !p) continue;
        if (kind === "listed" && raw.url) titleByUrl.set(raw.url, raw.title);
        if (fits(raw.title, raw.url ?? null, p)) continue;
        badObs[kind].push(o.id);
        // Slumpurval (reservoar), inte de äldsta — rapporten ska visa hela bredden.
        const line = `  ${p.card?.name} ${p.card?.number}  ←  "${raw.title.slice(0, 90)}"`;
        const n = badObs[kind].length;
        if (examples[kind].length < 30) examples[kind].push(line);
        else if (Math.random() < 30 / n) examples[kind][Math.floor(Math.random() * 30)] = line;
      }
    }
    console.log(`${kind === "listed" ? "annons" : "sålt"}-punkter: ${scanned} skannade, ${badObs[kind].length} fel kort`);
    console.log(examples[kind].join("\n"));
  }

  // ── Skena-rader ─────────────────────────────────────────────────────────
  const rails = await prisma.traderaListing.findMany({
    select: { id: true, productId: true, itemId: true, title: true, url: true },
  });
  const titleByItem = new Map(rails.map((r) => [r.itemId, r.title]));
  const badRails = rails.filter((r) => {
    const p = singles.get(r.productId);
    return p != null && !fits(r.title, r.url, p);
  });
  console.log(`\nskena-rader: ${rails.length}, ${badRails.length} fel kort`);
  for (const r of badRails.slice(0, 15)) {
    const p = singles.get(r.productId)!;
    console.log(`  ${p.card?.name} ${p.card?.number}  ←  "${r.title.slice(0, 90)}"`);
  }

  // ── Offers ──────────────────────────────────────────────────────────────
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" }, select: { id: true, name: true } });
  const offers = await prisma.offer.findMany({
    where: { retailerId: tradera.id, price: { not: null }, product: { category: "SINGLE_CARD" } },
    select: { id: true, productId: true, price: true, url: true },
  });
  const badOffers = offers.filter((o) => {
    const p = singles.get(o.productId);
    if (!p) return false;
    const itemId = listingItemIdFromUrl(o.url);
    if (!itemId) return false;
    const title = titleByItem.get(itemId) ?? titleByUrl.get(o.url) ?? slugTitle(o.url);
    return !fits(title, o.url, p);
  });
  console.log(`\nTradera-offers på singlar: ${offers.length}, ${badOffers.length} fel kort`);
  for (const o of badOffers.slice(0, 15)) {
    const p = singles.get(o.productId)!;
    console.log(`  ${p.card?.name} ${p.card?.number}  ${((o.price ?? 0) / 100).toFixed(0)} kr  /produkter/${p.slug}\n      ${o.url}`);
  }

  if (!APPLY) {
    console.log(`\nTorrkörning — inget skrivet. --apply skriver${SOLD ? "" : " (sålt-punkterna kräver även --sold)"}.`);
    return;
  }

  const obsIds = [...badObs.listed, ...(SOLD ? badObs.sold : [])];
  let obsDeleted = 0;
  for (let i = 0; i < obsIds.length; i += 1000) {
    obsDeleted += (await prisma.priceObservation.deleteMany({ where: { id: { in: obsIds.slice(i, i + 1000) } } })).count;
  }
  for (const r of badRails) {
    await prisma.traderaMatch.upsert({
      where: { itemId_productId: { itemId: r.itemId, productId: r.productId } },
      update: { ok: false, reason: REASON },
      create: { itemId: r.itemId, productId: r.productId, ok: false, reason: REASON },
    });
  }
  await prisma.traderaListing.deleteMany({ where: { id: { in: badRails.map((r) => r.id) } } });
  let replaced = 0;
  for (const o of badOffers) {
    const res = await purgeMismatchedMarketplaceOffer(
      { ...o, retailerId: tradera.id, retailerName: tradera.name, productCategory: "SINGLE_CARD" },
      REASON
    );
    if (res?.replacement) replaced++;
  }
  await recomputeProductPriceCache();
  console.log(
    `\n✅ ${obsDeleted} grafpunkter, ${badRails.length} skena-rader och ${badOffers.length} offers borttagna ` +
      `(${replaced} ersatta av nästa annons); paren spärrade, priscachen omräknad.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
