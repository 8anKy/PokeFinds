"use client";

/**
 * Pärmarna i klienten: EN hämtning per sidladdning delad av skannern,
 * snabbtillägget och produktsidan (alla tre öppnas ofta i följd), plus
 * "senast valda pärm" per enhet så att den som sorterar in en hel bricka i
 * "Byteshögen" slipper välja om för varje kort.
 *
 * ⛔ Cachen är ett MINNE, ingen sanning: varje skrivning som ändrar listan
 *    (skapa/ta bort/döp om) anropar `invalidatePortfolios()`. Servern dömer
 *    ändå — en främmande/raderad pärm i en POST ger 404, aldrig tyst standard.
 */
import { apiFetch } from "@/lib/client-api";
import { LAST_PORTFOLIO_STORAGE_KEY } from "@/lib/portfolio-limit";

export interface PortfolioSummary {
  id: string;
  name: string;
  isPublic: boolean;
  isDefault: boolean;
  itemCount: number;
}

export interface PortfoliosPayload {
  portfolios: PortfolioSummary[];
  limit: number;
  canCreate: boolean;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; data: PortfoliosPayload } | null = null;
let inflight: Promise<PortfoliosPayload> | null = null;

export async function loadPortfolios(opts?: { force?: boolean }): Promise<PortfoliosPayload> {
  if (!opts?.force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = apiFetch<PortfoliosPayload>("/api/portfolios")
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidatePortfolios(): void {
  cache = null;
}

/** Senast valda pärm på den här enheten; null när ingen valts eller lagringen saknas. */
export function getLastPortfolioId(): string | null {
  try {
    return localStorage.getItem(LAST_PORTFOLIO_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastPortfolioId(id: string): void {
  try {
    localStorage.setItem(LAST_PORTFOLIO_STORAGE_KEY, id);
  } catch {
    /* privat läge / kvot — valet gäller ändå för sessionen */
  }
}

/**
 * Vilken pärm som ska vara förvald: senast valda om den finns kvar, annars
 * standardpärmen. Listan kan ha ändrats sedan valet sparades.
 */
export function preferredPortfolioId(portfolios: PortfolioSummary[]): string | null {
  const last = getLastPortfolioId();
  if (last && portfolios.some((p) => p.id === last)) return last;
  return portfolios.find((p) => p.isDefault)?.id ?? portfolios[0]?.id ?? null;
}
