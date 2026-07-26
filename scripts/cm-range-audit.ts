/**
 * CM-SPANNREVISION — ligger våra publicerade priser inom Cardmarkets EGNA siffror?
 *
 * Facit är CM:s egen gratis-publicerade prisguide (price_guide_6.json, uppdateras
 * dagligen, ingen RapidAPI-kvot, ingen scraping). För varje produkt jämförs vårt
 * publicerade CM-pris mot HELA spannet CM själv publicerar: low, trend, avg, avg30.
 *
 * Varför spannet och inte ett fält: enskilda guide-fält är ibland trasiga (trend=0,02
 * på kort som handlas för 20 €), så ett enda fält kan inte döma. Ett pris som ligger
 * över ALLA fyra referenserna ×3, eller under alla ÷3, är däremot inte förklarligt som
 * "marknaden rörde sig" — då mäter vi något annat än kortet.
 *
 * Identiteten kommer olika beroende på hur offer-URL:en ser ut:
 *   ?idProduct=N  → exakt (sealed + nyimporterade singlar)
 *   /Singles/…    → sluggen bär expansion + kortnamn; expansionen binds till en
 *                   idExpansion via NAMNÖVERLAPP över hela setet, och storleken
 *                   bryter lika (en reprint-expansion innehåller alla namn men är
 *                   mycket större). Dubblerade namn i samma expansion (CM:s V1/V2/V3-
 *                   tryckvarianter) kan inte särskiljas offline → rapporteras separat.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts --strict   # exit 1 om fynd
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-range-audit.ts --apply    # REPARERA (se nedan)
 *   MULT=5 … (default 3)
 *
 * `--apply` skriver om de priser som ligger FÖR HÖGT till CM:s egen mittpunkt — samma
 * beslut som taket i cardmarket-refresh (fromExceedsCardmarket + cmGuideMedianEur), fast
 * för rader som redan hunnit bli fel. Fyra spärrar, alla medvetna:
 *   • bara SINGLE_CARD — sealed ligger 99,5 % inom spannet och de få avvikarna är trasiga
 *     guide-rader (booster box med trend=0,02); en "reparation" där hade förstört rätt pris
 *   • bara FÖR HÖGA — för låga fynd innehåller nya set där CM:s guide själv är omogen
 *     (Chaos Rising-common med trend 341 €); att skriva medianen dit hade satt 341 kr
 *   • RIK guide-rad: ≥4 av CM:s 6 fält satta och de spretar ≤50x. Utan det kravet blir
 *     vakten värre än buggen — Professor Sycamore · Steam Siege har bara trend+avg30, båda
 *     0,05 €, och en "reparation" hade skrivit 5 öre på ett kort värt 10 €
 *   • set som släppts inom SET_MIN_AGE_DAYS hoppas över (CM:s guide behöver några veckor)
 */
import { PrismaClient } from "@prisma/client";
import { cmNameKey, cmGuideMedianEur, cmGuideIsRich, type CmGuideFields } from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";
import { recomputeProductPriceCache } from "../src/services/products";
import { utcToday } from "../src/lib/utils";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");
const APPLY = process.argv.includes("--apply");
const MULT = Number(process.env.MULT) || 3;
const SET_MIN_AGE_DAYS = Number(process.env.SET_MIN_AGE_DAYS) || 60;
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

interface Cat { idProduct: number; name: string; idExpansion: number }
interface Guide extends CmGuideFields { idProduct: number }
const pos = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

async function main() {
  const rates = await getRatesOre();
  const [catRes, guideRes] = await Promise.all([fetch(SINGLES), fetch(GUIDE)]);
  if (!catRes.ok || !guideRes.ok) throw new Error(`CM-filer: katalog ${catRes.status}, guide ${guideRes.status}`);
  const cat = ((await catRes.json()) as { products: Cat[] }).products;
  const guide = new Map<number, Guide>(
    ((await guideRes.json()) as { priceGuides: Guide[] }).priceGuides.map((g) => [g.idProduct, g])
  );

  const expNames = new Map<number, Set<string>>();
  const byExpName = new Map<string, Cat[]>();
  for (const p of cat) {
    const k = cmNameKey(p.name);
    if (!k) continue;
    (expNames.get(p.idExpansion) ?? expNames.set(p.idExpansion, new Set()).get(p.idExpansion)!).add(k);
    const bk = `${p.idExpansion}|${k}`;
    (byExpName.get(bk) ?? byExpName.set(bk, []).get(bk)!).push(p);
  }

  const rows = await prisma.$queryRaw<
    {
      offerId: string; productId: string; title: string; slug: string; setKey: string;
      cardName: string | null; price: number; url: string; isSingle: boolean; setAgeDays: number | null;
    }[]
  >`
    SELECT o.id AS "offerId", p.id AS "productId", p.title, p.slug,
           COALESCE(cs."externalId", cs.name, '?') AS "setKey",
           c.name AS "cardName", o.price, o.url,
           (p.category = 'SINGLE_CARD') AS "isSingle",
           EXTRACT(DAY FROM NOW() - cs."releaseDate")::int AS "setAgeDays"
    FROM "Offer" o
    JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'Cardmarket'
    JOIN "Product" p ON p.id = o."productId"
    LEFT JOIN "Card" c ON c.id = p."cardId"
    LEFT JOIN "CardSet" cs ON cs.id = p."setId"
    WHERE o.price IS NOT NULL AND o.price > 0
      AND p.category NOT IN ('GRADED_CARD', 'ACCESSORY')`;

  // Expansionsbindning för slug-URL:er
  const slugOf = (u: string) => u.match(/\/Singles\/([^/]+)\//)?.[1] ?? null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const s = slugOf(r.url);
    if (!s || !r.cardName) continue;
    const key = `${r.setKey}|${s}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const expOf = new Map<string, number>();
  for (const [key, list] of groups) {
    const ours = new Set(list.map((c) => cmNameKey(c.cardName!)).filter(Boolean));
    const cands: { exp: number; size: number }[] = [];
    for (const [exp, names] of expNames) {
      let hit = 0;
      for (const n of ours) if (names.has(n)) hit++;
      if (hit >= Math.max(5, ours.size * 0.8)) cands.push({ exp, size: names.size });
    }
    if (cands.length === 0) continue;
    cands.sort((a, b) => Math.abs(a.size - ours.size) - Math.abs(b.size - ours.size));
    expOf.set(key, cands[0].exp);
  }

  let checked = 0, inRange = 0, unmapped = 0, ambiguous = 0, noRefs = 0;
  const findings: {
    title: string; slug: string; ours: number; refs: string; ratio: number; kind: "hög" | "låg";
    offerId: string; productId: string; isSingle: boolean; setAgeDays: number | null; medianEur: number | null;
    /** Flera CM-tryckvarianter vars mittpunkter skiljer >2x → vilken som är rätt AVGÖR
     *  svaret, så en automatisk rättelse vore en gissning. Flaggas, rättas inte. */
    variantUnsure: boolean;
  }[] = [];

  for (const r of rows) {
    let g: Guide | undefined;
    let variantUnsure = false;
    const idInUrl = Number(r.url.match(/idProduct=(\d+)/)?.[1] ?? 0);
    if (idInUrl) {
      g = guide.get(idInUrl);
    } else {
      const s = slugOf(r.url);
      const exp = s ? expOf.get(`${r.setKey}|${s}`) : undefined;
      if (exp == null || !r.cardName) { unmapped++; continue; }
      const cands = byExpName.get(`${exp}|${cmNameKey(r.cardName)}`) ?? [];
      if (cands.length === 0) { unmapped++; continue; }
      if (cands.length === 1) {
        g = guide.get(cands[0].idProduct);
      } else {
        // FLERA CM-TRYCKVARIANTER med samma namn (V1/V2/V3). Vi kan inte veta offline
        // vilken RapidAPI valde — men vi behöver inte veta det för att döma: kräv att
        // ALLA rika kandidater är eniga om att priset ligger utanför spannet. Är de
        // eniga är domen oberoende av vilken variant som är den rätta.
        const rich = cands.map((c) => guide.get(c.idProduct)).filter((x): x is Guide => !!x && cmGuideIsRich(x));
        if (rich.length !== cands.length || rich.length === 0) { ambiguous++; continue; }
        const ourEur = r.price / rates.eurToOre;
        const allHigh = rich.every((x) => ourEur > Math.max(...[pos(x.low), pos(x.trend), pos(x.avg), pos(x.avg30)].filter((v): v is number => v != null)) * MULT);
        const allLow = rich.every((x) => ourEur < Math.min(...[pos(x.low), pos(x.trend), pos(x.avg), pos(x.avg30)].filter((v): v is number => v != null)) / MULT);
        if (!allHigh && !allLow) { ambiguous++; continue; }
        // Enighet finns. Välj den variant vars spann ligger NÄRMAST vårt nuvarande pris:
        // antagandet är att identiteten är rätt och att det är SIFFRAN som är fel, så den
        // närmaste kandidaten är den minst ingripande rättelsen (för Ponyta BS 60 pekar
        // det på rätt produkt — den vars trend 3,41 € matchar CM-sidan).
        rich.sort((a, b) => {
          const m = (x: Guide) => Math.max(...[pos(x.low), pos(x.trend), pos(x.avg), pos(x.avg30)].filter((v): v is number => v != null));
          return Math.abs(Math.log(ourEur / m(a))) - Math.abs(Math.log(ourEur / m(b)));
        });
        g = rich[0];
        const meds = rich.map((x) => cmGuideMedianEur(x)).filter((v): v is number => v != null);
        variantUnsure = meds.length > 1 && Math.max(...meds) / Math.min(...meds) > 2;
      }
    }
    if (!g) { unmapped++; continue; }
    const refs = [pos(g.low), pos(g.trend), pos(g.avg), pos(g.avg30)].filter((v): v is number => v != null);
    if (refs.length === 0) { noRefs++; continue; }
    checked++;
    const ours = r.price / rates.eurToOre;
    const hi = Math.max(...refs), lo = Math.min(...refs);
    const desc = `low ${g.low} trend ${g.trend} avg ${g.avg} avg30 ${g.avg30}`;
    const base = {
      title: r.title, slug: r.slug, ours, refs: desc, offerId: r.offerId, productId: r.productId,
      isSingle: r.isSingle, setAgeDays: r.setAgeDays, medianEur: cmGuideIsRich(g) ? cmGuideMedianEur(g) : null,
      variantUnsure,
    };
    if (ours > hi * MULT) findings.push({ ...base, ratio: ours / hi, kind: "hög" });
    else if (ours < lo / MULT) findings.push({ ...base, ratio: lo / ours, kind: "låg" });
    else inRange++;
  }

  console.log(`\n=== CM-SPANNREVISION (facit: CM:s egen prisguide, ${guide.size} rader) ===`);
  console.log(`Jämförda: ${checked}  inom spannet: ${inRange} (${((inRange / checked) * 100).toFixed(1)} %)`);
  console.log(`Utanför ×${MULT}: ${findings.length}  (${findings.filter((f) => f.kind === "hög").length} för höga, ${findings.filter((f) => f.kind === "låg").length} för låga)`);
  console.log(`Ej jämförbara: ${ambiguous} tvetydig tryckvariant (CM V1/V2/V3), ${unmapped} utan mappning, ${noRefs} utan CM-referens`);

  for (const kind of ["hög", "låg"] as const) {
    const list = findings.filter((f) => f.kind === kind).sort((a, b) => b.ratio - a.ratio);
    if (!list.length) continue;
    console.log(`\n${kind === "hög" ? "ÖVER" : "UNDER"} hela CM-spannet (${list.length}):`);
    for (const f of list.slice(0, 40))
      console.log(`   ${f.ours.toFixed(2).padStart(10)} € | ${f.refs} | ${f.ratio.toFixed(0)}x  ${f.title}\n        /produkter/${f.slug}`);
    if (list.length > 40) console.log(`   … ${list.length - 40} fler`);
  }

  // ── REPARATION ───────────────────────────────────────────────────────────────
  const repairable = findings.filter(
    (f) => f.kind === "hög" && f.isSingle && f.medianEur != null && !f.variantUnsure &&
      (f.setAgeDays == null || f.setAgeDays >= SET_MIN_AGE_DAYS)
  );
  const unsure = findings.filter((f) => f.variantUnsure);
  const skipped = findings.filter((f) => f.kind === "hög").length - repairable.length;
  console.log(
    `\nREPARERBARA (för höga, singel, RIK guide-rad, set äldre än ${SET_MIN_AGE_DAYS} dygn): ${repairable.length}` +
    `  (${skipped} för höga hoppas över, ${findings.filter((f) => f.kind === "låg").length} för låga rörs aldrig)`
  );
  if (unsure.length) {
    console.log(
      `
⚠ ${unsure.length} fynd där CM har FLERA tryckvarianter vars mittpunkter skiljer >2x —` +
      ` vilken som är rätt avgör svaret, så de rättas INTE automatiskt. De kräver att varje korts` +
      ` idProduct pinnas (t.ex. mot pokemontcg.io:s per-kort-siffror, gratis). Exempel:`
    );
    for (const f of unsure.slice(0, 8)) console.log(`   ${f.ours.toFixed(2).padStart(9)} € | ${f.refs}  ${f.title}`);
  }
  if (repairable.length) {
    console.log(APPLY ? "  LÄGE: SKRIVER" : "  LÄGE: TORRKÖRNING (--apply för att skriva)");
    for (const f of repairable.slice(0, 15))
      console.log(`   ${f.ours.toFixed(2).padStart(9)} € → ${f.medianEur!.toFixed(2).padStart(8)} €   ${f.title}`);
    if (repairable.length > 15) console.log(`   … ${repairable.length - 15} fler`);
  }
  if (APPLY && repairable.length) {
    const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
    const today = utcToday();
    for (const f of repairable) {
      const ore = Math.round(f.medianEur! * rates.eurToOre);
      // lastSeenAt rörs INTE: vi har inte sett en ny annons, vi rättar en siffra — och
      // täckningsvakten ska fortsätta kunna se om kortet slutat uppdateras.
      await prisma.offer.update({ where: { id: f.offerId }, data: { price: ore } });
      if (cmSource) {
        await prisma.priceObservation.create({
          data: { productId: f.productId, sourceId: cmSource.id, price: ore, currency: "SEK" },
        });
        await prisma.priceSnapshot.upsert({
          where: { productId_date: { productId: f.productId, date: today } },
          update: { minPrice: ore, maxPrice: ore, avgPrice: ore },
          create: { productId: f.productId, date: today, minPrice: ore, maxPrice: ore, avgPrice: ore, volume: 1 },
        });
      }
    }
    await recomputeProductPriceCache();
    console.log(`\n${repairable.length} priser rättade till CM:s egen mittpunkt, prischachen omräknad.`);
  }

  if (STRICT && findings.length > 0) {
    console.error(`\nSTRICT: ${findings.length} priser utanför CM:s eget spann → exit 1`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
