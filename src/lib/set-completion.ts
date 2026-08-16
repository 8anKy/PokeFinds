"use client";

/**
 * Hur mycket av ETT set användaren äger — EN hämtning, delad av alla
 * komponenter på setsidan.
 *
 * ⛔ Hämta ALDRIG per kort. Setsidan är ISR-cachad (`revalidate = 3600`) och får
 * inte kalla `auth()`; det personliga tillståndet läses därför klient-sida, och
 * BARA när `fo_auth`-hinten säger att någon är inloggad — en utloggad besökare
 * ska inte generera ett anrop som väcker Neon. Exakt samma mönster (och samma
 * skäl) som `lib/watched-sets.ts`.
 *
 * En in-flight-promise per set gör att progressraden och rutnätets
 * "visa bara saknade"-filter, som monterar i samma renderingssvep, delar ETT
 * anrop i stället för att göra var sitt.
 */

import { useEffect, useState } from "react";
import { useAuthHint } from "@/lib/auth-hint";

export interface SetCompletion {
  /** Nämnaren. ⚠️ Kan vara LÄGRE än `ownedCount` — se services/set-completion.ts. */
  total: number;
  ownedCount: number;
  /** Kort-id:n. Rutnätet filtrerar mot `Product.cardId`. */
  ownedCardIds: Set<string>;
}

/** Kort TTL: siffran ändras av användarens egna klick (snabbtillägg i rutnätet). */
const TTL_MS = 60_000;

const cache = new Map<string, { at: number; data: SetCompletion }>();
const inFlight = new Map<string, Promise<SetCompletion | null>>();

/**
 * `null` = vi vet inte (ej inloggad, nätfel, okänt set). Anroparen ska då rita
 * INGENTING — en nolla hade lästs som "du äger 0 av 165", vilket är en annan
 * sak än att vi inte har svaret.
 */
export async function getSetCompletion(setId: string): Promise<SetCompletion | null> {
  const hit = cache.get(setId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const pending = inFlight.get(setId);
  if (pending) return pending;

  const req = fetch(`/api/sets/${encodeURIComponent(setId)}/completion`, {
    credentials: "include",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { total?: number; ownedCount?: number; ownedCardIds?: string[] } | null) => {
      if (!d || typeof d.total !== "number") return null;
      const data: SetCompletion = {
        total: d.total,
        ownedCount: d.ownedCount ?? 0,
        ownedCardIds: new Set(d.ownedCardIds ?? []),
      };
      cache.set(setId, { at: Date.now(), data });
      return data;
    })
    // Ett misslyckat anrop får INTE cachas — nästa komponent ska få försöka igen.
    .catch(() => null)
    .finally(() => {
      inFlight.delete(setId);
    });

  inFlight.set(setId, req);
  return req;
}

/** Nollställ (utloggning, import av samling) så nästa läsning hämtar färskt. */
export function clearSetCompletionCache(): void {
  cache.clear();
}

/**
 * Reaktiv variant. `setId = null` hoppar över hämtningen helt — används när
 * setet inte har några kort alls (rena sealed-set), då finns inget att räkna.
 */
export function useSetCompletion(setId: string | null): SetCompletion | null {
  const loggedIn = useAuthHint();
  const [data, setData] = useState<SetCompletion | null>(null);

  useEffect(() => {
    if (loggedIn !== true || !setId) {
      setData(null);
      return;
    }
    let cancelled = false;
    void getSetCompletion(setId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, setId]);

  return data;
}
