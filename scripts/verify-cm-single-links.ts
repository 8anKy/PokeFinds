/**
 * SINGEL-LÄNKAR MOT CARDMARKET — pekar de på RÄTT produkt?
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-cm-single-links.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-cm-single-links.ts --apply
 *
 * PROBLEMET (rapporterat 2026-08-07): Rayquaza VMAX · Evolving Skies 111/203
 * länkade till Cardmarkets OVERSIZED-version ("Attention: Oversized Card, Not
 * Tournament Legal") i stället för det vanliga kortet. Länken kom från en löst
 * redirect, och redirecten landade på fel av CM:s versioner.
 *
 * ⛔ CM:S EGEN DATA KAN INTE SKILJA DEM ÅT. Alla Rayquaza VMAX-rader i den publika
 *    katalogen har IDENTISKT namn ("Rayquaza VMAX [Azure Pulse | Max Burst]") och
 *    samma `idMetacard`; bara `idProduct` skiljer. 10 060 av 57 964 namn+expansion-
 *    kombinationer har flera versioner, så det är systemiskt. Versionssuffixet i
 *    slugen duger inte heller som signal: 4 155 av våra länkar har ett, och de
 *    flesta är korrekta (Eevee V5/V6/V7 ÄR olika promokort).
 * ⛔ OCH VI KAN INTE KONTROLLERA GENOM ATT HÄMTA SIDAN — Cardmarket blockerar
 *    automatiserade sidhämtningar (33 av 33 stickprov nekades).
 *
 * DÄRFÖR CARDTRADER. Deras katalog har ett blueprint PER samlarnummer med
 * `card_market_ids` — för Evolving Skies: 111 → 574159, 217 → 574275, 218 → 574276.
 * Samma kedja som `recover-cm-idproduct.ts` redan använder, med samma två oberoende
 * namnvakter (CardTraders eget namn OCH Cardmarkets singelkatalog).
 *
 * FAS 1 ÄR ETT FACIT, INTE EN REPARATION: 3 500+ av våra länkar bär redan ett
 * uttryckligt idProduct. Stämmer CardTrader överens med dem är källan bevisad på
 * riktig data innan en enda slug-länk skrivs om. Gör den inte det avbryts körningen.
 *
 * ⛔ TRYCKNINGAR (`variantLabel`) RÖRS ALDRIG. Base Unlimited/Shadowless/1st Edition
 *    delar CM-produkter på ett sätt CardTrader inte modellerar, och deras länkar är
 *    satta för hand av split-base-printings + fix-cm-firsted-links.
 */
import { prisma } from "../src/lib/db";
import { cmCardNameAgrees, fetchCmSingleNames, guideRowIsSingle } from "../src/jobs/cardmarket-refresh";
import { ctBlueprints, ctExpansions, ctNumberKey, isSingleBlueprint, matchExpansion, type CtBlueprint } from "../src/lib/cardtrader";
import { cardmarketProductUrl } from "../src/lib/marketplace-urls";

const APPLY = process.argv.includes("--apply");
/** Avbryt om CardTrader motsäger fler än så här stor andel av våra kända id:n. */
const MAX_DISAGREEMENT = 0.05;

interface Row {
  productId: string;
  title: string;
  cardName: string | null;
  number: string | null;
  setId: string | null;
  offerId: string;
  url: string;
}

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Ingen Cardmarket-retailer");

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id AS "productId", p.title, c.name AS "cardName", c.number,
           p."setId" AS "setId", o.id AS "offerId", o.url
    FROM "Product" p
    JOIN "Offer" o ON o."productId" = p.id AND o."retailerId" = ${cm.id}
    LEFT JOIN "Card" c ON c.id = p."cardId"
    WHERE p.category = 'SINGLE_CARD'
      AND p."variantLabel" IS NULL
      AND c.id IS NOT NULL
    ORDER BY p.title
  `;
  console.log(`Ordinarie singlar med CM-länk: ${rows.length}`);
  const known = rows.filter((r) => /idProduct=(\d+)/.test(r.url));
  const slugs = rows.filter((r) => !/idProduct=/.test(r.url));
  console.log(`  varav med uttryckligt idProduct (facit): ${known.length}`);
  console.log(`  varav slug-länkar (kan skrivas om):      ${slugs.length}\n`);

  const cmNames = await fetchCmSingleNames();
  if (cmNames.size === 0) throw new Error("CM:s singelkatalog gick inte att hämta — avbryter");

  // idProducts som redan ägs (unikhetsvakten).
  const owned = new Map<number, string>();
  for (const r of rows) {
    const id = Number(r.url.match(/idProduct=(\d+)/)?.[1] ?? NaN);
    if (Number.isFinite(id)) owned.set(id, r.productId);
  }

  const sets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: { id: true, name: true, series: true },
  });
  const expansions = await ctExpansions();

  const byProduct = new Map<string, number>(); // productId → CT:s idProduct
  const skips = { noExpansion: 0, noBlueprint: 0, ctName: 0, noMkm: 0, notInCatalog: 0, cmName: 0, notSingle: 0 };

  for (const set of sets) {
    const mine = rows.filter((r) => r.setId === set.id);
    if (mine.length === 0) continue;
    const exp = matchExpansion(set.name, set.series, expansions);
    if (!exp) {
      skips.noExpansion += mine.length;
      continue;
    }
    const byNumber = new Map<string, CtBlueprint[]>();
    for (const b of (await ctBlueprints(exp.id)).filter(isSingleBlueprint)) {
      const k = ctNumberKey(b.fixed_properties?.collector_number as string);
      if (!k) continue;
      if (!byNumber.has(k)) byNumber.set(k, []);
      byNumber.get(k)!.push(b);
    }
    for (const r of mine) {
      const k = ctNumberKey(r.number);
      const cands = (k ? byNumber.get(k) : undefined) ?? [];
      if (cands.length !== 1) { skips.noBlueprint++; continue; }
      const bp = cands[0];
      if (!cmCardNameAgrees(r.cardName, bp.name)) { skips.ctName++; continue; }
      const ids = bp.card_market_ids ?? [];
      if (ids.length !== 1) { skips.noMkm++; continue; }
      const idProduct = ids[0];
      const cmName = cmNames.get(idProduct);
      if (!cmName) { skips.notInCatalog++; continue; }
      if (!cmCardNameAgrees(r.cardName, cmName)) { skips.cmName++; continue; }
      if (!guideRowIsSingle(idProduct, cmNames)) { skips.notSingle++; continue; }
      byProduct.set(r.productId, idProduct);
    }
  }

  // ── FAS 1: FACIT ──────────────────────────────────────────────────────────
  let agree = 0;
  const disagree: { r: Row; ours: number; ct: number }[] = [];
  for (const r of known) {
    const ct = byProduct.get(r.productId);
    if (ct == null) continue;
    const ours = Number(r.url.match(/idProduct=(\d+)/)![1]);
    if (ours === ct) agree++;
    else disagree.push({ r, ours, ct });
  }
  const judged = agree + disagree.length;
  console.log(`FAS 1 — CardTrader mot våra KÄNDA id:n: ${judged} jämförbara`);
  console.log(`   överens:   ${agree}`);
  console.log(`   oense:     ${disagree.length}${judged ? ` (${((disagree.length / judged) * 100).toFixed(1)} %)` : ""}`);
  // VEM HAR RÄTT? Cardmarkets EGEN katalog dömer: stämmer namnet på VÅRT idProduct
  // inte med kortet är det vår länk som är fel — CardTraders har redan passerat
  // samma prövning. Det gör "4 % oense" till ett svar i stället för en oro.
  let oursWrong = 0;
  let bothPlausible = 0;
  for (const d of disagree) {
    const ourName = cmNames.get(d.ours);
    const ourOk = ourName ? cmCardNameAgrees(d.r.cardName, ourName) : false;
    if (!ourOk) oursWrong++;
    else bothPlausible++;
  }
  console.log(`   – varav VÅR länk motsägs av CM:s egen katalog: ${oursWrong}`);
  console.log(`   – varav båda namnen är rimliga (olika utgåvor?): ${bothPlausible}`);
  for (const d of disagree.slice(0, 15)) {
    const ourName = cmNames.get(d.ours);
    const verdict = ourName && cmCardNameAgrees(d.r.cardName, ourName) ? "båda rimliga" : "VÅR ÄR FEL";
    console.log(
      `      ${d.r.title}  [${verdict}]\n         vår ${d.ours} ("${ourName ?? "finns ej i katalogen"}")\n         CT  ${d.ct} ("${cmNames.get(d.ct)}")`
    );
  }
  if (judged > 0 && disagree.length / judged > MAX_DISAGREEMENT) {
    console.error(`\n⛔ CardTrader motsäger mer än ${MAX_DISAGREEMENT * 100} % av våra kända id:n — skriver INGENTING.`);
    return;
  }

  // ── FAS 2: SLUG-LÄNKAR ────────────────────────────────────────────────────
  const plan: { r: Row; idProduct: number }[] = [];
  for (const r of slugs) {
    const id = byProduct.get(r.productId);
    if (id == null) continue;
    const holder = owned.get(id);
    if (holder && holder !== r.productId) continue; // id:t ägs av någon annan
    plan.push({ r, idProduct: id });
  }
  console.log(`\nFAS 2 — slug-länkar som kan pekas om: ${plan.length} av ${slugs.length}`);
  console.log(`   avvisade av vakterna: ${JSON.stringify(skips)}`);
  for (const p of plan.slice(0, 10))
    console.log(`   ${p.r.title}\n      → idProduct=${p.idProduct} ("${cmNames.get(p.idProduct)}")`);

  // ── FAS 3: KÄNDA id:n som CM:s EGEN katalog motsäger ──────────────────────
  // Bara de bevisat felaktiga. De 58 där båda namnen är rimliga rörs INTE — där
  // vet vi bara att källorna valt olika version, inte vem som har rätt.
  const wrongKnown = disagree.filter((d) => {
    const ourName = cmNames.get(d.ours);
    return !ourName || !cmCardNameAgrees(d.r.cardName, ourName);
  });
  console.log(`\nFAS 3 — kända id:n som CM:s katalog motsäger: ${wrongKnown.length}`);
  for (const d of wrongKnown)
    console.log(`   ${d.r.title}\n      ${d.ours} ("${cmNames.get(d.ours) ?? "finns ej"}") → ${d.ct} ("${cmNames.get(d.ct)}")`);

  if (!APPLY) {
    console.log("\nTorrkörning — inget skrevs. Lägg till --apply.");
    return;
  }
  let n = 0;
  for (const p of plan) {
    // isFirstEd=N: alla ordinarie singlar (tryckningar rörs inte alls, se filhuvudet).
    const url = cardmarketProductUrl(p.idProduct, { nearMint: true, firstEd: "exclude" });
    await prisma.offer.update({ where: { id: p.r.offerId }, data: { url } });
    n++;
  }
  let m = 0;
  for (const d of wrongKnown) {
    const url = cardmarketProductUrl(d.ct, { nearMint: true, firstEd: "exclude" });
    await prisma.offer.update({ where: { id: d.r.offerId }, data: { url } });
    m++;
  }
  console.log(`\nOmpekade slug-länkar: ${n}\nRättade felaktiga id-länkar: ${m}`);
}

main().finally(() => prisma.$disconnect());
