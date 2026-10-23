/**
 * KORT SOM BARA FINNS PÅ CARDMARKET (2026-10-15, ägaren: "många kort saknas").
 *
 * Katalogen växer ur pokemontcg.io, TCGdex och prisleverantören (TCGGO). Ingen av dem
 * har Cardmarkets "Additionals" (stämplade tryckningar: Team Rocket's Moltres ex
 * xDRI 229 ur ett temadäck, ~97 €) eller de japanska startdäcken (Marnie's Morpeko
 * svOM 020). Cardmarkets egen gratiskatalog har dem — men utan nummer och setnamn.
 *
 * IDENTITET = CardTraders katalog, som har ett blueprint per tryckning med namn,
 * samlarnummer, versionsetikett ("Destined Rivals Stamp"), språk och `card_market_ids`.
 * CardTrader levererar INGA priser här — bara vem kortet är. Priset är Cardmarkets
 * (prisguiden, samma uppskattning som när From saknas: median trend/avg/avg30 ⇒
 * OUT_OF_STOCK ⇒ "Uppskattat värde"). Bilden är Cardmarkets (cm-image-proxyn).
 *
 * VAKTER (identitet, aldrig pris):
 *   · bara singlar (CT-kategori 73) och bara ENGELSKA eller JAPANSKA tryckningar
 *     (blueprintets `pokemon_language`), aldrig kinesiska/koreanska — katalogpolicyn;
 *   · ett CM-id som flera blueprints gör anspråk på avstås;
 *   · Cardmarkets katalognamn måste hålla med CardTraders (`cmCardNameAgrees`);
 *   · finns kortet redan hos oss (samma set, nummer, namn, ingen versionsetikett)
 *     LÄNKAS det (Card.cardmarketId när det saknas) i stället för att skapas — en
 *     tryckning med etikett ("Stamp") är däremot ett EGET kort, aldrig det vanliga;
 *   · setet väljs ur RÖSTER (de kort i CT-expansionen vi redan har länkade), annars
 *     exakt setnamn i samma språk. ⛔ I ett set vi REDAN HAR skapas aldrig kort — där
 *     länkas bara (vi har ofta kortet i ett underset med annat nummerformat: Shiny
 *     Vault, Galarian Gallery, Trainer Gallery). Nya kort föds bara i HELT NYA set;
 *   · bollmönstren ("Prismatic Evolutions - Poké Ball Reverse Holo") blir inga nya set:
 *     de ger våra befintliga variantprodukter ett Cardmarket-pris, och CardTrader-
 *     offern på dem tas bort (cardtrader-ball-reverse hoppar sedan över dem).
 *
 * Kortets `tcgExternalId = "cm:<idProduct>"`. Engelska prissätts därefter nattligen
 * av cardmarket-refresh (guide-reserven, eftersom länken bär idProduct); japanska av
 * `--refresh` här (steg i cardmarket-refresh.yml) — EN-jobbets frågor är språkgrindade.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cm-only-singles.ts            # torrkörning + statistik
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cm-only-singles.ts --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cm-only-singles.ts --refresh  # nattlig prisuppdatering
 *
 * SEDAN 2026-10-23 (ägaren: "de har kort vi saknar", Ancient Mew):
 *   --fill-ct-sets  saknade kort föds även i set VI byggt ur CT/CM (`externalId "ct:"`: WCD, League/
 *                   Miscellaneous Promos, Battle Academy, startdäck) — även onumrerade; aldrig i speglar
 *                   av pokemontcg.io-set (Radiant Collection, Pokémon GO) eller CT:s "Pokémon Center".
 *   --labelled      en tryckning med etikett i ett set vi har blir en VARIANTPRODUKT på vårt kort när
 *                   exakt ett kort delar namn + siffror och det bär ett ANNAT CM-id. Sällsynthetsord och
 *                   "SVP 190"-etiketter (säger inte vilken version) avstås.
 *   CM_ONLY_REPORT=<fil.json>  skriver överhoppade + "<fil>-planned.json" (det som skapas).
 *   Körd 2026-10-23: 783 kort + 50 varianter, alla prissatta.
 */
import { prisma } from "@/lib/db";
import { ctExpansions, ctGet, type CtExpansion } from "@/lib/cardtrader";
import {
  cmCardNameAgrees,
  cmNumberKey,
  cmSetNameKey,
  cmSetNameKeys,
  singlesHeadlineEur,
  upsertTodaySnapshots,
  type CmGuideFields,
} from "@/jobs/cardmarket-refresh";
import { getRatesOre, priceOreFromEur } from "@/lib/exchange-rate";
import { cardmarketJapaneseSingleUrl, cardmarketProductUrl } from "@/lib/marketplace-urls";
import { ctImageProxyUrl } from "@/lib/ct-image";
import { normalizeTitle, slugify, utcToday } from "@/lib/utils";
import { mapPool } from "@/lib/concurrency";
import { exitJob } from "@/lib/job-exit";
import { PRINT_VARIANT_LABELS, REVERSE_VARIANT_LABELS } from "@/lib/print-variant";
import {
  NON_EN_JP_EXPANSION,
  ballExpansion,
  cmOnlyGuidePrice,
  blueprintLanguage,
  numberKey,
  setNameContained,
  versionLabel,
  winningSet,
  type GapLanguage,
} from "@/lib/catalog-gap-identity";

/** Övriga variantgrupperingar vi inte modellerar än (Energy/Rocket-mönster m.fl.). */
const UNMODELLED_VARIANT_EXPANSION = /Reverse Holo$/i;

/** Setnamnets nyckel utan koden i parentes: "Pokémon Card 151 (SV2a)" → "pokemoncard151". */
/** Bara siffrorna i ett samlarnummer: "SWSH053" → "53", "053" → "53". */
const digitsKey = (n: string | null | undefined) => String(n ?? "").replace(/\/.*$/, "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");

const setKeyNoCode = (name: string) => cmSetNameKey(name.replace(/\s*\([^)]*\)\s*$/, ""));


const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
/** CardTraders kategori för Pokémon-singlar (mätt: 70 231 av 76 020 blueprints). */
const CT_SINGLE_CATEGORY = 73;
export const CM_ONLY_PREFIX = "cm:";

interface CmProduct { idProduct: number; name: string; idExpansion: number; dateAdded: string }
interface RawBlueprint {
  id: number;
  name: string;
  version: string | null;
  category_id: number;
  expansion_id: number;
  fixed_properties?: { collector_number?: string | null } | null;
  editable_properties?: { name: string; default_value?: string | null }[] | null;
  card_market_ids: number[] | null;
  image?: { url?: string | null } | null;
}
type Lang = GapLanguage;

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

async function guideMap(): Promise<Map<number, CmGuideFields>> {
  const g = await json<{ priceGuides: (CmGuideFields & { idProduct: number })[] }>(CM_GUIDE);
  return new Map(g.priceGuides.map((x) => [x.idProduct, x]));
}

/** Pris + lagerstatus ur prisguiden — se `cmOnlyGuidePrice` (low = CM:s From, annars uppskattning). */
function guideOffer(g: CmGuideFields | undefined, rates: Awaited<ReturnType<typeof getRatesOre>>): { priceOre: number; stock: "IN_STOCK" | "OUT_OF_STOCK" } | null {
  const priced = cmOnlyGuidePrice(g);
  const priceOre = priced ? priceOreFromEur(priced.eur, rates) : null;
  return priceOre == null ? null : { priceOre, stock: priced!.live ? "IN_STOCK" : "OUT_OF_STOCK" };
}

const offerUrl = (lang: Lang, id: number) =>
  lang === "JP" ? cardmarketJapaneseSingleUrl(id) : cardmarketProductUrl(id, { nearMint: true, firstEd: "exclude" });

async function importMissing(apply: boolean) {
  const [catalog, guide, rates, expansions] = await Promise.all([
    json<{ products: CmProduct[] }>(CM_SINGLES).then((d) => d.products),
    guideMap(),
    getRatesOre(),
    ctExpansions(),
  ]);
  const cmById = new Map(catalog.map((p) => [p.idProduct, p]));

  // Våra CM-länkar: kortets id + offerns idProduct → (setId, cardId).
  const linked = new Map<number, { setId: string; cardId: string }>();
  for (const c of await prisma.card.findMany({ where: { cardmarketId: { not: null } }, select: { id: true, setId: true, cardmarketId: true } }))
    linked.set(c.cardmarketId!, { setId: c.setId, cardId: c.id });
  const cmOffers: { url: string; setId: string | null; cardId: string | null }[] = await prisma.$queryRaw`
    SELECT o.url, p."setId", p."cardId" FROM "Offer" o
    JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'Cardmarket'
    JOIN "Product" p ON p.id = o."productId" WHERE p.category = 'SINGLE_CARD'`;
  for (const o of cmOffers) {
    const id = Number(/idProduct=(\d+)/.exec(o.url)?.[1] ?? NaN);
    if (Number.isFinite(id) && o.setId && o.cardId && !linked.has(id)) linked.set(id, { setId: o.setId, cardId: o.cardId });
  }
  console.log(`Cardmarket: ${catalog.length} singlar, varav ${linked.size} länkade hos oss. CardTrader: ${expansions.length} expansioner.`);

  // CardTraders blueprints, en expansion i taget (gratis API, ~860 anrop).
  const blueprints: { bp: RawBlueprint; exp: CtExpansion; lang: Lang }[] = [];
  const claims = new Map<number, number>();
  // Kortbilden: CardTraders blueprintbild via /api/ct-image (CM:s singelbilder går inte att
  // nå utan expansionskod — /api/cm-image gav 404 på alla 6 716 kort, 2026-10-15).
  const imageByCm = new Map<number, string>();
  let done = 0;
  const failedExpansions: string[] = [];
  for (const exp of expansions) {
    // CardTraders standardspråk är "en" även för McDonald's 2018 FRENCH — namnet avgör där.
    if (NON_EN_JP_EXPANSION.test(exp.name)) continue;
    // ⛔ Ett tyst [] såg ut som en tom expansion: försök igen med paus, och räkna det som misslyckas.
    let bps: RawBlueprint[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      try { bps = await ctGet<RawBlueprint[]>(`/blueprints/export?expansion_id=${exp.id}`); break; }
      catch (e) {
        if (attempt === 3) { failedExpansions.push(exp.name); console.warn(`  ⚠️ ${exp.name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
        else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    for (const bp of bps) {
      if (bp.category_id !== CT_SINGLE_CATEGORY) continue;
      for (const id of bp.card_market_ids ?? []) {
        claims.set(id, (claims.get(id) ?? 0) + 1);
        const img = ctImageProxyUrl(bp.id, bp.image?.url);
        if (img && !imageByCm.has(id)) imageByCm.set(id, img);
      }
      // Utan språkfält (Miscellaneous/Unnumbered Promos): bara CardTraders egen versionstext avgör
      // (Ancient Mew 2026-10-23) — inget annat gissas.
      const lang = blueprintLanguage(bp) ?? versionTextLanguage(bp.version);
      if (lang) blueprints.push({ bp, exp, lang });
    }
    if (++done % 100 === 0) console.log(`  … ${done}/${expansions.length} expansioner`);
    await new Promise((r) => setTimeout(r, 120));
  }

  if (failedExpansions.length) console.warn(`CardTrader: ${failedExpansions.length} expansioner gick inte att läsa — körningen är OFULLSTÄNDIG.`);

  await healImages(apply, imageByCm);

  imageByCmGlobal = imageByCm;
  const sets = await prisma.cardSet.findMany({ select: { id: true, name: true, language: true, externalId: true } });
  // Set vi själva byggt ur CardTraders/Cardmarkets katalog — ingen pokemontcg.io-numrering att
  // krocka med, så där får saknade kort skapas (--fill-ct-sets).
  const ctSetIds = new Set(sets.filter((x) => x.externalId?.startsWith("ct:")).map((x) => x.id));
  const setsByKey = new Map<string, string | null>();
  for (const s of await prisma.cardSet.findMany({ select: { id: true, name: true, language: true, series: true } })) {
    // Även utan setkoden i parentes: CT säger "DP Promos", vi "DP Promos (DP-P)".
    for (const key of new Set([...cmSetNameKeys(s), setKeyNoCode(s.name)])) {
      const k = `${s.language}|${key}`;
      setsByKey.set(k, setsByKey.has(k) ? null : s.id);
    }
  }
  // Alla våra kort på (språk|nummer|namn) → setnamnen — dubblettvakten för nya set.
  const cardIndex = new Map<string, { name: string; set: string }[]>();
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  for (const c of await prisma.card.findMany({ select: { setId: true, number: true, name: true, language: true } })) {
    const k = `${c.language}|${numberKey(c.number)}`;
    const l = cardIndex.get(k) ?? [];
    l.push({ name: c.name.replace(/ \(JP\)$/, ""), set: setName.get(c.setId) ?? "" });
    cardIndex.set(k, l);
  }
  const setCards = new Map<string, { id: string; number: string; name: string; cardmarketId: number | null }[]>();
  const cardsOf = async (setId: string) => {
    let l = setCards.get(setId);
    if (!l) {
      l = await prisma.card.findMany({ where: { setId }, select: { id: true, number: true, name: true, cardmarketId: true } });
      setCards.set(setId, l);
    }
    return l;
  };

  // Röster per CT-expansion: vilket av våra set bär de kort vi redan har länkade?
  const votes = new Map<number, Map<string, number>>();
  for (const { bp, exp } of blueprints)
    for (const id of bp.card_market_ids ?? []) {
      const hit = linked.get(id);
      if (!hit) continue;
      const v = votes.get(exp.id) ?? new Map<string, number>();
      v.set(hit.setId, (v.get(hit.setId) ?? 0) + 1);
      votes.set(exp.id, v);
    }

  const stats = {
    candidates: 0, ambiguous: 0, nameMismatch: 0, noNumber: 0, unpriced: 0, linkedExisting: 0,
    existingSetSkipped: 0, variantCreated: 0, createdInExistingSet: 0, sameCardElsewhere: 0, ballLinked: 0, ballUnmatched: 0, unmodelledVariant: 0, created: 0, setsCreated: 0,
  };
  // Bollvarianterna vi redan har: (språk|set utan kod|etikett|nummer) → produkt.
  const ballProducts = new Map<string, string | null>();
  for (const p of await prisma.product.findMany({
    where: { category: "SINGLE_CARD", variantLabel: { in: ["Poké Ball Reverse Holo", "Master Ball Reverse Holo"] } },
    select: { id: true, variantLabel: true, language: true, set: { select: { name: true } }, card: { select: { number: true } } },
  })) {
    if (!p.set || !p.card) continue;
    const k = `${p.language}|${setKeyNoCode(p.set.name)}|${p.variantLabel}|${numberKey(p.card.number)}`;
    ballProducts.set(k, ballProducts.has(k) ? null : p.id);
  }
  const ctRetailer = await prisma.retailer.findFirst({ where: { name: "CardTrader" }, select: { id: true } });
  const byExp = new Map<string, number>();
  const skipped: Record<string, unknown>[] = [];
  const planned: Record<string, unknown>[] = [];
  const newSetFor = new Map<string, string>();
  const usedCmIds = new Set(linked.keys());
  for (const { bp, exp, lang } of blueprints) {
    const ids = (bp.card_market_ids ?? []).filter((id) => !linked.has(id) && cmById.has(id));
    for (const idProduct of ids) {
      stats.candidates++;
      if ((claims.get(idProduct) ?? 0) > 1) { stats.ambiguous++; continue; }
      const cm = cmById.get(idProduct)!;
      if (!cmCardNameAgrees(bp.name, cm.name)) { stats.nameMismatch++; continue; }
      const number = String(bp.fixed_properties?.collector_number ?? "").trim();
      const unnumbered = !number;
      if (unnumbered && !FILL_CT) {
        stats.noNumber++;
        skipped.push({ exp: exp.name, name: bp.name, version: bp.version ?? null, idProduct, why: "no-number" });
        continue;
      }
      const priced = guideOffer(guide.get(idProduct), rates);
      if (priced == null) { stats.unpriced++; continue; }
      const { priceOre, stock } = priced;
      const label = cleanLabel(versionLabel(bp.version));

      // BOLLMÖNSTER → vår befintliga variantprodukt får Cardmarket-priset.
      const ball = ballExpansion(exp.name);
      if (ball) {
        const productId = ballProducts.get(`${lang}|${setKeyNoCode(ball.set)}|${ball.label}|${numberKey(number)}`);
        if (!productId) { stats.ballUnmatched++; continue; }
        stats.ballLinked++;
        usedCmIds.add(idProduct);
        if (!apply) continue;
        const cmRetailer = await cardmarketRetailerId();
        const key = { productId, retailerId: cmRetailer, condition: "NEAR_MINT" as const, language: lang };
        await prisma.offer.upsert({
          where: { productId_retailerId_condition_language: key },
          update: { price: priceOre, stockStatus: stock, url: offerUrl(lang, idProduct), lastSeenAt: new Date() },
          create: { ...key, price: priceOre, currency: "SEK", stockStatus: stock, url: offerUrl(lang, idProduct) },
        });
        if (ctRetailer) await prisma.offer.deleteMany({ where: { productId, retailerId: ctRetailer.id } });
        continue;
      }
      if (UNMODELLED_VARIANT_EXPANSION.test(exp.name)) {
        stats.unmodelledVariant++;
        skipped.push({ exp: exp.name, name: bp.name, number, label, idProduct, why: "unmodelled-variant" });
        continue;
      }

      // Setet: röster → exakt namn i samma språk → nytt.
      const existingSet = winningSet(votes.get(exp.id)) ?? setsByKey.get(`${lang}|${cmSetNameKey(exp.name)}`) ?? null;
      let setId = existingSet ?? newSetFor.get(`${exp.id}|${lang}`) ?? null;

      // Onumrerade kort föds bara i set vi själva byggt ur CT/CM (eller i ett helt nytt set).
      if (unnumbered && existingSet && !ctSetIds.has(existingSet)) {
        stats.noNumber++;
        skipped.push({ exp: exp.name, name: bp.name, version: bp.version ?? null, idProduct, why: "no-number" });
        continue;
      }
      // Ett set vi redan har: länka den vanliga tryckningen, skapa aldrig.
      if (existingSet) {
        const existing = label
          ? []
          : (await cardsOf(existingSet)).filter(
              (c) => numberKey(c.number) === numberKey(number) && cmCardNameAgrees(c.name.replace(/ \(JP\)$/, ""), bp.name)
            );
        if (existing.length === 1 && existing[0].cardmarketId == null && !usedCmIds.has(idProduct)) {
          const c = existing[0];
          if (apply) await prisma.card.update({ where: { id: c.id }, data: { cardmarketId: idProduct } }).catch(() => undefined);
          c.cardmarketId = idProduct;
          usedCmIds.add(idProduct);
          stats.linkedExisting++;
        } else if (
          // SAKNAS I ETT SET VI HAR (2026-10-15): inget kort i setet delar ens SIFFRORNA i
          // numret med samma namn ("053" mot vårt "SWSH053" är samma kort), och samma kort
          // finns inte i ett set med inneslutet namn. Då är det ett äkta hål (VSTAR Universe
          // JP saknade 114 kort, Mega Series Promos 36) och kortet föds i VÅRT set.
          // ⛔ BARA JAPANSKA: de engelska "hålen" var alla samma kort under annan stavning
          //    ("Golem E4" mot "Golem [4] Lv.52", "Coating Metal Energy" mot "Coating M Energy",
          //    Celebrations-korten i Classic Collection) — mätt 2026-10-15, 0 av 47 äkta.
          lang === "JP" &&
          !label &&
          existing.length === 0 &&
          !(await cardsOf(existingSet)).some((c) => digitsKey(c.number) === digitsKey(number) && cmCardNameAgrees(c.name.replace(/ \(JP\)$/, "").replace(/^Basic /i, ""), bp.name.replace(/^Basic /i, ""))) &&
          !(cardIndex.get(`${lang}|${numberKey(number)}`) ?? []).some((t) => cmCardNameAgrees(t.name, bp.name) && setNameContained(t.set, exp.name))
        ) {
          stats.createdInExistingSet++;
          byExp.set(`${lang} · ${sets.find((s) => s.id === existingSet)?.name} (befintligt set)`, (byExp.get(`${lang} · ${sets.find((s) => s.id === existingSet)?.name} (befintligt set)`) ?? 0) + 1);
          if (apply && (await createCard({ bp, exp, lang, idProduct, number, label, priceOre, stock, setId: existingSet, setName: sets.find((s) => s.id === existingSet)?.name ?? exp.name }))) usedCmIds.add(idProduct);
        } else if (
          FILL_CT &&
          ctSetIds.has(existingSet) &&
          !usedCmIds.has(idProduct) &&
          !(label && !isRealVariantLabel(label) && !unnumbered) &&
          // Speglar av pokemontcg.io-set (RC-underseten, Pokémon GO) — där finns korten redan.
          !CT_MIRROR_SET.test(sets.find((x) => x.id === existingSet)?.name ?? "") &&
          !(cardIndex.get(`${lang}|${numberKey(number)}`) ?? []).some(
            (t) => t.set !== sets.find((x) => x.id === existingSet)?.name && cmCardNameAgrees(t.name, bp.name) && setNameContained(t.set, exp.name)
          )
        ) {
          // CT/CM-BYGGT SET (League Promos, Miscellaneous Promos, WCD …): kortet saknas ⇒ det föds
          // här. idProduct är olänkad, och varje kort i ett sådant set bär sitt CM-id, så det
          // kan inte vara ett kort vi redan har under annan numrering.
          stats.createdInExistingSet++;
          const setName = sets.find((x) => x.id === existingSet)?.name ?? exp.name;
          planned.push({ kind: "ct-set", set: setName, name: bp.name, number, label, idProduct, priceOre });
          byExp.set(`${lang} · ${setName} (CT-set)`, (byExp.get(`${lang} · ${setName} (CT-set)`) ?? 0) + 1);
          if (!apply || (await createCard({ bp, exp, lang, idProduct, number, label, priceOre, stock, setId: existingSet, setName }))) usedCmIds.add(idProduct);
        } else if (LABELLED && label && isRealVariantLabel(label) && !usedCmIds.has(idProduct)) {
          // TRYCKNING MED ETIKETT I ETT SET VI HAR (2026-10-23, ägaren: "de har kort vi saknar"):
          // stämplade promos, Cosmos Holo, Prerelease, WCD-lekarnas kort … blir en VARIANTPRODUKT på
          // vårt kort. ⛔ Bara när EXAKT ett kort i setet delar siffrorna + namnet OCH det kortet
          // redan bär ett ANNAT CM-id (bevis för att idProduct är en egen vara, inte vårt kort
          // under ett annat namn). Rena sällsynthetsord ("Ultra Rare", "Holo Rare") är inga
          // varianter — det är vårt vanliga kort (isRealVariantLabel).
          const bases = (await cardsOf(existingSet)).filter(
            (c) => digitsKey(c.number) === digitsKey(number) && cmCardNameAgrees(c.name.replace(/ \(JP\)$/, ""), bp.name)
          );
          const base = bases.length === 1 ? bases[0] : null;
          const otherId = base ? base.cardmarketId ?? (await baseCmId(base.id)) : null;
          if (base && otherId != null && otherId !== idProduct) {
            stats.variantCreated++;
            planned.push({ kind: "variant", set: sets.find((x) => x.id === existingSet)?.name, name: bp.name, number, label, idProduct, priceOre });
            byExp.set(`${lang} · variant · ${label}`, (byExp.get(`${lang} · variant · ${label}`) ?? 0) + 1);
            if (apply && (await createVariant({ cardId: base.id, setId: existingSet, label, idProduct, lang, priceOre, stock }))) usedCmIds.add(idProduct);
            else if (!apply) usedCmIds.add(idProduct);
          } else {
            stats.existingSetSkipped++;
            skipped.push({ exp: exp.name, name: bp.name, number, label, idProduct, why: base ? "variant-base-unproven" : `variant-base-${bases.length}` });
          }
        } else {
          stats.existingSetSkipped++;
          // Varför? 0 kort med nummer + namn = kortet SAKNAS i vårt set (ofta en stämplad/
          // alternativ tryckning); 1 = vi har det redan med ett annat CM-id; >1 = tvetydigt.
          skipped.push({ exp: exp.name, set: sets.find((s) => s.id === existingSet)?.name, name: bp.name, number, label, idProduct, ours: existing.length, why: label ? "label" : existing.length === 0 ? "absent" : existing.length === 1 ? "has-other-id" : "ambiguous" });
        }
        continue;
      }

      // Kortet finns redan i ett set som är samma utgåva under annat namn ⇒ inte saknat.
      const twins = cardIndex.get(`${lang}|${numberKey(number)}`) ?? [];
      if (twins.some((t) => cmCardNameAgrees(t.name, bp.name) && setNameContained(t.set, exp.name))) { stats.sameCardElsewhere++; continue; }
      // CT:s "Pokémon Center" = stämplade SVP-promos vi redan har som "Specialversion" på promokortet.
      if (/^Pokémon Center$/.test(exp.name)) { stats.sameCardElsewhere++; continue; }

      const setName = setId ? sets.find((s) => s.id === setId)?.name ?? exp.name : exp.name;
      byExp.set(`${lang} · ${setName}`, (byExp.get(`${lang} · ${setName}`) ?? 0) + 1);
      stats.created++;
      planned.push({ kind: "new-set", set: setName, name: bp.name, number, label, idProduct, priceOre });
      if (!apply) continue;

      if (!setId) {
        // Samma CT-expansion kan bära både engelska och japanska tryck (Unnumbered Promos:
        // Ancient Mew) — det andra språkets set får eget id i stället för att krocka.
        const taken = await prisma.cardSet.findUnique({ where: { externalId: `ct:${exp.id}` }, select: { language: true } });
        const created = await prisma.cardSet.create({
          data: {
            name: exp.name,
            series: "Other",
            language: lang,
            // ⛔ INTE Cardmarkets dateAdded — det är när CM lade in produkten (WCD 2010 fick
            // "släppt 27 jan 2026"). Okänt datum = null ("–"); scripts/fix-cm-only-set-dates.ts
            // fyller i TCGdex riktiga datum där de finns.
            releaseDate: null,
            totalCards: 0,
            totalCardsFull: 0,
            externalId: taken && taken.language !== lang ? `ct:${exp.id}:${lang}` : `ct:${exp.id}`,
          },
          select: { id: true, name: true, language: true, externalId: true },
        });
        sets.push(created);
        setId = created.id;
        newSetFor.set(`${exp.id}|${lang}`, setId);
        stats.setsCreated++;
      }

      if (await createCard({ bp, exp, lang, idProduct, number, label, priceOre, stock, setId, setName })) usedCmIds.add(idProduct);
    }
  }

  if (apply) await healImages(apply, imageByCm);
  console.log(stats);
  if (process.env.CM_ONLY_REPORT) {
    const fs = await import("fs");
    fs.writeFileSync(process.env.CM_ONLY_REPORT, JSON.stringify(skipped, null, 1));
    fs.writeFileSync(process.env.CM_ONLY_REPORT.replace(/\.json$/, "-planned.json"), JSON.stringify(planned, null, 1));
    console.log(`Rapport över överhoppade: ${process.env.CM_ONLY_REPORT}`);
  }
  console.log([...byExp].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`).join("\n"));
  if (apply) {
    const { recomputeProductPriceCache } = await import("@/services/products");
    await recomputeProductPriceCache();
  } else console.log("Torrkörning — kör med --apply för att skriva.");
}


const LABELLED = process.argv.includes("--labelled");

/** "International Print" ⇒ EN, "Japanese …" ⇒ JP; koreanska/kinesiska och allt annat ⇒ null (avstå). */
function versionTextLanguage(version: string | null | undefined): Lang | null {
  const v = version ?? "";
  if (/\b(Korean|Chinese|Thai|Indonesian)\b/i.test(v)) return null;
  if (/\bInternational Print\b/.test(v)) return "EN";
  if (/\bJapanese\b/.test(v)) return "JP";
  return null;
}

/** Copyrightrader ("© 1999-2000 Wizards") är tryckets finstil, ingen etikett att visa. */
function cleanLabel(label: string): string {
  return label.split(" · ").map((p) => p.replace(/\s*©.*$/, "").trim()).filter(Boolean).join(" · ");
}
const FILL_CT = process.argv.includes("--fill-ct-sets");
const CT_MIRROR_SET = /^(Radiant Collection |Pokémon TCG: Pokémon GO$)/;

/** Etiketter som bara är en sällsynthet eller reverse holo — vårt vanliga kort, ingen egen vara. */
function isRealVariantLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  if (/^(common|uncommon|rare|rare holo|holo rare|ultra rare|secret rare|shiny rare|rare ultra|full art|promo|holo|non-holo|reverse ultra rare)$/.test(l)) return false;
  if (l.includes("reverse holo")) return false; // ägs av include_variants/CardTrader
  // Bara setkod + nummer ("SVP 190", "MEP 002") säger inte VILKEN version — avstå.
  if (/^[a-z]{2,5}[\s-]?\d{1,3}[a-z]?$/.test(l)) return false;
  return true;
}

/** Baskortets CM-id ur dess egen offer (när Card.cardmarketId saknas). */
async function baseCmId(cardId: string): Promise<number | null> {
  const o = await prisma.offer.findFirst({
    where: { retailer: { name: "Cardmarket" }, url: { contains: "idProduct=" }, product: { cardId, variantLabel: null } },
    select: { url: true },
  });
  const m = o ? /idProduct=(\d+)/.exec(o.url) : null;
  return m ? Number(m[1]) : null;
}

/** Variantprodukt (egen etikett, egen idProduct) på ett kort vi har. */
async function createVariant(a: { cardId: string; setId: string; label: string; idProduct: number; lang: Lang; priceOre: number; stock: "IN_STOCK" | "OUT_OF_STOCK" }): Promise<boolean> {
  const base = await prisma.product.findFirst({ where: { cardId: a.cardId, variantLabel: null }, select: { title: true, slug: true, imageUrl: true } });
  if (!base) return false;
  if (await prisma.product.findFirst({ where: { cardId: a.cardId, variantLabel: a.label }, select: { id: true } })) return false;
  const title = `${base.title} · ${a.label}`;
  const baseSlug = slugify(`${base.slug}-${a.label}`);
  const slug = (await prisma.product.findUnique({ where: { slug: baseSlug }, select: { id: true } })) ? `${baseSlug}-${a.idProduct}` : baseSlug;
  const product = await prisma.product.create({
    data: { title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", cardId: a.cardId, setId: a.setId, imageUrl: imageByCmGlobal.get(a.idProduct) ?? base.imageUrl, language: a.lang, variantLabel: a.label },
    select: { id: true },
  });
  await prisma.offer.create({
    data: { productId: product.id, retailerId: await cardmarketRetailerId(), condition: "NEAR_MINT", language: a.lang, price: a.priceOre, currency: "SEK", stockStatus: a.stock, url: offerUrl(a.lang, a.idProduct) },
    select: { id: true },
  });
  return true;
}

/** Skapar kort + produkt + Cardmarket-offer (uppskattning ur prisguiden). */
async function createCard(a: { bp: RawBlueprint; exp: CtExpansion; lang: Lang; idProduct: number; number: string; label: string; priceOre: number; stock: "IN_STOCK" | "OUT_OF_STOCK"; setId: string; setName: string }): Promise<boolean> {
  const { bp, exp, lang, idProduct, number, label, priceOre, stock, setId, setName } = a;
  const display = lang === "JP" ? `${bp.name} (JP)` : bp.name;
  const title = `${display} · ${setName}${number ? ` ${number}` : ""}${label ? ` · ${label}` : ""}`;
  const imageUrl = imageByCmGlobal.get(idProduct) ?? null;
  const card = await prisma.card
    .create({
      data: {
        setId, number, name: display, rarity: "Unknown", imageUrl, language: lang,
        tcgExternalId: `${CM_ONLY_PREFIX}${idProduct}`, cardmarketId: idProduct,
      },
      select: { id: true },
    })
    .catch((e) => {
      console.warn(`  ⚠️ ${title}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      return null;
    });
  if (!card) return false;
  const baseSlug = slugify(`${bp.name}-${lang === "JP" ? "jp-" : ""}${exp.code ?? exp.name}-${number}${label ? `-${label}` : ""}`);
  const slug = (await prisma.product.findUnique({ where: { slug: baseSlug }, select: { id: true } })) ? `${baseSlug}-${idProduct}` : baseSlug;
  const product = await prisma.product.create({
    data: { title, normalizedTitle: normalizeTitle(title), slug, category: "SINGLE_CARD", cardId: card.id, setId, imageUrl, language: lang },
    select: { id: true },
  });
  const cmRetailer = await cardmarketRetailerId();
  await prisma.offer.create({
    data: {
      productId: product.id, retailerId: cmRetailer, condition: "NEAR_MINT", language: lang,
      price: priceOre, currency: "SEK", stockStatus: stock, url: offerUrl(lang, idProduct),
    },
  });
  return true;
}

/**
 * BILDLAGNING för Cardmarket-only-kort utan bild. Körs FÖRE och EFTER skapandet — kort som föds i
 * körningen utan CardTrader-bild fick annars sin reserv först vid nästa körning (12 kort 2026-10-23).
 */
async function healImages(apply: boolean, imageByCm: Map<number, string>) {
  {
    const broken = await prisma.card.findMany({
      where: { tcgExternalId: { startsWith: CM_ONLY_PREFIX }, OR: [{ imageUrl: null }, { imageUrl: { startsWith: "/api/cm-image/" } }] },
      select: { id: true, cardmarketId: true },
    });
    let fixed = 0;
    await mapPool(broken, 8, async (c) => {
      const img = c.cardmarketId != null ? imageByCm.get(c.cardmarketId) : undefined;
      if (!img) return;
      fixed++;
      if (!apply) return;
      await prisma.card.update({ where: { id: c.id }, data: { imageUrl: img } });
      await prisma.product.updateMany({ where: { cardId: c.id }, data: { imageUrl: img } });
    });
    console.log(`Bilder: ${fixed} av ${broken.length} bildlösa Cardmarket-only-kort får CardTraders bild.`);
    // RESERV: omtrycket utan egen bild får ORIGINALETS bild (samma konst) — samma språk,
    // samma namn, samma siffror i numret. WCD 2023 + JP-startdäcken saknar bild både hos
    // CardTrader och Cardmarket (159 kort 2026-10-15). Bättre originalets konst än en tom ruta.
    const still = await prisma.card.findMany({
      where: { tcgExternalId: { startsWith: CM_ONLY_PREFIX }, OR: [{ imageUrl: null }, { imageUrl: { startsWith: "/api/cm-image/" } }] },
      select: { id: true, name: true, number: true, language: true, cardmarketId: true },
    });
    let borrowed = 0;
    for (const c of still) {
      if (c.cardmarketId != null && imageByCm.has(c.cardmarketId)) continue;
      const base = c.name.replace(/ \(JP\)$/, "");
      // Exakt namn först — prefixet "Poké" gav 200 andra kort och missade Poké Ball (JP) (2026-10-23).
      const notSelf = { imageUrl: { not: null }, NOT: [{ imageUrl: { startsWith: "/api/cm-image/" } }, { id: c.id }] };
      const exact = await prisma.card.findMany({
        where: { language: c.language, name: { in: [c.name, base, `${base} (JP)`] }, ...notSelf },
        select: { name: true, number: true, imageUrl: true },
        take: 200,
      });
      const twins = exact.length ? exact : await prisma.card.findMany({
        where: { language: c.language, name: { startsWith: base.split(" ")[0] }, ...notSelf },
        select: { name: true, number: true, imageUrl: true },
        take: 200,
      });
      const twin = twins.find((t) => digitsKey(t.number) === digitsKey(c.number) && cmCardNameAgrees(t.name.replace(/ \(JP\)$/, ""), base))
        ?? twins.find((t) => cmCardNameAgrees(t.name.replace(/ \(JP\)$/, ""), base) && cmCardNameAgrees(base, t.name.replace(/ \(JP\)$/, "")));
      if (!twin?.imageUrl) continue;
      borrowed++;
      if (!apply) continue;
      await prisma.card.update({ where: { id: c.id }, data: { imageUrl: twin.imageUrl } });
      await prisma.product.updateMany({ where: { cardId: c.id }, data: { imageUrl: twin.imageUrl } });
    }
    console.log(`Bilder: ${borrowed} omtryck utan egen bild fick originalets bild.`);
  }
}

/** Satt av importMissing (bilderna hämtas med blueprintsen) — läses av createCard. */
let imageByCmGlobal = new Map<number, string>();

let cmRetailerIdPromise: Promise<string> | null = null;
function cardmarketRetailerId(): Promise<string> {
  cmRetailerIdPromise ??= prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" }, select: { id: true } }).then((r) => r.id);
  return cmRetailerIdPromise;
}

/**
 * NATTLIG PRISUPPDATERING för de här korten — samma uppskattning ur prisguiden.
 * Hoppar över offers som redan rörts i dag (de engelska tar cardmarket-refreshs
 * guide-reserv, som kör före i samma workflow).
 */
async function refreshPrices() {
  const [guide, rates] = await Promise.all([guideMap(), getRatesOre()]);
  const today = utcToday();
  const cmRetailer = await cardmarketRetailerId();
  const cmSource = await prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  const clearOnly = process.argv.includes("--clear-only");
  const offers = await prisma.offer.findMany({
    where: {
      retailerId: cmRetailer,
      ...(process.argv.includes("--all") || clearOnly ? {} : { lastSeenAt: { lt: today } }),
      OR: [
        { product: { card: { tcgExternalId: { startsWith: CM_ONLY_PREFIX } } } },
        { product: { variantLabel: { in: ["Poké Ball Reverse Holo", "Master Ball Reverse Holo"] } } },
        // STÄMPLADE/JUMBO/METALL-TRYCKNINGAR (scripts/import-catalog-gap-printings.ts, 2026-10-23):
        // en variant med EGEN idProduct-länk prissätts på den produkten. Länkar utan idProduct
        // ("Specialversion" bär CM-slug) faller ur av sig själva — id:t går inte att läsa.
        {
          url: { contains: "idProduct=" },
          product: { variantLabel: { not: null, notIn: [...PRINT_VARIANT_LABELS, ...REVERSE_VARIANT_LABELS] } },
        },
      ],
    },
    select: { id: true, productId: true, url: true, price: true },
  });
  const points: { productId: string; priceOre: number }[] = [];
  let cleared = 0;
  await mapPool(offers, 8, async (o) => {
    // Länken bär produktens idProduct — för bollvarianterna är kortets cardmarketId det VANLIGA kortets.
    const id = Number(/idProduct=(\d+)/.exec(o.url)?.[1] ?? NaN);
    const row = Number.isFinite(id) ? guide.get(id) : undefined;
    const priced = row ? guideOffer(row, rates) : null;
    // Guiden HAR raden men den bär inget pris vi kan stå för ⇒ nolla gårdagens tal i stället för att
    // låta det stå fruset (Pikachu XY-P7af stod på 1 118 000 kr). Saknas raden helt rör vi inget.
    if (priced == null) {
      if (row && o.price != null) {
        await prisma.offer.update({ where: { id: o.id }, data: { price: null, stockStatus: "OUT_OF_STOCK", lastSeenAt: new Date() } });
        cleared++;
      }
      return;
    }
    if (clearOnly) return;
    await prisma.offer.update({ where: { id: o.id }, data: { price: priced.priceOre, stockStatus: priced.stock, lastSeenAt: new Date() } });
    points.push({ productId: o.productId, priceOre: priced.priceOre });
  });
  if (cmSource && points.length) {
    await prisma.priceObservation.createMany({ data: points.map((p) => ({ productId: p.productId, sourceId: cmSource.id, price: p.priceOre, currency: "SEK" })) });
    await upsertTodaySnapshots(points, today);
  }
  const { recomputeProductPriceCache } = await import("@/services/products");
  await recomputeProductPriceCache();
  console.log(`[cm-only] ${points.length} av ${offers.length} Cardmarket-only-kort/bollvarianter prissatta ur prisguiden, ${cleared} utan stödbart pris nollade.`);
}

const args = process.argv.slice(2);
(args.includes("--refresh") ? refreshPrices() : importMissing(args.includes("--apply")))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => exitJob());
