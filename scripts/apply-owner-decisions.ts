/**
 * ÄGARENS KATALOGBESLUT — läser en textfil med länkar och verkställer den.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-decisions.ts beslut.txt
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-decisions.ts beslut.txt --write-denylist
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-owner-decisions.ts beslut.txt --apply
 *
 * FORMATET ÄR ÄGARENS EGET ("Duplicates … Goes to …", samma som katalogsvepningens
 * utdata) och kräver bara LÄNKAR — inga titlar, inga id:n, ingen exakt stavning:
 *
 *     Duplicates
 *     https://www.foilio.se/produkter/stub-a
 *     https://www.foilio.se/produkter/stub-b
 *     Goes to
 *     https://www.foilio.se/produkter/kanonisk
 *
 *     Delete
 *     https://www.foilio.se/produkter/skrapet
 *
 * Kortformerna funkar också — `https://…/a -> https://…/kanonisk` på EN rad, och
 * `x https://…/skrapet` för en radering. Rader som börjar med # eller // är
 * kommentarer, tomrader avslutar en grupp, och all text som inte är en länk
 * ignoreras (klistra gärna in titlarna också — de gör filen läsbar).
 *
 * ⛔ TORRKÖRNING SOM DEFAULT, och torrkörningen skriver ut PRODUKTERNAS RIKTIGA
 *    TITLAR. Det är hela poängen med att kräva en bekräftelse: en felklistrad länk
 *    syns bara om man ser vad den faktiskt pekar på.
 *
 * ⛔ RADERING KRÄVER DENYLIST FÖRST. En raderad produkts butiks-URL ligger kvar i
 *    butikens feed, och auto-importen (`ensureListingProduct`) skapar om stubben
 *    inom minuter — mätt 2026-07-14: tre stubbar återuppstod sju minuter efter en
 *    merge. Skriptet vägrar därför radera en produkt vars butiks-URL:er inte redan
 *    är nekade, och `--write-denylist` skriver in dem åt dig. Ordningen är:
 *      1. --write-denylist    (skriver src/scrapers/import-denylist.ts)
 *      2. commit + push       (Actions-lanan checkar ut repot vid varje körning)
 *      3. --apply             (raderar/mergar)
 *
 * ⛔ SAMMA FÄLLA GÄLLER MERGAR, fast dolt: `mergeStubInto` flyttar stubbens offers
 *    till målet, MEN en offer vars (butik, skick, språk) redan finns på målet
 *    RADERAS i stället — och då blir dess URL herrelös och återskapas som ny stub.
 *    Skriptet räknar ut vilka mergar som drabbas och listar de URL:erna med.
 *
 * ⛔ `--hide` GÖMMER I STÄLLET FÖR ATT RADERA (2026-08-15), och det är oftast det
 *    ägaren VILL. En radering tar med sig produktens offers, och Discord-lanens
 *    ruttabell (butiks-URL → produkt) byggs ur just Offer + StoreListing — så en
 *    raderad produkt gör att restock-lanen fortfarande SER lagerflippen men inte kan
 *    posta den ("okänd URL"). Tyst, och permanent, eftersom raderingen dessutom
 *    kräver att butiks-URL:erna denylistas.
 *    Med `--hide` sätts `Product.hiddenAt` i stället: raden försvinner ur katalog,
 *    sök, facetter, autocomplete, /marknad och sitemap, mejl-/push-larmen tystnar —
 *    men offern, routen och Discord-inlägget lever vidare.
 *    Följdregel: **ingen denylist behövs.** Produkten finns kvar, så `loadMatchIndex`
 *    ser den och auto-importen binder butiks-URL:en till den gömda raden i stället
 *    för att skapa en ny stub. Inga herrelösa URL:er kan uppstå.
 *    Ångra = `--unhide` (nollar `hiddenAt` för samma lista).
 */
import "./load-env";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/db";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { isDeniedListingUrl } from "../src/scrapers/import-denylist";
import { isStoreRetailer } from "../src/lib/offer-source";
// ⛔ Parsern bor i lib/ och har egna tester. En andra kopia här hade drivit isär
//    med den testade — och det är TOLKNINGEN som avgör vilken produkt som överlever.
import { orphanedOfferUrlsForMerge, parseDecisions, validateDecisions } from "./lib/owner-decisions";

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const WRITE_DENYLIST = args.includes("--write-denylist");
// "Delete"-grupperna GÖMS i stället för att raderas — se filhuvudet. `--unhide`
// är ångra-knappen och implicerar samma läge (annars hade den försökt radera).
const UNHIDE = args.includes("--unhide");
const HIDE = args.includes("--hide") || UNHIDE;
const DENYLIST_PATH = path.join(process.cwd(), "src/scrapers/import-denylist.ts");

if (!FILE) {
  console.error("Ange filen med besluten:  npx tsx scripts/apply-owner-decisions.ts beslut.txt");
  process.exit(1);
}

// ─────────────────────────── verkställande ────────────────────────────
const URL = (slug: string) => `https://www.foilio.se/produkter/${slug}`;

async function main() {
  const text = fs.readFileSync(path.resolve(FILE!), "utf8");
  const parsed = parseDecisions(text);
  let groups = parsed.decisions;
  const problems = parsed.problems;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  console.log(`DB: ${db} — ${APPLY ? "APPLY (skriver)" : "TORRKÖRNING"}`);
  console.log(`Fil: ${FILE} → ${groups.length} beslut\n`);
  for (const p of problems) console.log(`⚠ ${p}`);

  const slugs = [...new Set(groups.flatMap((g) => [...g.drop, ...(g.keep ? [g.keep] : [])]))];
  const rows = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: {
      id: true, slug: true, title: true, category: true,
      offers: { select: { id: true, url: true, retailerId: true, condition: true, language: true, retailer: { select: { name: true } } } },
      _count: { select: { priceSnapshots: true, watchlistItems: true, collectionItems: true } },
    },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  // ── Validering: hellre stopp än en gissning (ren funktion, egna tester) ──
  const { errors, notes, cleaned } = validateDecisions(groups, new Set(bySlug.keys()));
  for (const nt of notes) console.log(`ℹ ${nt}`);
  groups = cleaned;

  // ── Herrelösa URL:er: raderingar + offers som krockar vid merge ──
  type Orphan = { url: string; store: string; from: string; why: string };
  const orphans: Orphan[] = [];
  for (const g of groups) {
    if (g.kind === "delete") {
      // ⛔ EN GÖMD PRODUKT GÖR INGEN URL HERRELÖS. Raden och dess offers ligger kvar,
      //    så ruttabellen behåller routen och auto-importen matchar mot den gömda
      //    produkten i stället för att skapa en ny stub. Att denylista här hade
      //    tystat Discord-inlägget — dvs precis det gömningen finns för att rädda.
      if (HIDE) continue;
      for (const s of g.drop) {
        for (const o of bySlug.get(s)?.offers ?? []) {
          // Samma skäl som i orphanedOfferUrls: denylistan läses bara av
          // ensureListingProduct, som skapar produkter ur BUTIKSFEEDAR.
          if (!o.url || !isStoreRetailer(o.retailer.name)) continue;
          orphans.push({ url: o.url, store: o.retailer.name, from: bySlug.get(s)!.title, why: "raderad produkt" });
        }
      }
      continue;
    }
    const keep = bySlug.get(g.keep!);
    if (!keep) continue;
    // ⛔ HELA GRUPPEN simuleras i MERGE-ORDNING — samma ordning som loopen längre ner
    //    kör. Stub 1:s offer flyttar in i målet och stub 2–N krockar sedan med DEN.
    //    Beräknas de var för sig ser ingen av dem en krock, och N−1 butiks-URL:er blir
    //    ägarlösa utan att denylistas. Det var precis så dubbletterna kom tillbaka.
    const dropsInOrder = g.drop
      .map((s) => bySlug.get(s))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => d.offers.map((o) => ({ ...o, retailerName: o.retailer.name })));
    const owners = new Map<string, string>();
    for (const s of g.drop) for (const o of bySlug.get(s)?.offers ?? []) if (o.url) owners.set(o.url, bySlug.get(s)!.title);
    for (const url of orphanedOfferUrlsForMerge(dropsInOrder, keep.offers)) {
      const all = g.drop.flatMap((s) => bySlug.get(s)?.offers ?? []);
      const store = all.find((o) => o.url === url)?.retailer.name ?? "—";
      orphans.push({ url, store, from: owners.get(url) ?? "—", why: "offer krockar med målets" });
    }
  }
  const needDeny = orphans.filter((o) => !isDeniedListingUrl(o.url));

  // ── Utskrift ──
  for (const g of groups) {
    console.log("");
    if (g.kind === "delete") {
      console.log(`${HIDE ? (UNHIDE ? "VISA IGEN" : "GÖM (behåller offers + Discord-route)") : "RADERA"}  (rad ${g.line})`);
      for (const s of g.drop) {
        const p = bySlug.get(s);
        console.log(`   ${p ? `[${p.category}, ${p._count.priceSnapshots} snap, ${p._count.watchlistItems} bev, ${p._count.collectionItems} saml] ${p.title}` : `❌ OKÄND SLUG "${s}"`}`);
        console.log(`   ${URL(s)}`);
        for (const o of p?.offers ?? []) if (o.url) console.log(`      ${o.retailer.name}: ${o.url}`);
      }
      continue;
    }
    const keep = bySlug.get(g.keep!);
    console.log(`SLÅ IHOP  (rad ${g.line})`);
    for (const s of g.drop) {
      const p = bySlug.get(s);
      console.log(`   ✗ ${p ? `[${p.category}, ${p._count.priceSnapshots} snap, ${p._count.watchlistItems} bev] ${p.title}` : `❌ OKÄND SLUG "${s}"`}`);
    }
    console.log(`   → ${keep ? `[${keep.category}, ${keep._count.priceSnapshots} snap, ${keep.offers.length} offer] ${keep.title}` : `❌ OKÄND SLUG "${g.keep}"`}`);
    console.log(`     ${URL(g.keep!)}`);
  }

  if (errors.length) {
    console.log(`\n${"═".repeat(70)}\n${errors.length} FEL — ingenting körs förrän de är lösta:`);
    for (const e of errors) console.log(`  ⛔ ${e}`);
    process.exitCode = 1;
    return;
  }

  const merges = groups.filter((g) => g.kind === "merge");
  const deletes = groups.filter((g) => g.kind === "delete");
  console.log(`\n${"═".repeat(70)}`);
  const dropCount = deletes.reduce((n, g) => n + g.drop.length, 0);
  const dropWord = HIDE ? (UNHIDE ? "visas igen" : "göms (offers + Discord-route behålls)") : "raderingar";
  console.log(`${merges.length} sammanslagningar (${merges.reduce((n, g) => n + g.drop.length, 0)} rader bort) · ${dropCount} ${dropWord}`);
  if (needDeny.length) {
    console.log(`\n⚠ ${needDeny.length} butiks-URL blir HERRELÖS och återskapas som ny stub inom minuter.`);
    for (const o of needDeny) console.log(`   ${o.store}: ${o.url}\n      (${o.why} · ${o.from})`);
    console.log(`\n   Kör --write-denylist, commit + push, och därefter --apply.`);
  } else if (orphans.length) {
    console.log(`\n✅ Alla ${orphans.length} berörda butiks-URL:er är redan nekade i import-denylist.ts.`);
  }

  // ── --write-denylist ──
  if (WRITE_DENYLIST) {
    if (needDeny.length === 0) {
      console.log("\nInget att lägga till i denylistan.");
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const byProduct = new Map<string, Orphan[]>();
      for (const o of needDeny) byProduct.set(o.from, [...(byProduct.get(o.from) ?? []), o]);
      const block: string[] = [`    // ── Ägarens katalogbeslut ${today} (apply-owner-decisions.ts) ──`];
      for (const [title, os] of byProduct) {
        block.push(`    // ${title.replace(/\s+/g, " ").slice(0, 100)} (${os[0].why})`);
        for (const o of os) block.push(`    ${JSON.stringify(o.url)},`);
      }
      const src = fs.readFileSync(DENYLIST_PATH, "utf8");
      // ⛔ ANKARET FÅR INTE NÄMNA NORMALISERARENS NAMN. Det hette "normUrl" tills
      //    2026-08-13, då variantundantaget döpte om det till normalizeListingUrl —
      //    och skrivningen slutade hitta insättningspunkten. Felet är inte tyst
      //    (skriptet skriver ut blocket och sätter exitkod 1), men det bryter det
      //    dokumenterade flödet mitt i en städomgång. Matcha på ARRAYENS slut i
      //    stället; det är det som är platsen, inte funktionens namn.
      const anchor = src.match(/^ {2}\]\.map\(\w+\)$/m)?.[0];
      if (!anchor) {
        console.error(`⛔ Hittar inte insättningspunkten i ${DENYLIST_PATH} — lägg in raderna för hand:\n${block.join("\n")}`);
        process.exitCode = 1;
        return;
      }
      fs.writeFileSync(DENYLIST_PATH, src.replace(anchor, `${block.join("\n")}\n${anchor}`), "utf8");
      console.log(`\n✍  ${needDeny.length} URL:er tillagda i src/scrapers/import-denylist.ts.`);
      console.log(`   COMMITTA OCH PUSHA innan du kör --apply — Actions-lanan läser repot vid varje körning.`);
    }
    if (!APPLY) return;
  }

  if (!APPLY) {
    console.log(`\nTORRKÖRNING — ingenting skrivet. Lägg till --apply när listan stämmer.`);
    return;
  }

  // ⛔ Vägra radera det som skulle komma tillbaka. Mergar går alltid att köra:
  //    en herrelös URL efter en merge ger en ny stub, inte en återuppstånden dubblett
  //    av det som togs bort — men den varnas för ovan så den kan denylistas ändå.
  const blockedDeletes = new Set<string>();
  for (const g of deletes) {
    // Gömning kan inget "komma tillbaka" från — raden finns kvar och ÄR det
    // auto-importen matchar mot. Vakten gäller bara riktiga raderingar.
    if (HIDE) break;
    for (const s of g.drop) {
      const p = bySlug.get(s)!;
      // ⛔ SAMMA URVAL SOM DENYLIST-INSAMLINGEN, annars blockerar vakten en radering
      //    som aldrig KAN avblockeras: en produkt vars enda kvarvarande länk är en
      //    Tradera-annons denylistas med flit inte (listan läses bara av
      //    ensureListingProduct, som hämtar ur butiksfeedar), så en vakt som räknar
      //    marknadsplatslänkar väntar för evigt på en post som aldrig skrivs.
      //    Upptäckt i omgång 3: två raderingar fastnade i just den slingan.
      const open = p.offers.filter((o) => o.url && isStoreRetailer(o.retailer.name) && !isDeniedListingUrl(o.url));
      if (open.length) blockedDeletes.add(s);
    }
  }

  let merged = 0;
  for (const g of merges) {
    const keepId = bySlug.get(g.keep!)!.id;
    for (const s of g.drop) {
      try {
        await mergeStubInto(bySlug.get(s)!.id, keepId, () => {});
        merged++;
      } catch (err) {
        console.error(`  FEL vid merge av ${s}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  let removed = 0;
  // EN tidsstämpel för hela körningen → omgången går att identifiera och ångra
  // exakt (`WHERE "hiddenAt" = …`), i stället för 145 stämplar på var sin sekund.
  const hiddenAt = UNHIDE ? null : new Date();
  for (const g of deletes) {
    for (const s of g.drop) {
      if (blockedDeletes.has(s)) {
        console.log(`  ⏭  hoppar över "${s}" — butiks-URL:en är inte nekad än (kör --write-denylist först).`);
        continue;
      }
      if (HIDE) {
        await prisma.product.update({ where: { id: bySlug.get(s)!.id }, data: { hiddenAt } });
      } else {
        await prisma.product.delete({ where: { id: bySlug.get(s)!.id } });
      }
      removed++;
    }
  }
  const verb = HIDE ? (UNHIDE ? "🙈 visade igen" : "🙈 gömda") : "🗑 raderade";
  console.log(`\n🔀 ${merged} sammanslagna · ${verb} ${removed}${blockedDeletes.size ? ` · ${blockedDeletes.size} avvaktar denylist` : ""}.`);
  if (HIDE && !UNHIDE) {
    console.log(`   Ångra HELA omgången: samma fil med --unhide --apply.`);
  }
  console.log(`   Kör sedan: node scripts/with-prod-db.mjs npx tsx scripts/recompute-price-cache.ts`);
  if (merged > 0) {
    // ⛔ Mergen flyttar butiks-URL:en till målet, men ruttabellen i Actions-cachen
    //    pekar fortfarande på stubbens slug → Discord-inlägg länkar till en produkt
    //    som inte finns. Gömningar kräver INTE detta (routen är oförändrad).
    console.log(`   Och: kör workflowet "Ruttabell för Discord-larm (manuell)" — mergade slugs finns kvar i cachen.`);
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
