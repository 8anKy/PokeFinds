/**
 * ETT SET = EN CARDMARKET-EXPANSION (ägarbeslut 2026-10-16: "Cardmarket är vår primära källa").
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/regroup-sets-by-cm-expansion.ts [rapportfil]
 *
 * TORRKÖRNING som default — skriver ingenting. `--apply` utför de SÄKRA delarna (ägarbeslut 2026-10-16):
 *   A. setet får sitt cmExpansionId (bara där det saknas),
 *   B. JP-tvillingar (bara förseglat) slås in i kortsetet; CM:s generiska hink upplöses,
 *   C. CardTrader-kort som är DUBBLETTER av ett kort ägarsetet redan har (samma namn + nummer efter
 *      normalisering: "0RC1/RC32" = "RC1", "156" = "SWSH156") och kort i fel språk DÖLJS (reversibelt).
 * Catch-all-korten FLYTTAS INTE: de är stämplade omtryck med samma nummer som originalet, och i
 * huvudsetet hade de höjt kompletteringens nämnare (Base 0/102 → 0/1xx). Setet döljs i stället ur
 * /sets (`CardSet.listed`, `lib/set-listing.ts`) och korten finns kvar i katalogen.
 *
 * Varje kort bär (direkt eller via sin produkts CM-offer) ett Cardmarket-idProduct, och CM:s
 * gratiskatalog säger vilken expansion den produkten hör till. Expansionen avgör setet:
 *   · ÄGARE: setet med flest kort ur expansionen (CardTrader-skapade catch-all-set kan aldrig
 *     äga en expansion som ett riktigt set också har kort i).
 *   · FRAGMENT: ett set vars kort (≥ 80 %) hör till en expansion som ett ANNAT set äger ⇒
 *     slås ihop med ägaren. Krockar samlarnumren (Trainer Kit-halvor, Classic Collection) flaggas
 *     det i stället — det är ägarens beslut.
 *   · CATCH-ALL: ett set utan dominerande expansion ⇒ varje kort flyttas till sin expansions
 *     ägare. Samma idProduct finns redan där = dubblett (slås ihop); annars en egen tryckning.
 *   · JP-TVILLING: ett set med bara förseglat och ett cmExpansionId som ett ANNAT sets kort
 *     ligger i ⇒ produkterna flyttas dit.
 *   · SPRÅKFEL: kort/produkter vars språk inte är setets, och kort som inte är EN/JP.
 */
import * as fs from "fs";
import { prisma } from "../src/lib/db";

const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";
const CM_NONSINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const DOMINANT = 0.8;
/** CM:s generiska hink (tins, blister, mynt från alla eror) — ingen riktig expansion, äger aldrig ett set. */
const GENERIC_EXPANSIONS = new Set([1645]);

type CardRow = { id: string; setId: string; name: string; number: string; language: string; cardmarketId: number | null; tcgExternalId: string | null };

async function main() {
  const reportPath = process.argv[2];
  const out: string[] = [];
  const log = (s = "") => out.push(s);

  const cat = (await (await fetch(CM_SINGLES)).json()) as { products: { idProduct: number; idExpansion: number }[] };
  const expOf = new Map(cat.products.map((p) => [p.idProduct, p.idExpansion]));

  const sets = await prisma.cardSet.findMany({
    select: { id: true, name: true, language: true, externalId: true, cmExpansionId: true, _count: { select: { cards: true, products: true } } },
  });
  const setById = new Map(sets.map((s) => [s.id, s]));
  const isCt = (sid: string) => setById.get(sid)?.externalId?.startsWith("ct:") ?? false;

  const cards = await prisma.$queryRawUnsafe<CardRow[]>(
    `SELECT id, "setId", name, number, language::text AS language, "cardmarketId", "tcgExternalId" FROM "Card"`
  );
  const offerCm = new Map<string, number>();
  for (const r of await prisma.$queryRawUnsafe<{ cardId: string; cm: string }[]>(
    `SELECT p."cardId", substring(o.url from 'idProduct=([0-9]+)') AS cm
       FROM "Offer" o JOIN "Product" p ON p.id = o."productId" JOIN "Retailer" r ON r.id = o."retailerId"
      WHERE r.name = 'Cardmarket' AND p."cardId" IS NOT NULL AND p."variantLabel" IS NULL AND o.url LIKE '%idProduct=%'`
  )) if (r.cm) offerCm.set(r.cardId, Number(r.cm));

  const cmIdOf = (c: CardRow) =>
    c.cardmarketId ?? (c.tcgExternalId?.startsWith("cm:") ? Number(c.tcgExternalId.slice(3)) : null) ?? offerCm.get(c.id) ?? null;

  // set → expansion → kort, expansion → set → antal
  const perSet = new Map<string, Map<number, CardRow[]>>();
  const perExp = new Map<number, Map<string, number>>();
  const cardsBySet = new Map<string, CardRow[]>();
  const cardByCmId = new Map<number, CardRow>();
  for (const c of cards) {
    (cardsBySet.get(c.setId) ?? cardsBySet.set(c.setId, []).get(c.setId)!).push(c);
    const id = cmIdOf(c);
    if (id != null && !cardByCmId.has(id)) cardByCmId.set(id, c);
    const e = id != null ? expOf.get(id) : undefined;
    if (e == null || GENERIC_EXPANSIONS.has(e)) continue;
    const a = perSet.get(c.setId) ?? perSet.set(c.setId, new Map()).get(c.setId)!;
    (a.get(e) ?? a.set(e, []).get(e)!).push(c);
    const b = perExp.get(e) ?? perExp.set(e, new Map()).get(e)!;
    b.set(c.setId, (b.get(c.setId) ?? 0) + 1);
  }

  const mappedCount = (sid: string) => [...(perSet.get(sid)?.values() ?? [])].reduce((n, l) => n + l.length, 0);
  const dominant = (sid: string): number | null => {
    const h = perSet.get(sid); if (!h) return null;
    const [e, l] = [...h.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    return l.length / mappedCount(sid) >= DOMINANT ? e : null;
  };
  const catchAll = new Set(sets.filter((s) => perSet.has(s.id) && dominant(s.id) == null).map((s) => s.id));

  // Förseglat röstar också om ägarskapet: Pokémon GO:s 88 kort har CM-länkar i SLUG-form (inget
  // idProduct), så utan boostern/ETB:n i samma expansion hade ett CardTrader-set med ett kort ägt den.
  const nonsingles = (await (await fetch(CM_NONSINGLES)).json()) as { products: { idProduct: number; idExpansion: number }[] };
  const sealedExpOf = new Map(nonsingles.products.map((p) => [p.idProduct, p.idExpansion]));
  const votes = new Map<number, Map<string, number>>();
  for (const [e, m] of perExp) votes.set(e, new Map(m));
  for (const r of await prisma.$queryRawUnsafe<{ setId: string; cm: string }[]>(
    `SELECT p."setId", substring(o.url from 'idProduct=([0-9]+)') AS cm
       FROM "Offer" o JOIN "Product" p ON p.id = o."productId" JOIN "Retailer" r ON r.id = o."retailerId"
      WHERE r.name = 'Cardmarket' AND p."cardId" IS NULL AND p."setId" IS NOT NULL AND o.url LIKE '%idProduct=%'`
  )) {
    const e = sealedExpOf.get(Number(r.cm));
    if (e == null || GENERIC_EXPANSIONS.has(e)) continue;
    const m = votes.get(e) ?? votes.set(e, new Map()).get(e)!;
    m.set(r.setId, (m.get(r.setId) ?? 0) + 1);
  }

  // Ägare per expansion: flest röster, catch-all-set räknas inte, riktiga set före CardTrader-set.
  const owner = new Map<number, string>();
  for (const [e, m] of votes) {
    const cand = [...m.entries()].filter(([sid]) => !catchAll.has(sid)).sort((a, b) => b[1] - a[1]);
    if (!cand.length) continue;
    // Ett CardTrader-set vinner bara med klar marginal över bästa riktiga set (2x).
    const real = cand.find(([sid]) => !isCt(sid));
    owner.set(e, isCt(cand[0][0]) && real && cand[0][1] < real[1] * 2 ? real[0] : cand[0][0]);
  }

  // ── 1. Set → expansion-id ──────────────────────────────────────────────────
  const assign: string[] = [], conflicts: string[] = [], multi: string[] = [];
  const owned = new Map<string, number[]>();
  for (const [e, o] of owner) (owned.get(o) ?? owned.set(o, []).get(o)!).push(e);
  for (const s of sets) {
    const es = (owned.get(s.id) ?? []).sort((a, b) => (votes.get(b)!.get(s.id) ?? 0) - (votes.get(a)!.get(s.id) ?? 0));
    if (!es.length) continue;
    const e = es[0];
    if (es.length > 1) multi.push(`${s.language} "${s.name}" äger ${es.length} expansioner: ${es.map((x) => `${x}(${votes.get(x)!.get(s.id)})`).join(" ")}`);
    if (s.cmExpansionId === e) continue;
    if (s.cmExpansionId != null) conflicts.push(`${s.language} "${s.name}": har cmExpansionId ${s.cmExpansionId}, rösterna säger ${e}`);
    else assign.push(`${s.language} "${s.name}" ← ${e}`);
  }

  // ── 2. Fragment → ägare ────────────────────────────────────────────────────
  const merges: string[] = [], collisions: string[] = [];
  for (const s of sets) {
    const e = dominant(s.id);
    if (e == null) continue;
    const o = owner.get(e);
    if (!o || o === s.id) continue;
    const os = setById.get(o)!;
    const ownNums = new Set((cardsBySet.get(o) ?? []).map((c) => c.number.replace(/^0+/, "")));
    const clash = (cardsBySet.get(s.id) ?? []).filter((c) => ownNums.has(c.number.replace(/^0+/, ""))).length;
    const line = `${s.language} "${s.name}" (${s._count.cards} kort, ${s.externalId ?? "-"})  →  "${os.name}" (${os._count.cards} kort)`;
    if (clash > 0) collisions.push(`${line}  ⚠ ${clash} samlarnummer finns redan i målet`);
    else merges.push(line);
  }

  // ── 3. Catch-all → kort för kort ───────────────────────────────────────────
  const caLines: string[] = [];
  let caMove = 0, caDup = 0, caStay = 0;
  for (const sid of catchAll) {
    const s = setById.get(sid)!;
    const dest = new Map<string, { move: number; dup: number }>();
    let stay = 0;
    for (const c of cardsBySet.get(sid) ?? []) {
      const id = cmIdOf(c); const e = id != null ? expOf.get(id) : undefined; const o = e != null ? owner.get(e) : undefined;
      if (!o || o === sid) { stay++; continue; }
      const twin = (cardsBySet.get(o) ?? []).find((x) => x.id !== c.id && cmIdOf(x) === id);
      const d = dest.get(o) ?? dest.set(o, { move: 0, dup: 0 }).get(o)!;
      if (twin) d.dup++; else d.move++;
    }
    const tot = [...dest.values()].reduce((n, d) => n + d.move + d.dup, 0);
    caMove += [...dest.values()].reduce((n, d) => n + d.move, 0);
    caDup += [...dest.values()].reduce((n, d) => n + d.dup, 0);
    caStay += stay;
    caLines.push(`${s.language} "${s.name}" (${s._count.cards} kort): ${tot} till ${dest.size} set, ${stay} utan CM-expansion stannar`);
    for (const [o, d] of [...dest.entries()].sort((a, b) => (b[1].move + b[1].dup) - (a[1].move + a[1].dup)).slice(0, 6))
      caLines.push(`      → "${setById.get(o)!.name}": ${d.move} ny tryckning, ${d.dup} dubblett`);
  }

  // ── 4. JP-tvillingar (bara förseglat) ──────────────────────────────────────
  const twins: string[] = [];
  for (const s of sets) {
    if (s._count.cards > 0 || s.cmExpansionId == null) continue;
    if (GENERIC_EXPANSIONS.has(s.cmExpansionId)) {
      twins.push(`${s.language} "${s.name}" bär CM:s generiska hink ${s.cmExpansionId} ⇒ setet upplöses, ${s._count.products} produkter blir setlösa`);
      continue;
    }
    const o = owner.get(s.cmExpansionId);
    if (o && o !== s.id) twins.push(`${s.language} "${s.name}" (${s._count.products} förseglade)  →  "${setById.get(o)!.name}" (${setById.get(o)!._count.cards} kort)`);
  }

  // ── 5. Språkfel ────────────────────────────────────────────────────────────
  const lang: string[] = [];
  for (const c of cards) {
    const s = setById.get(c.setId)!;
    if (c.language !== s.language) lang.push(`kort ${c.language} "${c.name} ${c.number}" i ${s.language}-setet "${s.name}"`);
    else if (/\d(it|de|fr|es|pt)$/i.test(c.number)) lang.push(`kort "${c.name} ${c.number}" i "${s.name}" ser ut att vara ett annat språk`);
  }
  for (const r of await prisma.$queryRawUnsafe<{ title: string; pl: string; name: string; sl: string }[]>(
    `SELECT p.title, p.language::text AS pl, s.name, s.language::text AS sl FROM "Product" p JOIN "CardSet" s ON s.id = p."setId"
      WHERE p."cardId" IS NULL AND p.language <> s.language`
  )) lang.push(`förseglat ${r.pl} "${r.title}" i ${r.sl}-setet "${r.name}"`);

  // ── APPLY ──────────────────────────────────────────────────────────────────
  const APPLY = process.argv.includes("--apply");
  if (APPLY || process.argv.includes("--preview")) {
    console.log(APPLY ? "[apply] SKRIVER" : "[preview] skriver ingenting");
    const now = new Date();
    // B först: tvillingen bär sitt cmExpansionId, och ägaren ska få det i A (unikt index).
    let movedProducts = 0, deletedSets = 0, movedWatches = 0;
    for (const s of sets) {
      if (s._count.cards > 0 || s.cmExpansionId == null) continue;
      const generic = GENERIC_EXPANSIONS.has(s.cmExpansionId);
      const o = generic ? null : owner.get(s.cmExpansionId);
      if (!generic && (!o || o === s.id)) continue;
      if (!APPLY) { console.log(`[preview] B: ${s.name} → ${o ? setById.get(o)!.name : "(inget set)"}`); continue; }
      movedProducts += (await prisma.product.updateMany({ where: { setId: s.id }, data: { setId: o ?? null } })).count;
      if (o) {
        for (const w of await prisma.setWatch.findMany({ where: { setId: s.id }, select: { userId: true } })) {
          await prisma.setWatch.upsert({ where: { userId_setId: { userId: w.userId, setId: o } }, create: { userId: w.userId, setId: o }, update: {} });
          movedWatches++;
        }
      }
      await prisma.setWatch.deleteMany({ where: { setId: s.id } });
      await prisma.cardSet.delete({ where: { id: s.id } });
      deletedSets++;
    }
    console.log(`[apply] B: ${deletedSets} tvillingset borttagna, ${movedProducts} förseglade flyttade, ${movedWatches} setbevakningar flyttade.`);

    // A: cmExpansionId där det saknas. Unikt ⇒ hoppa när ett annat set redan bär id:t.
    const taken = new Set(
      (await prisma.cardSet.findMany({ where: { cmExpansionId: { not: null } }, select: { cmExpansionId: true } })).map((x) => x.cmExpansionId!)
    );
    let assigned = 0;
    for (const s of sets) {
      if (s.cmExpansionId != null) continue;
      const es = (owned.get(s.id) ?? []).sort((a, b) => (votes.get(b)!.get(s.id) ?? 0) - (votes.get(a)!.get(s.id) ?? 0));
      const e = es[0];
      if (e == null || taken.has(e)) continue;
      if (!APPLY) { assigned++; taken.add(e); continue; }
      const still = await prisma.cardSet.findUnique({ where: { id: s.id }, select: { id: true } });
      if (!still) continue;
      await prisma.cardSet.update({ where: { id: s.id }, data: { cmExpansionId: e } });
      taken.add(e);
      assigned++;
    }
    console.log(`[apply] A: ${assigned} set fick cmExpansionId.`);

    // C: dubbletter i CardTrader-fragmenten + kort i fel språk ⇒ döljs.
    const numKey = (n: string) =>
      n.split("/")[0].toUpperCase()
        .replace(/^0+(?=[A-Z])/, "")
        .replace(/^(SWSH|SM|XY|BW|DP|HGSS)(?=\d)/, "")
        .replace(/^([A-Z]*)0+(?=\d)/, "$1");
    const nameKey = (n: string) => n.toLowerCase().replace(/\s+lv\.?\s*\d+$/, "").trim();
    const hideCards: { id: string; why: string }[] = [];
    for (const s of sets) {
      if (!isCt(s.id)) continue;
      const e = dominant(s.id);
      const o = e != null ? owner.get(e) : undefined;
      if (!o || o === s.id) continue;
      // ⛔ Bara mot ett RIKTIGT set: två CardTrader-deck (Starter Set V-halvorna, Trainer Kit-
      // halvorna) delar CM-expansion men är OLIKA tryckningar — samma Quick Ball 013 i två däck.
      // ⛔ Och originalet får inte bära ett ANNAT CM-id: då är vårt kort en annan tryckning
      // (stämplad Pikachu 051 i en Mega Evolution-produkt ≠ Temporal Forces 051).
      if (isCt(o)) continue;
      const have = new Map((cardsBySet.get(o) ?? []).map((c) => [nameKey(c.name) + "|" + numKey(c.number), c] as const));
      for (const c of cardsBySet.get(s.id) ?? []) {
        const orig = have.get(nameKey(c.name) + "|" + numKey(c.number));
        if (!orig) continue;
        const oid = cmIdOf(orig);
        if (oid != null && oid !== cmIdOf(c)) continue;
        hideCards.push({ id: c.id, why: `dubblett av "${setById.get(o)!.name}": ${c.name} ${c.number}` });
      }
    }
    for (const c of cards)
      if (/\d(it|de|fr|es|pt)$/i.test(c.number) && !hideCards.some((h) => h.id === c.id))
        hideCards.push({ id: c.id, why: `annat språk: ${c.name} ${c.number}` });
    let hidden = 0, kept = 0;
    for (const h of hideCards) {
      const prods = await prisma.product.findMany({
        where: { cardId: h.id, hiddenAt: null },
        select: { id: true, _count: { select: { collectionItems: true, watchlistItems: true } } },
      });
      for (const p of prods) {
        if (p._count.collectionItems + p._count.watchlistItems > 0) {
          kept++;
          console.log(`[apply] C: behåller (ägd/bevakad) ${h.why}`);
          continue;
        }
        if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { hiddenAt: now } });
        hidden++;
      }
      console.log(`[apply] C: ${h.why}`);
    }
    console.log(`[apply] C: ${hidden} produkter dolda (${hideCards.length} kort), ${kept} behållna (någon äger/bevakar dem).`);
  }

  // ── Sammanfattning ─────────────────────────────────────────────────────────
  const emptyAfter = new Set<string>([...catchAll, ...twins.map(() => "")]);
  const removed = merges.length + twins.length + catchAll.size;
  for (const L of ["EN", "JP"]) {
    const n = sets.filter((s) => s.language === L).length;
    log(`${L}: ${n} set nu`);
  }
  log(`Kort: ${cards.length}, med CM-expansion: ${[...perSet.values()].reduce((n, m) => n + [...m.values()].reduce((k, l) => k + l.length, 0), 0)}`);
  log(`Set som försvinner (sammanslagna/tömda): ~${removed}  (+ ${collisions.length} som väntar på ditt beslut)`);
  void emptyAfter;
  log(`\n=== 1. SETET FÅR SITT CARDMARKET-EXPANSION-ID: ${assign.length}`); assign.forEach((l) => log("  " + l));
  if (conflicts.length) { log(`\n=== 1b. KONFLIKT — setet har redan ett annat id: ${conflicts.length}`); conflicts.forEach((l) => log("  " + l)); }
  log(`\n=== 1c. SET SOM INNEHÅLLER FLERA EXPANSIONER (kan behöva delas): ${multi.length}`); multi.forEach((l) => log("  " + l));
  log(`\n=== 2. SAMMA EXPANSION — SLÅS IHOP: ${merges.length}`); merges.forEach((l) => log("  " + l));
  log(`\n=== 2b. SAMMA EXPANSION MEN NUMREN KROCKAR — DITT BESLUT: ${collisions.length}`); collisions.forEach((l) => log("  " + l));
  log(`\n=== 3. CATCH-ALL-SET — KORTEN TILL SINA SET: ${catchAll.size} set, ${caMove} nya tryckningar, ${caDup} dubbletter, ${caStay} stannar`);
  caLines.forEach((l) => log("  " + l));
  log(`\n=== 4. JP-TVILLINGAR (bara förseglat) — PRODUKTERNA FLYTTAS: ${twins.length}`); twins.forEach((l) => log("  " + l));
  log(`\n=== 5. SPRÅKFEL: ${lang.length}`); lang.slice(0, 80).forEach((l) => log("  " + l));

  const text = out.join("\n");
  if (reportPath) fs.writeFileSync(reportPath, text);
  console.log(reportPath ? text.split("\n=== ")[0] + `\n(hela rapporten: ${reportPath})` : text);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
