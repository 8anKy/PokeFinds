"use client";

/**
 * "Hur mycket äger jag ur varje set" — EN hämtning (`/api/sets/owned`), delad av /sets-rutorna
 * och setrubriken i Utforska. Bara när fo_auth-hinten säger inloggad: en utloggad besökare
 * väcker aldrig Neon. 60 s minnes-TTL; samma in-flight-löfte delas av komponenter som monterar
 * samtidigt.
 *
 * ⛔ Bar `fetch`, inte `apiFetch`: en inaktuell hint får inte skicka besökaren till
 * inloggningen från en publik sida (apiFetch omdirigerar vid 401).
 */
import { useEffect, useState } from "react";
import { useAuthHint } from "@/lib/auth-hint";

export type OwnedBySet = Record<string, { owned: number; valueOre: number }>;

const TTL_MS = 60_000;
let cache: { at: number; data: OwnedBySet } | null = null;
let inflight: Promise<OwnedBySet | null> | null = null;

function load(): Promise<OwnedBySet | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
  inflight ??= fetch("/api/sets/owned", { credentials: "include" })
    .then((r) => (r.ok ? (r.json() as Promise<OwnedBySet>) : null))
    .then((d) => {
      if (d) cache = { at: Date.now(), data: d };
      return d;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** `null` = inte inläst (eller utloggad); annars setId → ägt. */
export function useOwnedSets(): { loggedIn: boolean | null; owned: OwnedBySet | null } {
  const loggedIn = useAuthHint();
  const [owned, setOwned] = useState<OwnedBySet | null>(cache?.data ?? null);
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    load().then((d) => alive && d && setOwned(d));
    return () => {
      alive = false;
    };
  }, [loggedIn]);
  return { loggedIn, owned };
}

/** Hela kronor, inga ören — rutorna har inte plats för "112 499,86 kr". */
export function formatKrWhole(ore: number | null | undefined, locale: string): string {
  if (ore == null) return "–";
  return `${new Intl.NumberFormat(locale === "en" ? "en-GB" : "sv-SE", { maximumFractionDigits: 0 }).format(Math.round(ore / 100))} kr`;
}
