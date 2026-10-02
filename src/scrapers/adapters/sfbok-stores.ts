/**
 * SF-Boks BUTIKSNAMN — uppslagning lagerkod → ort för de namnlösa butikslagren i
 * `warehouseInventories` (`{"warehouseCode":"S020","quantity":19}`).
 *
 * Källan är butikens EGEN butikssida `/sv/butiker` (hittad 2026-10-02): varje butik är
 * ett `"store":{…}`-objekt med `warehouseCode`, `name` och `address.addressLocality`.
 * Då: S010 Stockholm, S020 Malmö, S030 Göteborg, S040 Linköping. robots.txt tillåter
 * allt utom två SEO-botar.
 *
 * ⛔ Hämtas i runtime (24 h cache i processen), aldrig incheckad — en ny butik eller en
 *    flytt hade annars gett ett larm med fel ort. ⛔ FAIL SOFT: namnen är en förbättring
 *    av larmet, inte dess innehåll; utan dem står "N ex i M butiker" som förut.
 */
import { politeFetch } from "../http";

const STORES_URL = "https://www.sfbok.se/sv/butiker";

export interface SfBokStore {
  warehouseCode: string;
  name: string;
  city: string | null;
}

const TTL_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; byCode: Map<string, SfBokStore> } | null = null;

/** Nollställer cachen. Bara för tester. */
export function resetSfBokStoreCache(): void {
  cache = null;
}

/** Klipper ut JSON-objektet som börjar på `start` (måste vara `{`), strängmedvetet. */
function sliceObject(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, k + 1);
  }
  return null;
}

/**
 * Butikerna ur `/sv/butiker` — RSC-flight eller HTML (där objekten ligger `\"`-escapade
 * i `self.__next_f.push`). Ett objekt utan lagerkod eller namn hoppas över.
 */
export function parseSfBokStores(body: string): Map<string, SfBokStore> {
  const text = body.includes("self.__next_f.push") ? body.replace(/\\"/g, '"') : body;
  const out = new Map<string, SfBokStore>();
  const re = /"store":\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const json = sliceObject(text, m.index + '"store":'.length);
    if (!json) continue;
    try {
      const o = JSON.parse(json) as { warehouseCode?: unknown; name?: unknown; address?: { addressLocality?: unknown } };
      const code = typeof o.warehouseCode === "string" ? o.warehouseCode.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!code || !name) continue;
      const city =
        typeof o.address?.addressLocality === "string" && o.address.addressLocality.trim()
          ? o.address.addressLocality.trim()
          : null;
      out.set(code, { warehouseCode: code, name, city });
    } catch {
      /* trasigt objekt — hoppa */
    }
    re.lastIndex = m.index + json.length;
  }
  return out;
}

/** Orten räcker — inlägget säger redan "SF-Bok", och varje ort har en enda butik. */
export function sfbokStoreLabel(store: SfBokStore): string {
  return store.city ?? store.name;
}

/** Butikerna, eller en TOM karta om hämtningen fallerar. Kastar aldrig. */
export async function fetchSfBokStores(): Promise<Map<string, SfBokStore>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byCode;
  try {
    const res = await politeFetch(STORES_URL, { delayMs: 1000, retries: 2, headers: { RSC: "1" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const byCode = parseSfBokStores(await res.text());
    if (byCode.size) cache = { at: Date.now(), byCode };
    else console.warn("[sfbok] Butikssidan gav 0 butiker — markupen har troligen ändrats; larmen visar antal utan namn.");
    return byCode;
  } catch (err) {
    console.warn(
      "[sfbok] Kunde inte hämta butikslistan — larmen visar antal butiker utan namn:",
      err instanceof Error ? err.message : err
    );
    return cache?.byCode ?? new Map();
  }
}
