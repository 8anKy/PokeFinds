/**
 * DOLDA SLÄPP — KOD ELLER REBUS PÅ ORIGINALSIDAN (ägarbeslut 2026-10-11).
 *
 * Spelexperten och Dragon's Lair släpper heta varor via en DOLD produktsida: originalsidan
 * får en instruktion i beskrivningen och den köpbara sidan har en titel som inte liknar
 * varan, så varken feeden (kategori/kollektion) eller vakterna ser den.
 *  · KOD (Spelexperten, "SYL-01"): "skriver du artikelnumret nedan i sökrutan … SYL-01".
 *    Vi söker med koden i BUTIKENS EGEN sök och tar träffen vars artikelnummer ÄR koden —
 *    butiken avgör, så länken kan inte bli fel vara.
 *  · REBUS (Dragon's Lair): "I morgon ersätter vi texten med en enkel rebus …" — ingen kod
 *    att söka på. Vi postar rebusen (läsarna löser den) och letar samtidigt bland butikens
 *    NYASTE produkter efter en som matchar originalet på MINST TVÅ av: samma pris, samma
 *    bild, köpgräns i beskrivningen. Bara om EXAKT EN gör det postas länken.
 *  · LÄNK (Spelexperten 2026-10-12): beskrivningen säger "klicka på det röda ordet" och
 *    ordet länkar till den dolda sidan (rotnivå-URL, titel "POK 30 12 oktober 15:30").
 *    Vi följer LÄNKEN, aldrig ordalydelsen, och bevakar den dolda sidans lager; tiden i
 *    dess titel styr hur tätt.
 * Ren modul: ingen I/O, testad (tests/unit/drop-pages.test.ts).
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aring: "å",
  auml: "ä",
  ouml: "ö",
  Aring: "Å",
  Auml: "Ä",
  Ouml: "Ö",
  eacute: "é",
};

/** HTML → läsbar text: skript/stil bort, taggar → mellanslag, entiteter avkodade. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

export type DropInstruction =
  /**
   * ALLA koder i instruktionen. ⛔ Spelexperten lägger ibland TVÅ koder på samma sida och
   * bara den ena leder till varan — vi väljer inte, butikens sök + artikelnumret avgör
   * (scripts/lib/drop-watch.ts söker varje kod).
   */
  | { kind: "code"; codes: string[] }
  /**
   * LÄNK I BESKRIVNINGEN (Spelexperten 2026-10-12: "klickar du på länken där det står
   * 'röd'" / "klicka här för att komma till rätt produkt"). Ordalydelsen byts varje släpp —
   * vi läser den inte, bara LÄNKARNA i beskrivningen till andra produktsidor i butiken.
   */
  | { kind: "link"; urls: string[] }
  | { kind: "riddle"; phase: "announced" | "live"; text: string };

/** Ord som pekar på en sökinstruktion; koden står strax efter. */
const CODE_ANCHOR = /(sökrutan|sökfältet|sök(?:er)? (?:du )?på|artikelnumret)/gi;
/** "SYL-01", "ETB-30TH", "AB12" — versaler/siffror, med bindestreck eller siffror i. */
const CODE_TOKEN = /\b([A-Z0-9]{2,}(?:-[A-Z0-9]{1,})+|[A-Z]{2,}[0-9]{2,})\b/g;
/** Hur långt efter ankarordet koderna får stå (rutan med en eller två koder). */
const CODE_WINDOW = 160;
/** Förhandsbeskedet ("I morgon ersätter vi texten med en enkel rebus") — inte rebusen själv. */
const ANNOUNCEMENT = /(i\s?morgon|imorgon|ersätter vi|kommer (?:vi )?att|inom kort)/i;
const RIDDLE_WORD = /\b(rebus|gåta|ledtråd)/i;

/**
 * Bär sidtexten en sök-/rebusinstruktion? `previous` = vad vi läste förra gången: en sida
 * som stod på FÖRHANDSBESKED och vars text sedan ändrats är rebusen LIVE — själva rebusen
 * behöver inte innehålla ordet "rebus".
 */
export function readDropInstruction(
  text: string,
  previous?: DropInstruction | null,
  /** Sidans eget artikelnummer — står ofta nära rutan men är aldrig sökkoden. */
  exclude: readonly string[] = []
): DropInstruction | null {
  const skip = new Set(exclude.map(normalizeCode));
  const codes: string[] = [];
  for (const m of text.matchAll(CODE_ANCHOR)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + CODE_WINDOW);
    for (const t of after.matchAll(CODE_TOKEN)) {
      const code = normalizeCode(t[1]);
      if (!skip.has(code) && !codes.includes(code)) codes.push(code);
    }
  }
  if (codes.length) return { kind: "code", codes };
  if (RIDDLE_WORD.test(text)) {
    return { kind: "riddle", phase: ANNOUNCEMENT.test(text) ? "announced" : "live", text };
  }
  if (previous?.kind === "riddle" && previous.phase === "announced" && previous.text !== text) {
    return { kind: "riddle", phase: "live", text };
  }
  return null;
}

/** Ett kort utdrag ur rebustexten till inlägget (aldrig hela sidan). */
export function riddleExcerpt(text: string, max = 400): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

// ---- Spelexperten (iButik) -------------------------------------------------------------

/** "Artnr: POK10463-101-SYL" på produktsidan. */
export function spelexpertenArtnr(html: string): string | null {
  const m = htmlToText(html).match(/Artnr:?\s*([A-Za-z0-9][A-Za-z0-9-]*)/);
  return m ? normalizeCode(m[1]) : null;
}

/**
 * Produktlänkar i sökresultatet — BARA produktkorten (`PT_Beskr`, samma markup som
 * kategorisidan i SpelexpertenAdapter). Sidans meny bär dussintals andra .html-länkar.
 */
export function spelexpertenSearchLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const block of html.split(/class="PT_Beskr/i).slice(1)) {
    const m = block.slice(0, 2000).match(/<a href="((?:https?:\/\/[^"/]+)?\/[^"]+\.html)"/);
    if (m) out.add(m[1].startsWith("http") ? m[1] : `${base}${m[1]}`);
  }
  return [...out];
}

/**
 * Produktlänkar ur SNABBSÖKET (`API.fcgi?funk=as_fil`, rullgardinen under sökrutan): ~2 kB
 * och ~0,1 s mot fullsökets ~330 kB och ~3 s. Matchar namn och ARTIKELNUMMER men inte
 * beskrivningar — precis det kodsökningen vill ha (originalsidan bär koden bara i texten).
 */
export function spelexpertenLiveSearchLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a href="((?:https?:\/\/[^"/]+)?\/[^"]+\.html)" class="LSS_Artikel/g)) {
    out.add(m[1].startsWith("http") ? m[1] : `${base}${m[1]}`);
  }
  return [...out];
}

/** Produktbeskrivningen (iButik: mellan UTSKRIFT:PRODUKTINFO-markörerna), eller null. */
export function spelexpertenDescriptionHtml(html: string): string | null {
  const m = html.match(/<!--\s*UTSKRIFT:PRODUKTINFO:START\s*-->([\s\S]*?)<!--\s*UTSKRIFT:PRODUKTINFO:STOPP\s*-->/i);
  if (m) return m[1];
  return html.match(/id="read-more-text"[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? null;
}

/** href → ren URL: entiteter, mellanslag och "%20" i slutet bort (butiken skrev ".html%20"). */
function cleanHref(href: string): string {
  return href
    .replace(/&amp;/g, "&")
    .trim()
    .replace(/(?:%20|\s)+$/i, "")
    .split("#")[0];
}

/**
 * Länkar i beskrivningen till ANDRA produktsidor hos Spelexperten (`….html`), inte sidan
 * själv, inte cgi-bin. ⛔ Bara beskrivningen — menyn och sidfoten bär hundratals länkar.
 */
export function spelexpertenDropLinks(html: string, base: string, selfUrl: string): string[] {
  const desc = spelexpertenDescriptionHtml(html);
  if (!desc) return [];
  const host = new URL(base).hostname.replace(/^www\./, "");
  const self = selfUrl.split(/[?#]/)[0];
  const out: string[] = [];
  for (const m of desc.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)) {
    let u: URL;
    try {
      u = new URL(cleanHref(m[1]), base);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== host || !/\.html$/i.test(u.pathname) || /cgi-bin/i.test(u.pathname)) continue;
    const url = `${base.replace(/\/$/, "")}${u.pathname}`;
    if (url !== self && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Shopify: länkar i beskrivningen till andra `/products/<handle>` i samma butik. */
export function shopifyDropLinks(descriptionHtml: string, origin: string, selfHandle: string): string[] {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const out: string[] = [];
  for (const m of descriptionHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)) {
    let u: URL;
    try {
      u = new URL(cleanHref(m[1]), origin);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== host) continue;
    const handle = u.pathname.match(/\/products\/([^/?#]+)/)?.[1];
    if (!handle || handle === selfHandle) continue;
    const url = `${origin}/products/${handle}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Spelexpertens vanliga produktsidor ligger under en kategori; den dolda låg i roten. */
export function isRootLevelPage(url: string): boolean {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length === 1;
  } catch {
    return false;
  }
}

/**
 * Är den länkade sidan den dolda varan? ⛔ En länk i en beskrivning kan också vara ett
 * vanligt "se även" — därför:
 *  · en sida som står i butikens VANLIGA feed (kategorin) är inte dold — den sköts av den
 *    vanliga påfyllningsvägen;
 *  · samma pris som originalet räcker (båda släppen 2026-10-12: 689/689 och 349/349);
 *  · annars måste den ligga i ROTEN (utanför kategorierna) OCH bära Pokémon/"POK" i titeln.
 */
export function linkTargetPlausible(t: {
  origPriceOre: number | null;
  priceOre: number | null;
  inFeed: boolean;
  rootLevel: boolean;
  title: string;
}): boolean {
  if (t.inFeed) return false;
  if (t.origPriceOre != null && t.origPriceOre > 0 && t.priceOre === t.origPriceOre) return true;
  return t.rootLevel && /\bpok(?:[eé]mon)?\b/i.test(t.title);
}

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** Stockholmstid (väggklocka) → UTC-ms. */
function stockholmToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  const wall = new Date(guess).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", hourCycle: "h23" });
  const [date, time] = wall.split(" ");
  const [Y, M, D] = date.split("-").map(Number);
  const [H, Mi] = time.split(":").map(Number);
  return guess - (Date.UTC(Y, M - 1, D, H, Mi) - guess);
}

/**
 * Släpptiden ur den dolda sidans titel ("POK 30 12 oktober 15:30" ⇒ 12 okt 15:30 svensk
 * tid). Bara en klockslag ⇒ i dag. null när titeln inte bär någon tid. Styr bara HUR
 * TÄTT sidan läses — lagret avgör fortfarande när vi postar.
 */
export function releaseTimeFromTitle(title: string, now = Date.now()): number | null {
  const t = title.toLowerCase();
  const time = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!time) return null;
  const today = new Date(now).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", hourCycle: "h23" }).split(" ")[0];
  let [y, mo, d] = today.split("-").map(Number);
  mo -= 1;
  const date = t.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})\\b`));
  if (date) {
    d = Number(date[1]);
    mo = MONTHS.indexOf(date[2]);
  }
  return stockholmToUtc(y, mo, d, Number(time[1]), Number(time[2]));
}

/** Ordalydelsen i Spelexpertens kodruta — fullsöket på den hittar ALLA sidor med en kod. */
export const SPELEXPERTEN_CODE_PHRASE = "artikelnumret nedan";

// ---- Matchning av en dold sida (rebusvägen)---------------------------------------------

/** Bildens identitet: filnamnet utan sökväg, query och ändelse. */
export function imageKey(url: string): string {
  const base = url.split("?")[0].split("/").pop() ?? "";
  return base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

const PURCHASE_LIMIT =
  /(max\.?\s*\d+\s*(?:\/|per|st)?\s*(?:kund|hushåll|person)|köpgräns|per hushåll|1 per kund|begränsad till \d+\s*(?:\/|per|st)?\s*(?:kund|hushåll|person))/i;

/** Köpgräns i texten ("Denna artikel är begränsad till 1/hushåll") — hypade varor. */
export function hasPurchaseLimit(text: string): boolean {
  return PURCHASE_LIMIT.test(text);
}

export interface DropOriginal {
  url: string;
  priceOre: number | null;
  imageKeys: string[];
  /** När vi såg rebusen/koden bli aktiv (ms) — tidssignalens mittpunkt. */
  liveAt?: number;
}

export interface HiddenCandidate {
  url: string;
  priceOre: number | null;
  imageKeys: string[];
  /** Beskrivning + titel som text. */
  text: string;
  /** När sidan publicerades (Shopifys `published_at`, ms). */
  publishedAt?: number | null;
}

/** Publicerad så här nära släppet (före ELLER efter) räknas som en signal. */
export const PUBLISH_WINDOW_MS = 30 * 60_000;

export function hiddenSignals(orig: DropOriginal, c: HiddenCandidate): string[] {
  const signals: string[] = [];
  if (orig.priceOre != null && orig.priceOre > 0 && c.priceOre === orig.priceOre) signals.push("pris");
  if (orig.imageKeys.length && c.imageKeys.some((k) => k && orig.imageKeys.includes(k))) signals.push("bild");
  if (PURCHASE_LIMIT.test(c.text)) signals.push("köpgräns");
  // ⛔ Tiden är EN signal, aldrig ensam: andra varor publiceras också mitt på dagen.
  if (orig.liveAt != null && c.publishedAt != null && Math.abs(c.publishedAt - orig.liveAt) <= PUBLISH_WINDOW_MS) {
    signals.push("tid");
  }
  return signals;
}

/**
 * Den dolda sidan, eller null. ⛔ MINST TVÅ signaler OCH exakt en kandidat som har dem —
 * ett pris ensamt är för lätt att träffa av en slump, och två lika bra kandidater är en
 * gissning. Hellre rebusen ensam i kanalen än fel vara.
 */
export function pickHiddenCandidate(
  orig: DropOriginal,
  candidates: readonly HiddenCandidate[]
): { candidate: HiddenCandidate; signals: string[] } | null {
  const strong = candidates
    .filter((c) => c.url !== orig.url)
    .map((c) => ({ candidate: c, signals: hiddenSignals(orig, c) }))
    .filter((x) => x.signals.length >= 2);
  return strong.length === 1 ? strong[0] : null;
}
