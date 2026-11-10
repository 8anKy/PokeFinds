/**
 * ONE PIECE-ANNONSER (2026-11-10, One Piece steg 1). Ren modul — delas av nattens butiksskrapning
 * (matchProduct), Discord-lanen och testerna.
 *
 * Butikerna skriver One Piece på ett helt annat sätt än Pokémon (mätt hos Kortarkivet, Speltrollet,
 * Yonko TCG 2026-11-10): "One Piece TCG: The Time of Battle Booster Box (OP-16)", "One Piece Card
 * Game: Romance Dawn [OP-01] Booster (Japansk version)", "[JP] One Piece · Card Game Display -
 * Royal Bloodline (OP-10)", "ST32 Starter Deck - Green Roronoa Zoro". Därför en EGEN dom i stället
 * för att vidga Pokémon-matcharens vakter:
 *  1. Spelet avgörs på annonsen: "One Piece" i titeln (eller sökvägen) ⇒ One Piece.
 *  2. ⛔ Katalogen är ENGELSK (leverantören har ingen japansk One Piece). Varje annons med en
 *     asiatisk språkmarkör matchar INGENTING — en stor del av butikernas One Piece är japansk.
 *  3. Setet avgörs på KODEN ("OP-16", "[EB-03]", "ST32", "PRB-02") eller, utan kod, på setets namn.
 *  4. Formen (box/display, booster, sleeved booster, startdäck, double pack …) måste vara samma.
 *  5. EN kandidat kvar ⇒ träff. Noll eller flera ⇒ ingen träff. Identitet gissas aldrig.
 */

export interface OpCatalogSet {
  id: string;
  name: string;
  /** "OP-09", "EB05", "ST32" … (CardSet.code). */
  code: string | null;
}

export interface OpCatalogProduct {
  id: string;
  title: string;
  setId: string | null;
}

export type OpForm = "box" | "booster" | "sleeved" | "deck" | "double" | "tin" | "collection" | "case" | "other";

/** Är annonsen One Piece? Titeln räcker nästan alltid; sökvägen fångar butiker som utelämnar ordet. */
export function isOnePieceListing(title: string, url?: string | null): boolean {
  if (/one[\s-]?piece/i.test(title)) return true;
  return !!url && /one[-_]?piece/i.test(url);
}

/**
 * Asiatisk utgåva? ⛔ Allowlist åt andra hållet: hellre en missad engelsk annons än en japansk box
 * med det engelska priset. "[JP]", "(JP)", "JP-", "Japansk", "Japanese", "Japan", "Chinese",
 * "Korean", "Asia" och kinesiska/koreanska förkortningar.
 */
export function isAsianOnePieceListing(title: string): boolean {
  return /\[(?:jp|jpn|cn|chn|kr|kor)\]|\((?:jp|jpn|cn|chn|kr|kor)\)|\bjp\b|\bjpn\b|japansk|japanese|\bjapan\b|kinesisk|chinese|koreansk|korean|\basia(?:n)?\b|\bs-?chn\b|\bt-?chn\b/i.test(
    title
  );
}

/** "OP-09" / "op09" / "OP 9" / "[EB-03]" / "ST32" / "PRB-02" ⇒ "OP09", "EB03", "ST32", "PRB02". */
export function normalizeOpCode(raw: string): string | null {
  const m = /^\s*\[?\s*(op|eb|st|prb)\s*-?\s*(\d{1,2})\s*\]?\s*$/i.exec(raw);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2].padStart(2, "0")}`;
}

/** Alla setkoder i en titel, normaliserade. Kortnummer ("EB02-003") räknas inte — de är singlar. */
export function opCodesInTitle(title: string): string[] {
  const out = new Set<string>();
  // Ingen lookbehind (äldre WebKit kastar SyntaxError vid modulladdning) — prefixet fångas i stället.
  const re = /(?:^|[^a-z0-9])(op|eb|st|prb)\s*-?\s*(\d{1,2})(?![0-9])(?!\s*-\s*\d{3})/gi;
  for (const m of title.matchAll(re)) out.add(`${m[1].toUpperCase()}${m[2].padStart(2, "0")}`);
  return [...out];
}

/** Produktens/annonsens form. Ordningen spelar roll: "Booster Box Case" är en case, inte en box. */
export function opForm(title: string): OpForm {
  const t = title.toLowerCase();
  if (/\bcase\b/.test(t)) return "case";
  // En engelsk One Piece-"blister" ÄR sleeved booster (Sweet Nerds säljer båda bredvid varandra).
  if (/\bsleeved\b|\bblister\b/.test(t)) return "sleeved";
  if (/\bdouble\s*pack\b/.test(t)) return "double";
  if (/\b(?:starter|ultra)\s*deck\b|\bstart\s*deck\b/.test(t)) return "deck";
  if (/\bbooster\s*box\b|\bdisplay\b|\bbox\s*\(\s*24/.test(t)) return "box";
  if (/\btin\b/.test(t)) return "tin";
  if (/\b(?:illustration\s*box|premium\s*card\s*collection|gift\s*collection|devil\s*fruits\s*collection|anniversary\s*set|special\s*don!!\s*set|treasure\s*boosters?\s*set)\b/.test(t))
    return "collection";
  if (/\bbooster(?:\s*pack)?\b|\bpack\b/.test(t)) return "booster";
  return "other";
}

/**
 * Setnamn utan spelets egna ord. Leverantören har ett pseudo-set som heter "One Piece" (tillbehör)
 * och set som "One Piece Card The Best Vol.2" — orden står i VARJE annons och fick matcharen att se
 * "kod + ett annat sets namn" (mätt 2026-11-10: Bonney ST-24 och The Best Vol.2 föll så).
 */
const setNameKey = (s: string) =>
  norm(s)
    .replace(/\b(?:one piece|card game|card|tcg)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Utan set: produktens HELA namn i annonsen ("Double Pack Set Vol.10 (DP-10)", "Premium Card
 * Collection – Best Selection Vol. 3"). Längsta namnet vinner; två lika långa ⇒ ingen träff.
 */
function byFullTitle(ntitle: string, form: OpForm, products: OpCatalogProduct[]): string | null {
  const hits = products
    .map((p) => ({ id: p.id, key: norm(p.title) }))
    .filter((p) => p.key.length >= 10 && opForm(p.key) === form && ntitle.includes(` ${p.key} `))
    .sort((a, b) => b.key.length - a.key.length);
  if (hits.length === 0) return null;
  if (hits.length > 1 && hits[0].key.length === hits[1].key.length) return null;
  return hits[0].id;
}

/**
 * Annonsen → katalogprodukt, eller null. Se modulens filhuvud för domens steg.
 * `catalog` = One Piece-seten och -produkterna (produkterna bär sitt set).
 */
export function matchOnePieceListing(
  title: string,
  catalog: { sets: OpCatalogSet[]; products: OpCatalogProduct[] }
): string | null {
  if (isAsianOnePieceListing(title)) return null;
  const form = opForm(title);
  if (form === "case" || form === "other") return null;

  // Setet: koden först, annars setets namn (längsta namnet som står i titeln vinner).
  const codes = opCodesInTitle(title);
  const setByCode = new Map<string, OpCatalogSet>();
  for (const s of catalog.sets) {
    const c = s.code ? normalizeOpCode(s.code) : null;
    if (c) setByCode.set(c, s);
  }
  const setIds = new Set<string>();
  for (const c of codes) {
    const s = setByCode.get(c);
    if (s) setIds.add(s.id);
  }
  // Setets namn i titeln (längsta vinner — "The Best Vol.2" före "The Best").
  const ntitle = ` ${norm(title)} `;
  const named = catalog.sets
    .map((s) => ({ s, key: setNameKey(s.name) }))
    .filter(({ key }) => key.length >= 6 && ntitle.includes(` ${key} `))
    .sort((a, b) => b.key.length - a.key.length)
    .map(({ s }) => s);
  if (setIds.size === 0 && named.length > 0) setIds.add(named[0].id);
  // ⛔ En kod och ett ANNAT sets namn i samma titel ⇒ vi vet inte vilket.
  else if (setIds.size === 1 && named.length > 0 && !setIds.has(named[0].id)) return null;
  if (setIds.size === 0) return byFullTitle(ntitle, form, catalog.products);
  if (setIds.size !== 1) return null;
  const setId = [...setIds][0];

  const candidates = catalog.products.filter((p) => p.setId === setId && opForm(p.title) === form);
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length === 0) return null;

  // Flera i samma form (vanlig + "Pre-Errata", startdäck i samma set): varje produkts
  // SÄRSKILJANDE ord (utöver setnamn och formord) måste stå i annonsen. Bland de som passar vinner
  // den mest specifika — "Booster Box Pre-Errata" ⇒ Pre-Errata, "Booster Box" ⇒ den vanliga.
  const setName = norm(catalog.sets.find((s) => s.id === setId)?.name ?? "");
  const STOP = new Set(["starter", "deck", "booster", "box", "pack", "set", "the", "of", "and", "vol", "ex", ...setName.split(" ")]);
  const scored = candidates
    .map((p) => {
      const words = norm(p.title).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
      return { id: p.id, n: words.length, fits: words.every((w) => ntitle.includes(` ${w} `)) };
    })
    .filter((c) => c.fits)
    .sort((a, b) => b.n - a.n);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].n === scored[1].n) return null;
  return scored[0].id;
}
