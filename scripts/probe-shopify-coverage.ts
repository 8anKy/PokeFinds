/**
 * TÄCKER KOLLEKTIONSFILTRET BUTIKENS POKÉMON-SORTIMENT?
 *
 *   npx tsx scripts/probe-shopify-coverage.ts [--store=Goblinen]
 *
 * Namnfiltret på `collections.json` hittar bara hyllor som HETER något med "pokemon".
 * Wave 5-revisionen (2026-08-13) visade att det missar stora delar av sortimentet när
 * en butik slutar kurera sina kollektioner (Speltrollet: 281 sealed osynliga) eller
 * namnger dem efter TYP i stället för spel (Samlarhobby: 596 osynliga). Fixen är
 * `wholeCatalog`, men den ska bara slås på när det är MÄTT att den vinner något.
 *
 * Den här mätningen jämför, per butik:
 *   kollektionsvägen  = unionen av produkterna i de Pokémon-namngivna kollektionerna
 *   hela katalogen    = /products.json
 * och rapporterar hur många POKÉMON-MÄRKTA produkter som ligger utanför kollektionerna.
 *
 * ⛔ RAPPORT ONLY, och kör lugnt: en request per kollektion + några sidor per butik.
 */
import { setTimeout as sleep } from "node:timers/promises";

const onlyStore = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const H = { cookie: "localization=SE", "accept-language": "sv-SE", "user-agent": "FoilioBot/1.0 (+kontakt: hej@foilio.se)" };
const PAUSE = 400;

/** Shopify-butiker som i dag går via kollektionsfiltret (dvs INTE wholeCatalog). */
const COLLECTION_STORES: Record<string, string> = {
  Goblinen: "https://goblinen.com",
  Manatörsk: "https://manatorsk.com",
  "Beam Cardshop": "https://beamcardshop.com",
  Pokemurre: "https://pokemurre.se",
  AuroraDex: "https://auroradex.se",
  "Tiny Misters": "https://tinymisters.com",
  Cardlevels: "https://cardlevels.se",
  Kortarkivet: "https://www.kortarkivet.se",
  RahTech: "https://rahtech.se",
  "Card Club": "https://cardclub.se",
  Blindbox: "https://blindbox.se",
  "RGB Kingz": "https://rgbkingz.com",
  "Miniature Metropolis": "https://miniaturemetropolis.se",
  Spelgalaxen: "https://spelgalaxen.se",
  Aquitaz: "https://aquitaz.se",
  Rogerz: "https://rogerz.dk",
  "Yonko TCG": "https://yonko-tcg.de",
  Firegames: "https://firegames.se",
};

const NON_SEALED_COLLECTION =
  /l[oö]s(a|t)?[\s-]*kort|l[oö]skort|\bsingles?\b|\bsinglar\b|singel|gradera|\bgraded\b|\bslabs?\b|gosedjur|plush|figur|affisch|poster|kl[äa]der/i;

interface P { id: number; title: string; handle: string; product_type?: string; tags?: string[] }

const hasPokemonMarker = (p: P) =>
  /pok[eé]mon/i.test(p.title) || /pok[eé]mon/i.test(p.product_type ?? "") || (p.tags ?? []).some((t) => /pok[eé]mon/i.test(t));

async function json(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: H });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    await sleep(PAUSE);
  }
}

async function main() {
  for (const [name, base] of Object.entries(COLLECTION_STORES)) {
    if (onlyStore && name !== onlyStore) continue;

    const cj = (await json(`${base}/collections.json?limit=250`)) as { collections?: { handle: string; title: string }[] } | null;
    if (!cj) {
      console.log(`${name.padEnd(22)} collections.json svarade inte — hoppar`);
      continue;
    }
    const handles = (cj.collections ?? [])
      .filter((c) => {
        const s = `${c.handle} ${c.title}`.toLowerCase();
        return /pok[eé]mon/.test(s) && !/lego/.test(s) && !NON_SEALED_COLLECTION.test(s);
      })
      .map((c) => c.handle);

    const inCollections = new Set<number>();
    for (const h of handles.slice(0, 60)) {
      for (let page = 1; page <= 8; page++) {
        const d = (await json(`${base}/collections/${h}/products.json?limit=250&page=${page}`)) as { products?: P[] } | null;
        const batch = d?.products ?? [];
        for (const p of batch) inCollections.add(p.id);
        if (batch.length < 250) break;
      }
    }

    const all: P[] = [];
    for (let page = 1; page <= 20; page++) {
      const d = (await json(`${base}/products.json?limit=250&page=${page}`)) as { products?: P[] } | null;
      const batch = d?.products ?? [];
      all.push(...batch);
      if (batch.length < 250) break;
    }

    const marked = all.filter(hasPokemonMarker);
    const missedMarked = marked.filter((p) => !inCollections.has(p.id));
    console.log(
      `${name.padEnd(22)} kollektioner ${String(handles.length).padStart(3)} → ${String(inCollections.size).padStart(5)} produkter | ` +
        `hela katalogen ${String(all.length).padStart(5)} (${String(marked.length).padStart(5)} pokemon-märkta) | ` +
        `UTANFÖR kollektionerna: ${String(missedMarked.length).padStart(5)}`
    );
    for (const p of missedMarked.slice(0, 8)) console.log(`        · ${p.title}`);
  }
}

main();
