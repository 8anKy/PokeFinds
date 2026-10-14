/**
 * Stub-dedup: auto-importen (ensureListingProduct) skapar en NY katalogprodukt när
 * matchProduct < 0.85 — olika butikers namn på SAMMA SKU ("Pokemon SV10.5 - Black Bolt
 * ETB" vs "Pokémon, Scarlet & Violet 10.5: ... Black Bolt Elite Trainer Box") hamnar
 * då som dubblettprodukter. Mekaniska trösklar kan inte klustra fritext-varianterna,
 * så en billig LLM-dom (Haiku, bara två titlar per anrop ≈ $0.001) avgör "samma
 * produkt?" för stubbens topp-kandidater; bekräftad dubblett merge:as in i den
 * etablerade produkten (offers flyttas, stubben raderas).
 *
 * ⛔ INGEN AI SEDAN 2026-10-14 (ägarbeslut, samma linje som skannern): en merge krävde redan
 * ALLTID `mergeEquivalent` (identisk ordmängd) — LLM-domen var bara ett extra villkor ovanpå.
 * MÄTT över alla 2 520 sparade domar: LLM:en vetade ALDRIG ett par regeln godkände (0 st), och
 * dess enda bidrag var 117 "samma"-förslag som regeln stoppade — bland dem uppenbart fel par
 * ("Pitch Black Sleeved Booster" = "Pitch Black Booster", "Umbreon V Tin (US Version)",
 * "General Mills 2019" = "…25th Anniversary"). Mergarna blir alltså desamma utan den.
 *
 * Körs VECKOVIS (store-health.yml) över stubbar ≤ STUB_WINDOW_DAYS gamla. Kandidater filtreras hårt innan LLM:
 * samma/kompatibel kategori, likhet ≥ MIN_SIM och matcherns hårda vakter
 * (serie-/sifferset-/språk-mismatch = aldrig samma produkt).
 *
 * (HISTORIK, före 2026-10-14) VERDICT-CACHE (DedupeVerdict): här stod tidigare "ingen verdict-cache behövs när
 * fönstret är kort och anropen är öre" — det stämde inte. En stub som döms "INTE
 * dubblett" ligger kvar i 14-dagarsfönstret och döms om NÄSTA måndag, och nästa:
 * samma två titlar, samma svar, ny nota. Mätt mot prod: 178 stubbar → ~505 anrop,
 * varav merparten omdömen vi redan hade. Nu läses domen ur cachen; bara PARET som
 * aldrig dömts (eller vars titel ändrats) kostar ett anrop.
 */
import { prisma } from "@/lib/db";
import { isStoreRetailer } from "@/lib/offer-source";
import { replaceHealthSection, type HealthFindingInput } from "@/lib/store-health-findings";
import { gtinConflict, isPokemonManufacturerGtin } from "@/lib/gtin";
import {
  cleanListingTitle,
  mergeEquivalent,
  productsConflict,
  languageMismatch,
  scoreSimilarity,
  seriesMismatch,
  setMarkerMismatch,
} from "@/scrapers/matching";

const STUB_WINDOW_DAYS = Number(process.env.DEDUPE_WINDOW_DAYS ?? "14");
/**
 * DEDUPE_DRY=1 → döm och rapportera, men RÖR INTE databasen. LLM-domarna cachas ändå
 * (DedupeVerdict), så en efterföljande skarp körning är i princip gratis. Använd alltid
 * detta först på en backlogg: mergen är oåterkallelig.
 */
const DRY_RUN = process.env.DEDUPE_DRY === "1";
const MIN_SIM = 0.4;
const MAX_CANDIDATES = 3;

// Kategorier som ofta förväxlas av butiksfeeds (checklane = pack/blister).
const COMPATIBLE = new Set(["BOOSTER_PACK|BLISTER", "BLISTER|BOOSTER_PACK"]);

/** Flytta stubbens data till den kanoniska produkten och radera stubben. */
/**
 * Har STUBBEN mer meritlista än målet? Då pekar mergen ÅT FEL HÅLL.
 *
 * Cardmarket-offern + prishistoriken ÄR meritlistan: produkten har följts över tid och dess
 * kurva är verifierad. Prisgrafen byggs bara FRAMÅT — den kan inte återskapas retroaktivt
 * (se docs: ingen legitim källa ger äkta historik i efterhand). En merge åt fel håll raderar
 * alltså historik FÖR GOTT och behåller en namnlös butiksstub. Det får aldrig hända, oavsett
 * hur säker LLM:en är på att det är samma SKU.
 */
export async function mergeWouldLoseTrackRecord(stubId: string, canonicalId: string): Promise<boolean> {
  const pick = { offers: { select: { retailer: { select: { name: true } } } }, _count: { select: { priceSnapshots: true } } };
  const [stub, canon] = await Promise.all([
    prisma.product.findUnique({ where: { id: stubId }, select: pick }),
    prisma.product.findUnique({ where: { id: canonicalId }, select: pick }),
  ]);
  if (!stub || !canon) return true; // saknas något → rör inget
  const cm = (p: typeof stub) => p.offers.some((o) => o.retailer.name === "Cardmarket");
  if (cm(stub) && !cm(canon)) return true;
  return stub._count.priceSnapshots > canon._count.priceSnapshots;
}

export async function mergeStubInto(
  stubId: string,
  canonicalId: string,
  log: (msg: string) => void = console.log
): Promise<void> {
  const stub = await prisma.product.findUnique({
    where: { id: stubId },
    select: {
      title: true,
      imageUrl: true,
      offers: {
        select: {
          id: true,
          url: true,
          retailerId: true,
          condition: true,
          language: true,
          retailer: { select: { name: true } },
        },
      },
      watchlistItems: { select: { id: true, userId: true } },
      collectionItems: { select: { id: true } },
    },
  });
  if (!stub) return;
  for (const o of stub.offers) {
    // ⛔ BARA BUTIKS-OFFERS FLYTTAS (ägarbeslut 2026-08-13). En marknadsplatslänk
    //    (Cardmarket/Tradera/CardTrader) är ett PÅSTÅENDE OM IDENTITET som våra egna
    //    jobb fuzzy-matchat fram, inte ett faktum om en URL. Kanonprodukten har redan
    //    sin granskade länk; stubbens är ogranskad, och att flytta över den kan tyst
    //    ersätta ett rätt `idProduct` med ett fel — ett osynligt fel, för priset ser
    //    rimligt ut. Saknar kanonprodukten en länk återställer de dagliga jobben den.
    //    Se NON_STORE_RETAILERS i src/lib/offer-source.ts.
    if (!isStoreRetailer(o.retailer.name)) {
      await prisma.offer.delete({ where: { id: o.id } });
      continue;
    }
    const conflict = await prisma.offer.findFirst({
      where: { productId: canonicalId, retailerId: o.retailerId, condition: o.condition, language: o.language },
      select: { id: true },
    });
    if (conflict) await prisma.offer.delete({ where: { id: o.id } });
    else await prisma.offer.update({ where: { id: o.id }, data: { productId: canonicalId } });
  }
  for (const w of stub.watchlistItems) {
    const dup = await prisma.watchlistItem.findFirst({
      where: { userId: w.userId, productId: canonicalId },
      select: { id: true },
    });
    if (dup) await prisma.watchlistItem.delete({ where: { id: w.id } });
    else await prisma.watchlistItem.update({ where: { id: w.id }, data: { productId: canonicalId } });
  }
  if (stub.collectionItems.length > 0) {
    await prisma.collectionItem.updateMany({
      where: { productId: stubId },
      data: { productId: canonicalId },
    });
  }
  const canonical = await prisma.product.findUnique({ where: { id: canonicalId }, select: { imageUrl: true } });
  if (stub.imageUrl && canonical && !canonical.imageUrl) {
    await prisma.product.update({ where: { id: canonicalId }, data: { imageUrl: stub.imageUrl } });
  }
  await prisma.traderaMatch.deleteMany({ where: { productId: stubId } });
  // Domar som pekar på stubben blir meningslösa när den försvinner (ingen FK → städa
  // manuellt, precis som TraderaMatch ovan). Annars ligger de kvar som skräprader
  // och kan i värsta fall matcha ett återanvänt id.
  await prisma.dedupeVerdict.deleteMany({
    where: { OR: [{ productAId: stubId }, { productBId: stubId }] },
  });
  await prisma.product.delete({ where: { id: stubId } });
  log(`   🔀 mergade "${stub.title}" → ${canonicalId}`);
}

export interface DedupeResult {
  stubs: number;
  llmCalls: number;
  merged: number;
  /** LLM sa "samma SKU" men ordmängden skilde sig → föreslagen, INTE mergad. */
  proposals: number;
  /** Mergade på exakt streckkod — dvs UTAN att kosta ett enda LLM-anrop. */
  gtinMerges: number;
}

export async function dedupeStubs(log: (msg: string) => void = console.log): Promise<DedupeResult> {
  const res: DedupeResult = { stubs: 0, llmCalls: 0, merged: 0, gtinMerges: 0, proposals: 0 };
  // Förslag för mänsklig granskning — speglas till /admin/halsokoll (bara STORE_HEALTH_DB=1).
  const proposalRows: HealthFindingInput[] = [];
  const windowStart = new Date(Date.now() - STUB_WINDOW_DAYS * 24 * 3600 * 1000);

  const stubs = await prisma.product.findMany({
    where: {
      setId: null,
      cardId: null,
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, slug: true, category: true, createdAt: true, gtin: true, language: true },
  });
  res.stubs = stubs.length;
  const catalog = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    // ⛔ `language` är INTE valfri här: katalogens japanska sealed bär Cardmarkets namn
    //    utan språkmarkör, och utan kolumnen läser vakterna dem som ENGELSKA. Det var
    //    precis därför det här jobbet aldrig städade bort JP-stubbarna — se languageMismatch.
    select: { id: true, title: true, slug: true, category: true, setId: true, createdAt: true, gtin: true, language: true },
  });
  log(`[dedupe-stubs] ${stubs.length} stubbar (≤${STUB_WINDOW_DAYS} dgr), ${catalog.length} sealed-produkter i katalogen.`);

  const mergedIds = new Set<string>();
  for (const stub of stubs) {
    if (mergedIds.has(stub.id)) continue;
    const stubTitle = cleanListingTitle(stub.title);

    // ---- GTIN-FÖRFILTER: streckkoden svarar gratis, LLM:en behöver aldrig gissa ----
    // Samma tillverkar-streckkod = definitionsmässigt samma SKU. Merga direkt, hoppa
    // över både poängsättning och Haiku-anropet. Det här är den största par-klassen —
    // att ta bort den före LLM:en är hela poängen med billig blockering + dyr verifiering.
    // Bara TILLVERKARENS kod är identitet — en distributör-EAN (73…) kan delas
    // mellan SKU:er och får varken driva en merge här eller (via gtinConflict
    // nedan) blockera LLM-paret. Se src/lib/gtin.ts.
    if (stub.gtin && isPokemonManufacturerGtin(stub.gtin)) {
      const twin = catalog.find(
        (c) =>
          c.id !== stub.id &&
          !mergedIds.has(c.id) &&
          c.gtin === stub.gtin &&
          // SAMMA STRECKKOD RÄCKER INTE. En butik som säljer ett SORTIMENT (slumpad karaktär)
          // publicerar EN kod som landar på flera karaktärsspecifika produkter. Utan den här
          // raden mergade förfiltret "Pitch Black: GENGAR Premium Checklane" med
          // "…LUXRAY…" (2026-07-14, dry-run) — samma kod, olika Pokémon. Vakterna först.
          !productsConflict(stub.title, c.title, c.language)
      );
      if (twin) {
        // DRY_RUN MÅSTE KOLLAS I *VARJE* MERGE-VÄG. Den här grenen saknade kontrollen, så en
        // körning med DEDUPE_DRY=1 — som utlovade "rör inte databasen" — RADERADE ändå
        // "Pitch Black: Gengar Premium Checklane Blister" (2026-07-14). Produktens
        // prishistorik kaskaderade med (PriceSnapshot/PriceObservation onDelete: Cascade) och
        // gick inte att återskapa. En torrkörning som skriver är värre än ingen torrkörning:
        // den inbjuder till att köra den på en backlogg man inte granskat.
        if (await mergeWouldLoseTrackRecord(stub.id, twin.id)) {
          log(`[dedupe-stubs] HOPPAR ÖVER (GTIN) "${stubTitle}" → "${twin.title}": stubben har mer meritlista.`);
          continue;
        }
        log(
          `${DRY_RUN ? "[DRY] " : ""}[dedupe-stubs] GTIN-träff ${stub.gtin}: "${stubTitle}" → "${twin.title}" (0 tokens)`
        );
        if (!DRY_RUN) await mergeStubInto(stub.id, twin.id, log);
        mergedIds.add(stub.id);
        res.merged++;
        res.gtinMerges++;
        continue;
      }
    }

    const candidates = catalog
      .filter(
        (c) =>
          c.id !== stub.id &&
          !mergedIds.has(c.id) &&
          (c.category === stub.category || COMPATIBLE.has(`${stub.category}|${c.category}`)) &&
          // GTIN-KONFLIKT: båda har kod och de skiljer sig → bevisat OLIKA SKU:er
          // (påse ≠ display). Skicka ALDRIG paret till LLM:en — den har inget att
          // tillföra, och det är precis den sortens par den historiskt mergat fel.
          !gtinConflict(stub.gtin, c.gtin) &&
          // HELA vaktbatteriet — samma som matchProduct kör. Tidigare kördes bara fyra
          // vakter här, så LLM:en fick döma par matchProduct aldrig hade övervägt och
          // sa "samma SKU" om US Version vs vanlig, 2019 vs 25th Anniversary, och ett
          // akrylfodral vs boosterlådan det rymmer (dry-run 2026-07-14).
          !productsConflict(stub.title, c.title, c.language) &&
          // Merge bara in i en mer etablerad produkt (set-märkt eller äldre) —
          // annars kan två färska stubbar sluka varandra åt fel håll.
          (c.setId != null || c.createdAt < stub.createdAt) &&
          !seriesMismatch(stubTitle, c.title) &&
          !setMarkerMismatch(stubTitle, c.title) &&
          !languageMismatch(stubTitle, c.title, c.language) &&
          // Tin-display (låda med flera tins) ≠ enskild tin — hård mekanisk spärr;
          // LLM:en luras annars av "Display = Booster Box"-ekvivalensen.
          !(
            (stub.category === "TIN" || c.category === "TIN") &&
            /\bdisplay\b/i.test(stubTitle) !== /\bdisplay\b/i.test(c.title)
          )
      )
      .map((c) => ({ c, sim: scoreSimilarity(stubTitle, c.title) }))
      .filter((x) => x.sim >= MIN_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_CANDIDATES);

    for (const { c } of candidates) {
      // Identisk ordmängd (era-namn, set-koder och fyllnadsord borträknade) ⇒ samma SKU. Inget annat
      // mergar: det var redan kravet när en LLM-dom låg ovanpå, och den tillförde inget (se filhuvudet).
      if (!mergeEquivalent(stubTitle, c.title)) continue;
      // Meritlistan vinner: pekar mergen åt fel håll (stubben har Cardmarket-länken/prishistoriken)
      // hade den raderat en graf som bara byggs framåt.
      if (await mergeWouldLoseTrackRecord(stub.id, c.id)) {
        log(`[dedupe-stubs] HOPPAR ÖVER "${stubTitle}" → "${c.title}": stubben har mer meritlista (CM/prishistorik) än målet.`);
        continue;
      }
      log(`${DRY_RUN ? "[DRY] " : ""}[dedupe-stubs] mergar "${stubTitle}" → "${c.title}" (identisk ordmängd)`);
      if (!DRY_RUN) await mergeStubInto(stub.id, c.id, log);
      mergedIds.add(stub.id);
      res.merged++;
      break;
    }
  }

  await replaceHealthSection(prisma, "DEDUPE_PROPOSAL", proposalRows);

  log(
    `[dedupe-stubs] klart: ${res.merged} mergade av ${res.stubs} stubbar ` +
      `(${res.gtinMerges} via streckkod).`
  );
  return res;
}
