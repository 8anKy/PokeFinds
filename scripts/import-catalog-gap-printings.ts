/**
 * KATALOGLUCKOR SOM DE VANLIGA IMPORTERNA INTE NÅR (2026-10-23, ägaren: "rarefinds har kort vi
 * saknar fast vi har samma API" + en användares lista: numrerslösa energier, Shrouded Fables
 * bollenergier).
 *
 * Revision samma dag mot leverantörens HELA engelska feed (23 426 rader, 187 episoder, en
 * hämtning à 100 kort): bara 283 rader saknas hos oss, och INGEN hel episod. Luckorna är
 * tryckningar som är EGNA Cardmarket-produkter men delar namn + nummer med ett kort vi redan
 * har — och därför fälls av regeln "i set vi har skapas aldrig kort" (scripts/import-cm-only-
 * singles.ts, skäl: underset med annat nummerformat gav dubbletter). Tre lägen:
 *
 *   --energies           NUMMERLÖSA BASENERGIER (Cardmarkets expansion "Unnumbered Energies").
 *                        Ett nytt set — de har inget nummer, så import-cm-only-singles hoppar
 *                        över dem ("noNumber"). Numret blir ÅRET (samma form som de 23 som redan
 *                        ligger i "League Promos": "Grass Energy · League Promos 2007").
 *                        Identitet: CardTrader måste göra anspråk på produkten, och året tas ur
 *                        CT:s etikett ("2013 Unnumbered") eller CM:s inläggningsdatum när CM lade in
 *                        produkten samma år som serien kom (2017/2019/2020/2022 — bekräftat mot CT:s
 *                        expansion: Sun & Moon, Team Up, Sword & Shield, Brilliant Stars).
 *                        ⛔ En CT-rad med ett RIKTIGT nummer ("122/123") är ett numrerat kort, inte
 *                        en nummerlös energi ⇒ hoppas över (CM:s batch 2022-04-13).
 *   --sfa-energies       SHROUDED FABLES ENERGIER med Poké Ball-mönster: Cardmarket listar dem i
 *                        "Scarlet & Violet Energies" (samma namn som SVE 001–008), CardTrader
 *                        som "Shrouded Fable · Reverse Holo". Blir BOLLVARIANTER på våra SVE 1–8
 *                        — samma modell och samma nattliga prisväg som övriga bollvarianter
 *                        (import-cm-only-singles.ts --refresh).
 *   --provider-variants  STÄMPLADE / JUMBO / METALL-tryckningar i set vi har (Staff, Pokémon
 *                        Center, Prerelease, Oversized …): en VARIANTPRODUKT på det befintliga
 *                        kortet (tryckningen är identitet — base-printings.md), aldrig ett nytt kort.
 *                        ⛔ VÄGRAR --apply tills `runVariantRefresh` (cardmarket-refresh.ts) undantar
 *                        varianter med egen idProduct-länk — annars skriver den kortets
 *                        pokemontcg.io-trend (BASKORTETS pris) över varje variant varje natt.
 *
 * PRIS: Cardmarkets prisguide på produktens egen idProduct (`cmOnlyGuidePrice`, samma regel som
 * CM-only-korten: low = From, vakt från 2 €). Nattligen av import-cm-only-singles.ts --refresh.
 * Aldrig ett påhittat pris: utan guiderad blir offern "–".
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-catalog-gap-printings.ts --energies [--apply]
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-catalog-gap-printings.ts --sfa-energies [--apply]
 *   npx railway run --service PokeFinds -- npx tsx scripts/import-catalog-gap-printings.ts --provider-variants
 *     (leverantörsnyckeln finns bara i Railway/GH; utan den läses `--provider-cache <fil>`)
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";
import { ctExpansions, ctGet } from "@/lib/cardtrader";
import { ctImageProxyUrl } from "@/lib/ct-image";
import { cardmarketProductUrl } from "@/lib/marketplace-urls";
import { getRatesOre, priceOreFromEur } from "@/lib/exchange-rate";
import { cmOnlyGuidePrice } from "@/lib/catalog-gap-identity";
import { PRINT_VARIANT_LABELS, REVERSE_VARIANT_LABELS, VARIANT_POKE_BALL, printLabelFromVersion } from "@/lib/print-variant";
import { cmCardNameAgrees, cmNumberKey, cmNumberKeyNoSetCode, cmNumberKeyOriginCode } from "@/jobs/cardmarket-refresh";
import { normalizeTitle, slugify } from "@/lib/utils";
import { exitJob } from "@/lib/job-exit";

const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
/** Cardmarkets expansion "Unnumbered Energies" (80 produkter 2026-10-23). */
const CM_UNNUMBERED_ENERGIES = 6697;
const UNNUMBERED_SET = { name: "Unnumbered Energies", externalId: `cm-exp:${CM_UNNUMBERED_ENERGIES}` };
const CT_SINGLE_CATEGORY = 73;
const CM_ONLY_PREFIX = "cm:";
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

interface CmProduct { idProduct: number; name: string; idExpansion: number; dateAdded: string }
interface GuideRow { idProduct: number; low?: number | null; trend?: number | null; avg?: number | null; avg30?: number | null; avg7?: number | null }
interface Bp { id: number; name: string; version: string | null; category_id: number; fixed_properties?: { collector_number?: string | null } | null; card_market_ids?: number[] | null; image?: { url?: string | null } | null }
interface CtClaim { bp: Bp; exp: string }

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

/** CardTraders blueprints per CM-id (singlar, alla expansioner — gratis API, ~860 anrop). */
async function ctClaims(): Promise<Map<number, CtClaim[]>> {
  const out = new Map<number, CtClaim[]>();
  const exps = await ctExpansions();
  let n = 0;
  for (const exp of exps) {
    const bps = await ctGet<Bp[]>(`/blueprints/export?expansion_id=${exp.id}`).catch(() => [] as Bp[]);
    for (const bp of bps) {
      if (bp.category_id !== CT_SINGLE_CATEGORY) continue;
      for (const id of bp.card_market_ids ?? []) out.set(id, [...(out.get(id) ?? []), { bp, exp: exp.name }]);
    }
    if (++n % 200 === 0) console.log(`  … CardTrader ${n}/${exps.length}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

/** Alla idProduct vi redan bär: kortets cardmarketId + CM-offerns länk. */
async function linkedCmIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const c of await prisma.card.findMany({ where: { cardmarketId: { not: null } }, select: { cardmarketId: true } })) ids.add(c.cardmarketId!);
  for (const o of await prisma.offer.findMany({ where: { retailer: { name: "Cardmarket" }, url: { contains: "idProduct=" } }, select: { url: true } })) {
    const m = /idProduct=(\d+)/.exec(o.url);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

let cmRetailerId: string | null = null;
async function cardmarketRetailerId(): Promise<string> {
  cmRetailerId ??= (await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" }, select: { id: true } })).id;
  return cmRetailerId;
}

async function uniqueSlug(base: string, idProduct: number): Promise<string> {
  const s = slugify(base);
  return (await prisma.product.findUnique({ where: { slug: s }, select: { id: true } })) ? `${s}-${idProduct}` : s;
}

/** Offer ur prisguiden (eller "–" när guiden inte bär ett pris vi kan stå för). */
function guideOffer(g: GuideRow | undefined, rates: Awaited<ReturnType<typeof getRatesOre>>) {
  const priced = cmOnlyGuidePrice(g);
  const price = priced ? priceOreFromEur(priced.eur, rates) : null;
  return { price, stockStatus: price != null && priced!.live ? ("IN_STOCK" as const) : ("OUT_OF_STOCK" as const) };
}

// ── --energies ──────────────────────────────────────────────────────────────
const YEAR_RE = /\b(?:19|20)\d\d\b/;

async function importUnnumberedEnergies() {
  const [catalog, guide, rates, claims, linked] = await Promise.all([
    json<{ products: CmProduct[] }>(CM_SINGLES).then((d) => d.products.filter((p) => p.idExpansion === CM_UNNUMBERED_ENERGIES)),
    json<{ priceGuides: GuideRow[] }>(CM_GUIDE).then((d) => new Map(d.priceGuides.map((g) => [g.idProduct, g]))),
    getRatesOre(),
    ctClaims(),
    linkedCmIds(),
  ]);
  const stats = { products: catalog.length, linked: 0, noClaim: 0, numbered: 0, noYear: 0, ambiguous: 0, created: 0 };
  const plan: { p: CmProduct; year: string; image: string | null }[] = [];
  for (const p of catalog) {
    if (linked.has(p.idProduct)) { stats.linked++; continue; }
    const claim = (claims.get(p.idProduct) ?? [])[0];
    if (!claim) { stats.noClaim++; continue; }
    const num = String(claim.bp.fixed_properties?.collector_number ?? "").trim();
    // Ett riktigt samlarnummer ("122/123") = ett numrerat kort som CM råkar ha lagt här.
    if (num && !YEAR_RE.test(num) && !/^©/.test(num)) { stats.numbered++; continue; }
    const ctYear = `${claim.bp.version ?? ""} ${num}`.match(YEAR_RE)?.[0];
    const added = p.dateAdded.slice(0, 4);
    const year = ctYear ?? (added < "2026" && added !== "0000" ? added : null);
    if (!year) { stats.noYear++; continue; }
    plan.push({ p, year, image: ctImageProxyUrl(claim.bp.id, claim.bp.image?.url) });
  }
  // Samma namn + år två gånger = vi kan inte skilja dem åt ⇒ ingen av dem.
  const key = (x: { p: CmProduct; year: string }) => `${x.p.name}|${x.year}`;
  const counts = new Map<string, number>();
  for (const x of plan) counts.set(key(x), (counts.get(key(x)) ?? 0) + 1);
  const go = plan.filter((x) => {
    if (counts.get(key(x))! > 1) { stats.ambiguous++; return false; }
    return true;
  });
  for (const x of go.sort((a, b) => a.year.localeCompare(b.year) || a.p.name.localeCompare(b.p.name)))
    console.log(`  ${x.year} · ${x.p.name} (idProduct ${x.p.idProduct})${x.image ? "" : " · utan bild"}`);
  stats.created = go.length;
  console.log(stats);
  if (!APPLY || !go.length) return;

  const set =
    (await prisma.cardSet.findUnique({ where: { externalId: UNNUMBERED_SET.externalId }, select: { id: true } })) ??
    (await prisma.cardSet.create({
      // Datum okänt (årgångarna spänner 2005–2022) ⇒ null; slugen sätts av backfill-set-slugs.ts.
      data: { name: UNNUMBERED_SET.name, series: "Other", language: "EN", releaseDate: null, totalCards: 0, totalCardsFull: 0, externalId: UNNUMBERED_SET.externalId },
      select: { id: true },
    }));
  const cm = await cardmarketRetailerId();
  for (const { p, year, image } of go) {
    const title = `${p.name} · ${UNNUMBERED_SET.name} ${year}`;
    const card = await prisma.card.create({
      data: { setId: set.id, number: year, name: p.name, rarity: "Unknown", imageUrl: image, language: "EN", supertype: "Energy", tcgExternalId: `${CM_ONLY_PREFIX}${p.idProduct}`, cardmarketId: p.idProduct },
      select: { id: true },
    });
    const product = await prisma.product.create({
      data: { title, normalizedTitle: normalizeTitle(title), slug: await uniqueSlug(`${p.name}-unnumbered-${year}`, p.idProduct), category: "SINGLE_CARD", cardId: card.id, setId: set.id, imageUrl: image, language: "EN" },
      select: { id: true },
    });
    await prisma.offer.create({
      data: { productId: product.id, retailerId: cm, condition: "NEAR_MINT", language: "EN", currency: "SEK", url: cardmarketProductUrl(p.idProduct, { nearMint: true, firstEd: "exclude" }), ...guideOffer(guide.get(p.idProduct), rates) },
      select: { id: true },
    });
  }
  console.log(`Skapade ${go.length} kort i "${UNNUMBERED_SET.name}".`);
}

// ── --sfa-energies ──────────────────────────────────────────────────────────
async function importSfaEnergies() {
  const [catalog, guide, rates, claims, linked] = await Promise.all([
    json<{ products: CmProduct[] }>(CM_SINGLES).then((d) => d.products),
    json<{ priceGuides: GuideRow[] }>(CM_GUIDE).then((d) => new Map(d.priceGuides.map((g) => [g.idProduct, g]))),
    getRatesOre(),
    ctClaims(),
    linkedCmIds(),
  ]);
  const sve = await prisma.card.findMany({
    where: { set: { externalId: "sve" } },
    select: { id: true, name: true, number: true, setId: true, imageUrl: true, products: { select: { id: true, title: true, slug: true, variantLabel: true } } },
  });
  const cm = await cardmarketRetailerId();
  let created = 0;
  for (const p of catalog) {
    const claim = (claims.get(p.idProduct) ?? []).find((c) => c.exp === "Shrouded Fable" && /reverse holo/i.test(c.bp.version ?? ""));
    if (!claim || !/^Basic \w+ Energy$/.test(p.name) || linked.has(p.idProduct)) continue;
    // Namnet avgör (CT:s nummer har skrivfel: Psychic "004"/"#005"), och bara SVE 1–8.
    const targets = sve.filter((c) => c.name === p.name && Number(c.number) >= 1 && Number(c.number) <= 8);
    if (targets.length !== 1) { console.log(`  ⚠️ ${p.name}: ${targets.length} SVE-kort med namnet — hoppar`); continue; }
    const card = targets[0];
    if (card.products.some((x) => x.variantLabel === VARIANT_POKE_BALL)) { console.log(`  ${p.name}: har redan bollvarianten`); continue; }
    const base = card.products.find((x) => x.variantLabel == null);
    if (!base) continue;
    const title = `${base.title} · ${VARIANT_POKE_BALL} (Shrouded Fable)`;
    const image = ctImageProxyUrl(claim.bp.id, claim.bp.image?.url) ?? card.imageUrl;
    console.log(`  ${title} ← idProduct ${p.idProduct}`);
    created++;
    if (!APPLY) continue;
    const product = await prisma.product.create({
      data: { title, normalizedTitle: normalizeTitle(title), slug: await uniqueSlug(`${base.slug}-poke-ball-reverse-holo`, p.idProduct), category: "SINGLE_CARD", cardId: card.id, setId: card.setId, imageUrl: image, language: "EN", variantLabel: VARIANT_POKE_BALL },
      select: { id: true },
    });
    await prisma.offer.create({
      data: { productId: product.id, retailerId: cm, condition: "NEAR_MINT", language: "EN", currency: "SEK", url: cardmarketProductUrl(p.idProduct, { nearMint: true, firstEd: "exclude" }), ...guideOffer(guide.get(p.idProduct), rates) },
      select: { id: true },
    });
  }
  console.log(`Shrouded Fable-energier: ${created} bollvarianter${APPLY ? " skapade" : " (torrkörning)"}.`);
}

// ── --provider-variants ─────────────────────────────────────────────────────
interface ProviderCard { id: number; name: string; card_number: string | number | null; rarity: string | null; version?: string | null; tcgid: string | null; cardmarket_id: number | null; lang?: string | null; _ep: number }
interface Episode { id: number; name: string }

async function providerFeed(): Promise<{ episodes: Episode[]; cards: ProviderCard[] }> {
  const cacheArg = args.includes("--provider-cache") ? args[args.indexOf("--provider-cache") + 1] : null;
  if (cacheArg) return JSON.parse(fs.readFileSync(path.resolve(cacheArg), "utf8"));
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas — kör via `npx railway run` eller ge --provider-cache <fil>");
  const api = async (p: string) => {
    const r = await fetch(`https://${HOST}${p}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY } });
    if (!r.ok) throw new Error(`${r.status} ${p}`);
    await new Promise((res) => setTimeout(res, 230));
    return r.json() as Promise<{ data: any[]; paging: { total: number } }>;
  };
  const episodes: Episode[] = [];
  for (let page = 1; page <= 40; page++) {
    const d = await api(`/pokemon/episodes?page=${page}`);
    episodes.push(...d.data);
    if (!d.data.length || page >= d.paging.total) break;
  }
  const cards: ProviderCard[] = [];
  // per_page=100 (mätt 2026-10-23): hela feeden på ~360 anrop i stället för ~1 200.
  for (const ep of episodes)
    for (let page = 1; page <= 30; page++) {
      const d = await api(`/pokemon/episodes/${ep.id}/cards?page=${page}&per_page=100`);
      cards.push(...d.data.map((c) => ({ ...c, _ep: ep.id })));
      if (!d.data.length || page >= d.paging.total) break;
    }
  return { episodes, cards };
}

/** Etiketten för en tryckning som inte är kortets ordinarie: leverantörens `version`, annars formatet. */
export function providerPrintingLabel(version: string | null | undefined, rarity: string | null | undefined): string | null {
  const v = (version ?? "").trim();
  if (v) return v;
  if (/oversized/i.test(rarity ?? "")) return "Oversized";
  return null;
}

function runVariantRefreshExcludesOwnCmLinks(): boolean {
  const src = fs.readFileSync(path.join(process.cwd(), "src/jobs/cardmarket-refresh.ts"), "utf8");
  const start = src.indexOf("export async function runVariantRefresh");
  const body = start >= 0 ? src.slice(start, src.indexOf("\n}\n", start)) : "";
  return /idProduct=/.test(body);
}

async function importProviderVariants() {
  const guardOk = runVariantRefreshExcludesOwnCmLinks();
  if (APPLY && !guardOk)
    throw new Error("runVariantRefresh undantar inte varianter med egen idProduct-länk — då skrivs baskortets trend över dem varje natt. Fixa det först.");
  const [{ episodes, cards }, guide, rates, linked] = await Promise.all([
    providerFeed(),
    json<{ priceGuides: GuideRow[] }>(CM_GUIDE).then((d) => new Map(d.priceGuides.map((g) => [g.idProduct, g]))),
    getRatesOre(),
    linkedCmIds(),
  ]);
  const ours = await prisma.card.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, number: true, setId: true, imageUrl: true, cardmarketId: true, tcgExternalId: true, products: { select: { title: true, slug: true, variantLabel: true } } },
  });
  const byTcg = new Map(ours.filter((c) => c.tcgExternalId).map((c) => [c.tcgExternalId!, c]));
  const byCm = new Map(ours.filter((c) => c.cardmarketId != null).map((c) => [c.cardmarketId!, c]));
  const bySet = new Map<string, typeof ours>();
  for (const c of ours) bySet.set(c.setId, [...(bySet.get(c.setId) ?? []), c]);

  // Episod → vårt set: rösterna från de rader vi redan matchat (samma regel som cardmarket-refresh punkt 5).
  const votes = new Map<number, Map<string, number>>();
  for (const r of cards) {
    const hit = (r.tcgid && byTcg.get(r.tcgid)) || (r.cardmarket_id != null && byCm.get(r.cardmarket_id)) || null;
    if (!hit) continue;
    const v = votes.get(r._ep) ?? new Map<string, number>();
    v.set(hit.setId, (v.get(hit.setId) ?? 0) + 1);
    votes.set(r._ep, v);
  }
  const setOf = (ep: number) => {
    const v = votes.get(ep);
    if (!v) return null;
    const [best, n] = [...v].sort((a, b) => b[1] - a[1])[0];
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    return n >= 3 && n / total >= 0.8 ? best : null;
  };

  const special = new Set<string>([...PRINT_VARIANT_LABELS, ...REVERSE_VARIANT_LABELS]);
  const stats: Record<string, number> = { candidates: 0, unlabelled: 0, noSet: 0, noCard: 0, ambiguousCard: 0, hasLabel: 0, hasOtherSpecial: 0, create: 0 };
  const byLabel = new Map<string, number>();
  const plan: { r: ProviderCard; card: (typeof ours)[number]; label: string }[] = [];
  const claimed = new Set<number>();
  for (const r of cards) {
    if ((r.lang ?? "en") !== "en" || r.cardmarket_id == null || linked.has(r.cardmarket_id) || claimed.has(r.cardmarket_id)) continue;
    stats.candidates++;
    const label = providerPrintingLabel(r.version, r.rarity);
    if (!label) { stats.unlabelled++; continue; }
    // ⛔ Unlimited/Shadowless/1st Edition är TRYCKNINGAR med egen regel (base-printings.md: bara Base
    //    delas, de nio andra WOTC-seten har EN CM-produkt per kort) — aldrig en variant härifrån.
    if (printLabelFromVersion(label)) { stats.printing = (stats.printing ?? 0) + 1; continue; }
    const setId = setOf(r._ep);
    if (!setId) { stats.noSet++; continue; }
    const keys = new Set([cmNumberKey(r.card_number), cmNumberKeyNoSetCode(r.card_number), cmNumberKeyOriginCode(r.card_number)].filter(Boolean));
    const hits = (bySet.get(setId) ?? []).filter(
      (c) => (keys.has(cmNumberKey(c.number)) || keys.has(cmNumberKeyNoSetCode(c.number))) && cmCardNameAgrees(c.name, r.name)
    );
    if (hits.length === 0) { stats.noCard++; continue; }
    if (hits.length > 1) { stats.ambiguousCard++; continue; }
    const card = hits[0];
    if (card.products.some((p) => p.variantLabel === label)) { stats.hasLabel++; continue; }
    // ⛔ Kortet har redan en specialvariant ("Specialversion" = CM:s V2 via pokemontcg.io) — vi kan
    //    inte se om det är SAMMA tryckning (länken bär slug, inget idProduct). Hellre en lucka än en dubblett.
    if (card.products.some((p) => p.variantLabel != null && !special.has(p.variantLabel))) { stats.hasOtherSpecial++; continue; }
    claimed.add(r.cardmarket_id);
    plan.push({ r, card, label });
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }
  stats.create = plan.length;
  console.log(stats);
  console.log([...byLabel].sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`).join("\n"));
  for (const x of plan.slice(0, 15)) console.log(`  ex: ${x.card.products.find((p) => p.variantLabel == null)?.title ?? x.card.name} · ${x.label} ← ${x.r.cardmarket_id}`);
  if (!guardOk) console.log("⚠️ runVariantRefresh undantar ännu inte egna idProduct-länkar — --apply vägras tills den gör det.");
  void episodes;
  if (!APPLY) return;

  const cm = await cardmarketRetailerId();
  for (const { r, card, label } of plan) {
    const base = card.products.find((p) => p.variantLabel == null);
    if (!base) continue;
    const title = `${base.title} · ${label}`;
    const product = await prisma.product.create({
      data: { title, normalizedTitle: normalizeTitle(title), slug: await uniqueSlug(`${base.slug}-${label}`, r.cardmarket_id!), category: "SINGLE_CARD", cardId: card.id, setId: card.setId, imageUrl: card.imageUrl, language: "EN", variantLabel: label },
      select: { id: true },
    });
    await prisma.offer.create({
      data: { productId: product.id, retailerId: cm, condition: "NEAR_MINT", language: "EN", currency: "SEK", url: cardmarketProductUrl(r.cardmarket_id!, { nearMint: true, firstEd: "exclude" }), ...guideOffer(guide.get(r.cardmarket_id!), rates) },
      select: { id: true },
    });
  }
  console.log(`Skapade ${plan.length} variantprodukter.`);
}

async function main() {
  if (args.includes("--energies")) await importUnnumberedEnergies();
  if (args.includes("--sfa-energies")) await importSfaEnergies();
  if (args.includes("--provider-variants")) await importProviderVariants();
  if (!["--energies", "--sfa-energies", "--provider-variants"].some((a) => args.includes(a)))
    console.log("Ange --energies, --sfa-energies och/eller --provider-variants (torrkörning utan --apply).");
  if (APPLY) {
    const { recomputeProductPriceCache } = await import("@/services/products");
    await recomputeProductPriceCache();
  } else console.log("Torrkörning — lägg till --apply för att skriva.");
}

main().then(
  () => exitJob(0),
  (e) => {
    console.error(e);
    return exitJob(1);
  }
);
