/**
 * PÄRMAR I SAMLINGEN — taket och pärm→where-översättningen (2026-09-21).
 *
 * En pärm är en ETIKETT på samlingsposten, inte en egen samling: totalvärde,
 * set-komplettering, utmärkelser och veckobrevet räknar fortfarande över alla
 * poster. Pärmen styr vad /samling visar när man väljer den (värde, graf, vinst
 * och topplista följer valet) och om posterna syns på den publika profilen.
 *
 * ⛔ TALEN ÄR PUBLICERADE: "1" / "5" står i prissidans spec-blad på båda språken
 *    (`Pricing.specRows`, raden om pärmar). `tests/unit/portfolio-limit.test.ts`
 *    läser messages-filerna och failar om konstanten och copyn glider isär.
 *
 * ⛔ 1 GRATIS, INTE 2 (ägarbeslut 2026-09-21): den andra pärmen är det första
 *    ögonblicket någon vill ORGANISERA sin samling — det är där paywall-arket
 *    ska stå, precis som gratiskontots enda restock-larm. En Pro som fallit till
 *    Free behåller sina pärmar och kan lägga kort i dem; bara NYA pärmar nekas.
 *
 * ⛔ STANDARDPÄRMEN ÄR `portfolioId = NULL` PÅ POSTEN. Raden med `isDefault`
 *    finns (namn, offentlig-flagga) men dess poster bär null. Därför fick
 *    inga skrivvägar (import, skanner, publikt API) ändras, och därför är
 *    `portfolioItemWhere()` det ENDA stället som får översätta en pärm till
 *    ett where-villkor — sprids "null = standard" ut i rutterna glider det.
 */

export const FREE_PORTFOLIO_LIMIT = 1;
export const PRO_PORTFOLIO_LIMIT = 5;

/** Felkoden klienten reagerar på (öppnar paywall-arket) — aldrig på texten. */
export const PORTFOLIO_LIMIT_CODE = "PORTFOLIO_LIMIT";

export const PORTFOLIO_NAME_MAX = 40;

/** Standardpärmens namn för konton som skapas efter migrationen. */
export const DEFAULT_PORTFOLIO_NAME: Record<"sv" | "en", string> = {
  sv: "Min samling",
  en: "My collection",
};

/** localStorage-nyckel: senast valda pärm i skanner/snabbtillägg (per enhet). */
export const LAST_PORTFOLIO_STORAGE_KEY = "foilio:portfolio:last";

export function portfolioLimit(isPro: boolean): number {
  return isPro ? PRO_PORTFOLIO_LIMIT : FREE_PORTFOLIO_LIMIT;
}

/** Får användaren skapa EN pärm till, givet hur många hen redan har? */
export function canCreatePortfolio(existingCount: number, isPro: boolean): boolean {
  return existingCount < portfolioLimit(isPro);
}

export interface PortfolioRef {
  id: string;
  isDefault: boolean;
}

/**
 * Prisma-where för "posterna i den här pärmen". Standardpärmen = null-posterna.
 * Spreadas in i ett where som redan har `userId`.
 */
export function portfolioItemWhere(p: PortfolioRef): { portfolioId: string | null } {
  return { portfolioId: p.isDefault ? null : p.id };
}

/** Värdet som SKRIVS på posten för pärmen: standard ⇒ null. */
export function portfolioIdForWrite(p: PortfolioRef): string | null {
  return p.isDefault ? null : p.id;
}

/** Vilken pärm en post tillhör, givet listan — null-poster tillhör standardpärmen. */
export function portfolioOfItem<P extends PortfolioRef>(
  portfolios: P[],
  portfolioId: string | null
): P | undefined {
  return portfolioId == null
    ? portfolios.find((p) => p.isDefault)
    : portfolios.find((p) => p.id === portfolioId);
}

/**
 * Trimmat, klippt namn — eller null när det är tomt. Servern och formuläret
 * dömer lika.
 */
export function normalizePortfolioName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, PORTFOLIO_NAME_MAX);
  return name.length > 0 ? name : null;
}
