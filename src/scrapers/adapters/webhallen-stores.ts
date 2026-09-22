/**
 * Webhallens BUTIKSNAMN — uppslagning id → namn/ort för de namnlösa numeriska
 * lagernycklarna i `stock` (`"31": 14`).
 *
 * ⛔ HITTAD 2026-09-22 EFTER ETT FELSLUT. Första probningen gissade endpointen
 * (`/api/store`, `/api/store/{id}`, `/api/section*` — JS-skal eller 404) och
 * slutsatsen blev "det finns ingen publik uppslagning, visa bara ANTAL butiker".
 * Fel: SPA:n anropar `/api/store/se`, vilket står i klartext i deras egen
 * `js/app.*.js` (`r.Z.get("store/se")`). Lärdomen är generell — **läs butikens
 * frontend-bundle innan du förklarar en uppgift omöjlig**; SPA-skalet säger
 * ingenting om vilka API:er som finns bakom.
 *
 * robots.txt (verifierad 2026-09-22) tillåter /api/ — bara /se/member/* och
 * /se/checkout är blockerade.
 */
import { politeFetch } from "../http";

const STORES_URL = "https://www.webhallen.com/api/store/se";

/** En fysisk butik. `city` är ORTEN, som ofta INTE står i namnet ("Ringen" = Stockholm). */
export interface WebhallenStore {
  id: number;
  name: string;
  city: string | null;
}

interface StoreApiResponse {
  stores?: { id?: unknown; name?: unknown; city?: unknown }[];
}

/**
 * Cache i PROCESSEN, 24 h. Butikslistan ändras när Webhallen öppnar eller stänger en
 * butik — dvs sällan — men den hämtas ändå på nytt varje körning i stället för att
 * checkas in som en fil: en incheckad lista blir tyst inaktuell den dag en butik
 * öppnar, och då står ett larm med fel ortsnamn i en publik kanal. Kostnaden är EN
 * 12 kB-hämtning per process, mot de ~88 förfrågningar Webhallen-adaptern redan gör
 * per feedhämtning.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; byId: Map<number, WebhallenStore> } | null = null;

/** Nollställer cachen. Bara för tester. */
export function resetWebhallenStoreCache(): void {
  cache = null;
}

export function parseWebhallenStores(body: unknown): Map<number, WebhallenStore> {
  const out = new Map<number, WebhallenStore>();
  const list = (body as StoreApiResponse | null)?.stores;
  if (!Array.isArray(list)) return out;
  for (const s of list) {
    const id = typeof s?.id === "number" ? s.id : null;
    const name = typeof s?.name === "string" ? s.name.trim() : "";
    if (id == null || !name) continue;
    const city = typeof s?.city === "string" && s.city.trim() ? s.city.trim() : null;
    out.set(id, { id, name, city });
  }
  return out;
}

/**
 * Butikerna, eller en TOM karta om hämtningen fallerar.
 *
 * ⛔ FAIL SOFT, ALDRIG KAST. Namnen är en förbättring av larmet, inte dess innehåll —
 * ett nere-API hos Webhallen får aldrig tysta ett restock-larm. Utan namn faller
 * inlägget tillbaka på "N ex i M butiker", precis som SF-Bok redan gör.
 */
export async function fetchWebhallenStores(): Promise<Map<number, WebhallenStore>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byId;
  try {
    const res = await politeFetch(STORES_URL, { delayMs: 500, retries: 2 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const byId = parseWebhallenStores(await res.json());
    if (byId.size) cache = { at: Date.now(), byId };
    return byId;
  } catch (err) {
    console.warn(
      "[webhallen] Kunde inte hämta butikslistan — larmen visar antal butiker utan namn:",
      err instanceof Error ? err.message : err
    );
    return cache?.byId ?? new Map();
  }
}

/**
 * "Bredden (InfraCity), Upplands Väsby". Orten läggs till bara när den inte redan
 * framgår av namnet — "Solna Centrum, Solna" är brus, medan "Ringen" utan
 * "Stockholm" är obrukbart för den som ska åka dit.
 */
export function storeLabel(store: WebhallenStore): string {
  if (!store.city) return store.name;
  const name = store.name.toLowerCase();
  const city = store.city.toLowerCase();
  return name.includes(city) || city.includes(name) ? store.name : `${store.name}, ${store.city}`;
}
