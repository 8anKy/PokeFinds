/**
 * SAMLINGSIMPORT: från utkastrader till katalogen och vidare in i databasen.
 *
 * Den ENDA delen av importkedjan som rör Prisma — parsning (csv-parse.ts),
 * kolumntolkning (import-mapping.ts) och värdenormalisering (import-normalize.ts,
 * import-rows.ts) är rena moduler med egna tester.
 *
 * ⛔ BEVISSTEGEN ÄR EN STEGE, OCH NAMNET LIGGER LÄNGST NER. Den gamla importen
 * matchade på NAMN med `findMany({ name: { in: … } })` och tog första träffen:
 * "Pikachu" finns på hundratals kort i katalogen, så posten fick ett GODTYCKLIGT
 * kort — fel bild, fel set, fel värde, tyst. Numret är identiteten (samma doktrin
 * som skannern): set + nummer avgör, namnet är sista utvägen och får bara vinna
 * när det är ENTYDIGT. Är det inte entydigt frågar vi användaren — hen vet vilket
 * kort som ligger i pärmen, och det svaret är både gratis och bättre än en
 * gissning.
 *
 * ⛔ INGEN LLM I DEN HÄR VÄGEN. Den är användarutlöst och obegränsad (en fil kan
 * ha tusentals rader); en domare per tveksam rad vore en okontrollerad nota för
 * ett svar användaren själv kan ge på en sekund.
 *
 * ⛔ EN LÄSNING PER IMPORT, ALDRIG PER RAD. Alla uppslag är samlade frågor över
 * hela partiet (kostnadsdoktrinen). En fråga per rad hade hållit Neon vaken i
 * minuter för en enda fil.
 *
 * ⛔ `productId` SÄTTS, INTE BARA `cardId`. Värderingen läser produkten FÖRE
 * kortet (`valueCollectionItems`) och `getCardValues` undantar reverse-varianter
 * med flit — en importerad Reverse Holo som bara bär `cardId` värderas alltså som
 * det ordinarie kortet. Tryckningen bärs av `Product.variantLabel`.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { normalizeTitle } from "@/lib/utils";
import { matchProduct, type MatchIndex } from "@/scrapers/matching";
import { looksSealed, type ImportDraftRow } from "@/lib/import-rows";
import type { CardCondition, CardLanguage } from "@prisma/client";

/** Hur en rad bands till katalogen. Visas för användaren i granskningen. */
export type ImportMatchKind =
  | "slug"
  | "tcgId"
  | "setNumber"
  | "nameNumber"
  | "nameSet"
  | "name"
  | "sealedTitle";

export interface ImportCandidate {
  cardId: string | null;
  productId: string | null;
  title: string;
  setName: string | null;
  number: string | null;
  variantLabel: string | null;
  imageUrl: string | null;
}

export interface ResolvedImportRow {
  row: number;
  status: "matched" | "ambiguous" | "unmatched";
  kind: ImportMatchKind | null;
  match: ImportCandidate | null;
  /** Alternativ att välja mellan när raden är tvetydig. Alltid ≤ MAX_OPTIONS. */
  options: ImportCandidate[];
  /** Filens namn — det som visas för omatchade rader. */
  name: string;
}

/** Fler alternativ än så är ingen valsituation längre, det är en katalogsökning. */
const MAX_OPTIONS = 8;
/** Under det här litar vi inte på en ren titelmatchning för sealed. */
const SEALED_AUTO_CONFIDENCE = 0.85;
/** Chunkstorlek för `IN`-listor. Postgres klarar mer; det här är bara artigt. */
const IN_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Nyckel för namnuppslag: gemener, skiljetecken bort, kollapsad luft. */
function nameKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Skrivsätt att fråga databasen om. `in` kräver EXAKTA strängar, och apparna
 * skriver samma kort olika: "Charizard ex", "Charizard-EX", "Charizard EX".
 * Billigare att skicka med varianterna i samma fråga än att fuzzy-söka i SQL.
 */
function nameVariants(raw: string): string[] {
  const base = raw.trim();
  const out = new Set<string>([base]);
  out.add(base.replace(/[-–]/g, " ").replace(/\s+/g, " ").trim());
  // Butiks-/appsuffix inom parentes ("(Reverse Holo)", "(Full Art)").
  out.add(base.replace(/\s*\([^)]*\)\s*$/, "").trim());
  return [...out].filter(Boolean).slice(0, 4);
}

// ---------- Set-uppslag ----------

interface SetRow {
  id: string;
  name: string;
  externalId: string | null;
  language: CardLanguage;
}

/**
 * Setnamn i filen → vårt set-id.
 *
 * Hela set-tabellen läses EN gång (~270 rader) i stället för en fråga per rad.
 * Matchningen sker sedan i minnet på normaliserat namn, på setkod
 * (`externalId`, "sv3pt5") och på ett par skrivsätt apparna använder
 * ("SV: Scarlet & Violet 151" → "151").
 *
 * ⛔ SPRÅKET AVGÖR VID NAMNKROCK. JP- och EN-set delar latinska namn ("151",
 * "Black Bolt") — det är precis den krocken som skapade 43 stub-dubbletter i
 * butiksmatchningen 2026-09-08. Utan språk vinner EN, för det är den katalogen
 * de här filerna nästan alltid beskriver.
 */
class SetIndex {
  private byName = new Map<string, SetRow[]>();
  private byCode = new Map<string, SetRow[]>();

  constructor(sets: SetRow[]) {
    for (const s of sets) {
      for (const key of setNameKeys(s.name)) push(this.byName, key, s);
      if (s.externalId) push(this.byCode, s.externalId.toLowerCase(), s);
    }
  }

  lookup(setName: string, setCode: string, language: CardLanguage | null): string | null {
    const byCode = setCode ? this.byCode.get(setCode.toLowerCase()) : undefined;
    const hit = byCode?.length ? byCode : this.candidates(setName);
    if (!hit || hit.length === 0) return null;
    if (hit.length === 1) return hit[0].id;
    const lang = language ?? "EN";
    return (hit.find((s) => s.language === lang) ?? hit.find((s) => s.language === "EN") ?? hit[0]).id;
  }

  private candidates(setName: string): SetRow[] | undefined {
    for (const key of setNameKeys(setName)) {
      const hit = this.byName.get(key);
      if (hit?.length) return hit;
    }
    return undefined;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Skrivsätt ett setnamn kan ha i en exportfil. */
function setNameKeys(raw: string): string[] {
  const base = nameKey(raw);
  if (!base) return [];
  const keys = new Set<string>([base]);
  // "sv scarlet violet 151" → "151"; "swsh brilliant stars" → "brilliant stars".
  keys.add(base.replace(/^(sv|swsh|sm|xy|bw|hgss|dp|ex)\b\s*/, "").trim());
  keys.add(base.replace(/^(scarlet violet|sword shield|sun moon|black white)\b\s*/, "").trim());
  keys.add(base.replace(/^pokemon\s+/, "").trim());
  return [...keys].filter(Boolean);
}

// ---------- Matchning ----------

interface CardRow {
  id: string;
  name: string;
  number: string;
  setId: string;
  imageUrl: string | null;
  language: CardLanguage;
  tcgExternalId: string | null;
  set: { name: string; releaseDate: Date | null };
}

interface ProductRow {
  id: string;
  cardId: string | null;
  title: string;
  slug: string;
  imageUrl: string | null;
  variantLabel: string | null;
  setId: string | null;
}

const CARD_SELECT = {
  id: true,
  name: true,
  number: true,
  setId: true,
  imageUrl: true,
  language: true,
  tcgExternalId: true,
  set: { select: { name: true, releaseDate: true } },
} as const;

/**
 * Löser upp ett helt parti utkastrader mot katalogen.
 *
 * Alla frågor nedan är samlade över hela filen, aldrig per rad.
 */
export async function resolveImportRows(rows: ImportDraftRow[]): Promise<ResolvedImportRow[]> {
  if (rows.length === 0) return [];

  const slugs = uniq(rows.map((r) => r.slug).filter(isString));
  const externalIds = uniq(rows.map((r) => r.externalId).filter(isString));
  const names = uniq(rows.flatMap((r) => nameVariants(r.name)));
  const sealedRows = rows.filter(looksSealed);

  const [sets, slugProducts, externalCards, nameCards] = await Promise.all([
    prisma.cardSet.findMany({ select: { id: true, name: true, externalId: true, language: true } }),
    slugs.length
      ? findProducts({ slug: { in: slugs } })
      : Promise.resolve<ProductRow[]>([]),
    externalIds.length
      ? findCards({ tcgExternalId: { in: externalIds } })
      : Promise.resolve<CardRow[]>([]),
    names.length
      ? findCards({ name: { in: names, mode: "insensitive" } })
      : Promise.resolve<CardRow[]>([]),
  ]);

  const setIndex = new SetIndex(sets);

  // Set + nummer är den STARKASTE nyckeln och får inte hänga på att namnet
  // stavas som i vår katalog — därför en egen fråga i stället för att filtrera
  // namnträffarna ovan.
  const setNumberKeys: { setId: string; numbers: string[] }[] = [];
  const rowSetId = new Map<number, string>();
  for (const row of rows) {
    const setId = row.setName || row.setCode
      ? setIndex.lookup(row.setName, row.setCode, row.language)
      : null;
    if (setId) rowSetId.set(row.row, setId);
    if (setId && row.number.candidates.length) {
      setNumberKeys.push({ setId, numbers: row.number.candidates });
    }
  }
  const numberCards = setNumberKeys.length
    ? await findCards({
        setId: { in: uniq(setNumberKeys.map((k) => k.setId)) },
        number: { in: uniq(setNumberKeys.flatMap((k) => k.numbers)), mode: "insensitive" },
      })
    : [];

  const bySetNumber = new Map<string, CardRow[]>();
  for (const c of [...numberCards, ...nameCards]) {
    push(bySetNumber, `${c.setId}::${c.number.toLowerCase()}`, c);
  }
  const byName = new Map<string, CardRow[]>();
  for (const c of nameCards) push(byName, nameKey(c.name), c);

  const productBySlug = new Map(slugProducts.map((p) => [p.slug, p]));
  const tcgById = new Map<string, CardRow>();
  for (const c of externalCards) if (c.tcgExternalId) tcgById.set(c.tcgExternalId, c);

  const sealedIndex = sealedRows.length ? await loadSealedIndex() : null;

  // ---- Steg 1: bestäm KORT/PRODUKT per rad ----
  const drafts = rows.map((row) => resolveOne(row, {
    setIndex,
    rowSetId,
    bySetNumber,
    byName,
    productBySlug,
    tcgById,
  }));

  // ---- Steg 2: sealed-titelmatchning för de rader som inte fick ett kort ----
  if (sealedIndex) {
    const titleCache = new Map<string, { productId: string; confidence: number } | null>();
    for (let i = 0; i < rows.length; i++) {
      const draft = drafts[i];
      if (draft.cards.length > 0 || draft.product) continue;
      const row = rows[i];
      const title = sealedTitle(row);
      if (!titleCache.has(title)) {
        titleCache.set(title, await matchProduct(normalizeTitle(title), sealedIndex, title));
      }
      const hit = titleCache.get(title);
      if (hit) draft.sealed = hit;
    }
  }

  // ---- Steg 3: produkter för de kort som matchat (tryckningen bär värdet) ----
  const cardIds = uniq(drafts.flatMap((d) => d.cards.map((c) => c.id)));
  const productsByCard = new Map<string, ProductRow[]>();
  if (cardIds.length) {
    for (const part of chunk(cardIds, IN_CHUNK)) {
      const products = await findProducts({ cardId: { in: part } });
      for (const p of products) if (p.cardId) push(productsByCard, p.cardId, p);
    }
  }
  const sealedProductIds = uniq(
    drafts.map((d) => d.sealed?.productId).filter(isString)
  );
  const sealedProducts = sealedProductIds.length
    ? await findProducts({ id: { in: sealedProductIds } })
    : [];
  const sealedById = new Map(sealedProducts.map((p) => [p.id, p]));

  return rows.map((row, i) => finalize(row, drafts[i], productsByCard, sealedById));
}

interface RowDraft {
  kind: ImportMatchKind | null;
  /** Kandidatkort. Exakt ett ⇒ träff; flera ⇒ användaren väljer. */
  cards: CardRow[];
  /** Direkt produktträff (slug ur vår egen export). */
  product: ProductRow | null;
  sealed?: { productId: string; confidence: number };
}

function resolveOne(
  row: ImportDraftRow,
  ctx: {
    setIndex: SetIndex;
    rowSetId: Map<number, string>;
    bySetNumber: Map<string, CardRow[]>;
    byName: Map<string, CardRow[]>;
    productBySlug: Map<string, ProductRow>;
    tcgById: Map<string, CardRow>;
  }
): RowDraft {
  // 1. Foilio-slug: vår egen export, exakt även för sealed.
  if (row.slug) {
    const product = ctx.productBySlug.get(row.slug);
    if (product) return { kind: "slug", cards: [], product };
  }
  // 2. pokemontcg.io-id.
  if (row.externalId) {
    const card = ctx.tcgById.get(row.externalId);
    if (card) return { kind: "tcgId", cards: [card], product: null };
  }

  const setId = ctx.rowSetId.get(row.row) ?? null;
  const numbers = row.number.candidates.map((n) => n.toLowerCase());

  // 3. Set + nummer — identiteten.
  if (setId && numbers.length) {
    for (const n of numbers) {
      const hit = ctx.bySetNumber.get(`${setId}::${n}`);
      if (hit?.length) return { kind: "setNumber", cards: dedupeCards(hit), product: null };
    }
  }

  const named = ctx.byName.get(nameKey(row.name)) ?? [];

  // 4. Namn + nummer (utan känt set) — numret skär bort nästan allt.
  if (numbers.length && named.length) {
    const hit = named.filter((c) => numbers.includes(c.number.toLowerCase()));
    if (hit.length) return { kind: "nameNumber", cards: dedupeCards(hit), product: null };
  }

  // 5. Namn + set.
  if (setId && named.length) {
    const hit = named.filter((c) => c.setId === setId);
    if (hit.length) return { kind: "nameSet", cards: dedupeCards(hit), product: null };
  }

  // 6. Enbart nummer + set fanns inte; enbart namn är sista utvägen och vinner
  //    BARA när det är entydigt. Språket får skära (en JP-fil ska inte landa på
  //    det engelska kortet).
  if (named.length) {
    const byLang = row.language ? named.filter((c) => c.language === row.language) : [];
    const pool = byLang.length ? byLang : named;
    return { kind: "name", cards: dedupeCards(pool), product: null };
  }

  return { kind: null, cards: [], product: null };
}

/**
 * Nyaste setet först. Ordningen syns BARA i tvetydighetslistan, men den är inte
 * kosmetisk: en fil som säger "Pikachu" utan set beskriver oftast ett kort man
 * köpt nyligen, och en godtycklig ordning gör listan omöjlig att skumma.
 * Set utan releasedatum hamnar sist — de är promo-/specialset.
 */
function byNewestSet(a: CardRow, b: CardRow): number {
  const at = a.set.releaseDate?.getTime() ?? 0;
  const bt = b.set.releaseDate?.getTime() ?? 0;
  if (at !== bt) return bt - at;
  return a.number.localeCompare(b.number);
}

function dedupeCards(cards: CardRow[]): CardRow[] {
  const seen = new Set<string>();
  const out: CardRow[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function finalize(
  row: ImportDraftRow,
  draft: RowDraft,
  productsByCard: Map<string, ProductRow[]>,
  sealedById: Map<string, ProductRow>
): ResolvedImportRow {
  if (draft.product) {
    return {
      row: row.row,
      status: "matched",
      kind: draft.kind,
      match: candidateFromProduct(draft.product),
      options: [],
      name: row.name,
    };
  }

  if (draft.cards.length > 0) {
    const options = [...draft.cards]
      .sort(byNewestSet)
      .slice(0, MAX_OPTIONS)
      .map((c) => candidateFromCard(c, pickProduct(productsByCard.get(c.id) ?? [], row.variantLabel)));
    // ⛔ ETT kort = träff. Flera = användaren väljer; vi tar ALDRIG det första.
    if (draft.cards.length === 1) {
      return { row: row.row, status: "matched", kind: draft.kind, match: options[0], options: [], name: row.name };
    }
    return { row: row.row, status: "ambiguous", kind: draft.kind, match: null, options, name: row.name };
  }

  if (draft.sealed) {
    const product = sealedById.get(draft.sealed.productId);
    if (product) {
      const candidate = candidateFromProduct(product);
      // Under tröskeln är titelmatchningen ett FÖRSLAG, inte ett svar.
      return draft.sealed.confidence >= SEALED_AUTO_CONFIDENCE
        ? { row: row.row, status: "matched", kind: "sealedTitle", match: candidate, options: [], name: row.name }
        : { row: row.row, status: "ambiguous", kind: "sealedTitle", match: null, options: [candidate], name: row.name };
    }
  }

  return { row: row.row, status: "unmatched", kind: null, match: null, options: [], name: row.name };
}

/**
 * Väljer produkten som bär radens TRYCKNING. Ingen variant i filen ⇒ den
 * ordinarie (`variantLabel === null`), aldrig "första bästa produkt": en rad
 * utan uppgift ska bli den ordinarie tryckningen, det är vad
 * `collection-portfolio.md` kräver (att gissa en variant vore påhitt).
 */
function pickProduct(products: ProductRow[], variantLabel: string | null): ProductRow | null {
  if (products.length === 0) return null;
  if (variantLabel) {
    return products.find((p) => p.variantLabel === variantLabel) ?? products.find((p) => !p.variantLabel) ?? null;
  }
  return products.find((p) => !p.variantLabel) ?? null;
}

function candidateFromCard(card: CardRow, product: ProductRow | null): ImportCandidate {
  return {
    cardId: card.id,
    productId: product?.id ?? null,
    title: card.name,
    setName: card.set.name,
    number: card.number,
    variantLabel: product?.variantLabel ?? null,
    imageUrl: card.imageUrl ?? product?.imageUrl ?? null,
  };
}

function candidateFromProduct(product: ProductRow): ImportCandidate {
  return {
    cardId: product.cardId,
    productId: product.id,
    title: product.title,
    setName: null,
    number: null,
    variantLabel: product.variantLabel,
    imageUrl: product.imageUrl,
  };
}

/** Titeln vi provar mot sealed-katalogen: namn + set när filen har båda. */
function sealedTitle(row: ImportDraftRow): string {
  const name = row.name.trim();
  if (!row.setName) return name;
  return nameKey(name).includes(nameKey(row.setName)) ? name : `${row.setName} ${name}`;
}

/**
 * Sealed-delen av katalogen som ett matchningsindex (~2 100 rader).
 *
 * ⛔ Hela katalogen (~32 000 rader) laddas INTE: den här koden kör i webb-
 * processen, vars minnestak är 384 MB heap med självåtervinning vid 550 MB
 * cgroup — ett index över allt hade varit ett minneshopp per import. Singlar
 * behöver ändå inte titelmatchning; de har set och nummer.
 */
async function loadSealedIndex(): Promise<MatchIndex> {
  return prisma.product.findMany({
    where: { cardId: null, hiddenAt: null },
    select: {
      id: true,
      normalizedTitle: true,
      variantLabel: true,
      language: true,
      card: { select: { name: true, number: true } },
    },
  });
}

function findCards(where: Record<string, unknown>): Promise<CardRow[]> {
  return prisma.card.findMany({ where, select: CARD_SELECT }) as unknown as Promise<CardRow[]>;
}

function findProducts(where: Record<string, unknown>): Promise<ProductRow[]> {
  return prisma.product.findMany({
    where: { ...where, hiddenAt: null },
    select: { id: true, cardId: true, title: true, slug: true, imageUrl: true, variantLabel: true, setId: true },
  }) as unknown as Promise<ProductRow[]>;
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------- Skrivning ----------

export interface CommitItem {
  /** Radnummer i filen — bara för felmeddelanden. */
  row: number;
  name: string;
  cardId: string | null;
  productId: string | null;
  quantity: number;
  condition: CardCondition | null;
  language: CardLanguage | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  estimatedValue: number | null;
  gradingCompany: string | null;
  grade: string | null;
  notes: string | null;
}

export interface CommitInput {
  fileName: string;
  fingerprint: string;
  source: string;
  items: CommitItem[];
}

export interface CommitResult {
  importId: string;
  imported: number;
  matched: number;
}

/** Hela filen skrivs i ett anrop så att importen kan vara atomisk. */
export const IMPORT_CHUNK_LIMIT = 5000;

/**
 * Skriver ett parti rader till samlingen.
 *
 * ⛔ VARJE RAD BLIR EN EGEN POST (lot). Samlingen lagrar poster och VISAR snitt
 * — se `collection-lots.ts`. Att stacka här hade kastat inköpspriset för det
 * andra köpet av samma kort, exakt det fel `addCollectionItem` en gång hade.
 *
 * ⛔ Vi går INTE via `addCollectionItem`: den gör två uppslag per objekt (kort +
 * produkt) plus en stack-fråga, alltså tre frågor per rad. Kopplingen kort↔produkt
 * är redan gjord i matchningen ovan, för hela partiet på en gång.
 */
export async function commitImport(userId: string, input: CommitInput): Promise<CommitResult> {
  if (input.items.length === 0) throw new ServiceError(400, "Importen innehöll inga rader.");
  if (input.items.length > IMPORT_CHUNK_LIMIT) {
    throw new ServiceError(400, "Importen innehåller fler än 5 000 rader.");
  }

  const matched = input.items.filter((i) => i.cardId || i.productId).length;

  // ⛔ Importhuvud + ALLA poster är en transaktion. Om anslutningen eller en
  // FK faller ska användaren få noll nya poster, aldrig en halv samling utan en
  // fungerande ångra-knapp.
  return prisma.$transaction(async (tx) => {
    const record = await tx.collectionImport.create({
      data: {
        userId,
        fileName: input.fileName.slice(0, 200),
        fingerprint: input.fingerprint.slice(0, 64),
        source: input.source.slice(0, 40),
      },
    });

    await tx.collectionItem.createMany({
      data: input.items.map((item) => ({
        userId,
        importId: record.id,
        cardId: item.cardId ?? null,
        productId: item.productId ?? null,
        // ⛔ Namnet bara när posten INTE har ett kort/en produkt — annars kan
        // namnet säga en sak och kortet en annan.
        customTitle: item.cardId || item.productId ? null : item.name.slice(0, 300),
        quantity: Math.max(1, Math.min(item.quantity, 9999)),
        condition: item.condition ?? "NEAR_MINT",
        language: item.language ?? "EN",
        purchasePrice: item.purchasePrice ?? null,
        purchaseDate: item.purchaseDate ? new Date(item.purchaseDate) : null,
        estimatedValue: item.estimatedValue ?? null,
        gradingCompany: item.gradingCompany ?? null,
        grade: item.grade ?? null,
        notes: item.notes ?? null,
      })),
    });

    await tx.collectionImport.update({
      where: { id: record.id },
      data: {
        rowCount: { increment: input.items.length },
        matchedCount: { increment: matched },
      },
    });

    return { importId: record.id, imported: input.items.length, matched };
  });
}

/** Tidigare importer, nyast först. Bär ångra-knappen. */
export async function listImports(userId: string, take = 10) {
  return prisma.collectionImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      fileName: true,
      source: true,
      rowCount: true,
      matchedCount: true,
      createdAt: true,
      undoneAt: true,
    },
  });
}

/**
 * Har användaren redan importerat exakt den här filen?
 *
 * ⛔ Ångrade importer räknas INTE — poängen med att ångra är att kunna göra om.
 */
export async function findDuplicateImport(userId: string, fingerprint: string) {
  return prisma.collectionImport.findFirst({
    where: { userId, fingerprint, undoneAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, createdAt: true, rowCount: true },
  });
}

/**
 * Ångrar en import: raderar de poster som fortfarande hör till den.
 *
 * ⛔ Poster användaren ÄNDRAT sedan importen raderas också — de bär fortfarande
 * `importId`. Alternativet (att jämföra fält mot filen) hade gjort ångra-knappen
 * till en gissning; här är regeln "allt som kom in med den här filen går ut igen",
 * och den är begriplig innan man trycker.
 */
export async function undoImport(userId: string, importId: string): Promise<{ removed: number }> {
  // Samma atomiska löfte som skrivningen: antingen försvinner posterna OCH
  // huvudet märks ångrat, eller inget av det. Annars kan ett avbrott lämna en
  // aktiv import med noll poster som fortfarande dubblettvarnar.
  return prisma.$transaction(async (tx) => {
    const record = await tx.collectionImport.findUnique({ where: { id: importId } });
    if (!record || record.userId !== userId) throw new ServiceError(404, "Importen hittades inte.");
    if (record.undoneAt) throw new ServiceError(409, "Importen är redan ångrad.");

    const { count } = await tx.collectionItem.deleteMany({ where: { userId, importId } });
    await tx.collectionImport.update({
      where: { id: importId },
      data: { undoneAt: new Date() },
    });
    return { removed: count };
  });
}

/** SHA-256 (hex) över filens råa text. Används bara till dubblettvarningen. */
export function fingerprintFile(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
