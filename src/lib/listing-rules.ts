/**
 * Regler för köp/sälj/byt-trådar i forumet. REN modul (ingen Prisma, ingen Next)
 * så att API-rutten och testerna delar exakt samma dom.
 *
 * ⛔ Foilio är aldrig part i affären — tråden är en anslagstavla. Reglerna här
 * handlar bara om att en annons ska vara BEGRIPLIG: en "Säljes" utan pris är
 * ett gissningsspel, en "Bytes" med pris är en försäljning i förklädnad, och
 * marknadsfält i en vanlig diskussionsgrupp gör flödet oläsligt.
 */

export type ListingKindValue = "SELL" | "BUY" | "TRADE";
export type ListingStatusValue = "ACTIVE" | "SOLD" | "CLOSED";

export const LISTING_KINDS: readonly ListingKindValue[] = ["SELL", "BUY", "TRADE"];
export const LISTING_STATUSES: readonly ListingStatusValue[] = ["ACTIVE", "SOLD", "CLOSED"];

/**
 * Skick som säljaren kan välja. Samma nycklar som `CardCondition` i schemat och
 * `Condition`-namnrymden i messages — därför lagras NYCKELN, aldrig etiketten.
 * POOR utelämnas med flit: ingen listar ett kort som "Poor", och ett val ingen
 * använder är bara brus i en select.
 */
export const LISTING_CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "EXCELLENT",
  "GOOD",
  "PLAYED",
  "SEALED",
] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export function isListingCondition(value: unknown): value is ListingCondition {
  return typeof value === "string" && (LISTING_CONDITIONS as readonly string[]).includes(value);
}

/** Pristak i öre — 1 000 000 kr. Ett högre tal är ett felslag, inte en annons. */
export const MAX_PRICE_ORE = 100_000_000;

/**
 * Bara Traderas egen sajt, bara https. Vi länkar aldrig ut till något annat
 * från en annons — en "Tradera-länk" som pekar på en främmande domän är exakt
 * hur en bluff ser ut.
 */
export function isTraderaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "www.tradera.com";
}

export interface ListingInput {
  isMarketplace: boolean;
  listingKind?: ListingKindValue | null;
  priceOre?: number | null;
  condition?: string | null;
  productId?: string | null;
  traderaUrl?: string | null;
}

export type ListingValidation = { ok: true } | { ok: false; message: string };

function hasPrice(priceOre: number | null | undefined): boolean {
  return typeof priceOre === "number" && Number.isFinite(priceOre) && priceOre !== 0;
}

/**
 * Domen. Svenska felmeddelanden med flit: de går rakt ut som `ServiceError`
 * ur API-rutten, precis som resten av kodbasens API-fel.
 */
export function validateListing(input: ListingInput): ListingValidation {
  const { isMarketplace, listingKind, priceOre, condition, productId, traderaUrl } = input;

  if (!isMarketplace) {
    if (listingKind || hasPrice(priceOre) || condition || productId || traderaUrl) {
      return {
        ok: false,
        message: "Köp/sälj/byt-fält kan bara användas i marknadsgruppen.",
      };
    }
    return { ok: true };
  }

  if (!listingKind) {
    return { ok: false, message: "Välj om tråden är Säljes, Köpes eller Bytes." };
  }
  if (!LISTING_KINDS.includes(listingKind)) {
    return { ok: false, message: "Okänd annonstyp." };
  }

  if (hasPrice(priceOre)) {
    if (!Number.isInteger(priceOre) || (priceOre as number) < 0) {
      return { ok: false, message: "Priset måste vara ett positivt belopp." };
    }
    if ((priceOre as number) > MAX_PRICE_ORE) {
      return { ok: false, message: "Priset är orimligt högt — kontrollera beloppet." };
    }
  }

  if (listingKind === "SELL" && !(hasPrice(priceOre) && (priceOre as number) > 0)) {
    return { ok: false, message: "Ange ett pris för det du säljer." };
  }
  if (listingKind === "TRADE" && hasPrice(priceOre)) {
    return { ok: false, message: "En bytesannons har inget pris — vill du sälja, välj Säljes." };
  }

  if (condition != null && condition !== "" && !isListingCondition(condition)) {
    return { ok: false, message: "Okänt skick." };
  }

  if (traderaUrl && !isTraderaUrl(traderaUrl)) {
    return { ok: false, message: "Tradera-länken måste börja med https://www.tradera.com/." };
  }

  return { ok: true };
}

/**
 * Får `actor` sätta `next` på en annons? Ägaren styr sin egen annons helt;
 * en moderator får bara STÄNGA (aldrig markera som såld — det är säljarens
 * påstående om en affär vi inte sett).
 */
export function canSetListingStatus(input: {
  isOwner: boolean;
  isModerator: boolean;
  next: ListingStatusValue;
}): boolean {
  if (input.isOwner) return true;
  return input.isModerator && input.next === "CLOSED";
}

/** Kronor (som användaren skriver dem: "1 250", "99,50") → öre, eller null om ogiltigt. */
export function parseKronorToOre(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kr = Number(cleaned);
  if (!Number.isFinite(kr)) return null;
  return Math.round(kr * 100);
}
