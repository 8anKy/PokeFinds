/**
 * DOLDA SLÄPP I LANEN (ägarbeslut 2026-10-11) — körtiden runt `src/lib/drop-pages.ts`.
 *
 * Per butik (DROP_STORES): hitta ORIGINALSIDOR med en sök-/rebusinstruktion, bevaka dem
 * medan de är aktiva och leta upp den dolda, köpbara sidan.
 *  · Spelexperten (iButik): sidan hämtas som HTML; koden söks i butikens sök
 *    (`AIR_ibutik.fcgi?funk=gor_sokning`) och träffen vars Artnr ÄR koden tas.
 *  · LÄNK (Spelexperten 2026-10-12, båda butikerna): beskrivningen länkar till den dolda
 *    sidan ("klicka på det röda ordet"). Länken följs, den dolda sidans lager bevakas och
 *    tiden i dess titel ("POK 30 12 oktober 15:30") styr hur tätt.
 *  · Dragon's Lair (Shopify): sidan hämtas som `/products/<handle>.js`. Shopifys robots.txt
 *    stänger `/search` för robotar, så både kod- och rebusvägen letar bland butikens NYASTE
 *    produkter (`/products.json`, nyast först): en kod i titel/SKU räcker, annars minst två
 *    av pris/bild/köpgräns och exakt en kandidat (`pickHiddenCandidate`).
 * ⛔ Ingen databas, inga nya tjänster. Högst två sidhämtningar + en sökning/nyhetslista per
 *    butik och varv, och bara när något är ATT GÖRA (en sida som inte kollats på 6 h, eller
 *    en aktiv instruktion var 90:e s). Utan aktiva släpp: noll extra förfrågningar.
 * ⛔ Kastar aldrig — ett fel här får inte fälla butikens loop.
 */
import { existsSync, readFileSync } from "node:fs";
import { politeFetch } from "../../src/scrapers/http";
import { fetchShopifyPurchasable, stockFromJsonLd, verifyStockForUrl } from "../../src/scrapers/stock-verify";
import type { RestockPost } from "../../src/lib/discord-restock";
import type { RouteTable } from "../../src/lib/restock-feed-events";
import {
  hasPurchaseLimit,
  htmlToText,
  imageKey,
  isRootLevelPage,
  linkTargetPlausible,
  normalizeCode,
  pickHiddenCandidate,
  releaseTimeFromTitle,
  shopifyDropLinks,
  spelexpertenDropLinks,
  readDropInstruction,
  riddleExcerpt,
  spelexpertenArtnr,
  spelexpertenLiveSearchLinks,
  spelexpertenSearchLinks,
  SPELEXPERTEN_CODE_PHRASE,
  type DropInstruction,
  type HiddenCandidate,
} from "../../src/lib/drop-pages";

export const DROP_STORES = new Set(["Spelexperten", "Dragon's Lair"]);

/** Sida med instruktion: Shopify (CDN) ofta, egen server (Spelexperten) mer sällan. */
const RECHECK_ACTIVE_CDN_MS = 90_000;
const RECHECK_ACTIVE_OWN_MS = 10 * 60_000;
/** Sida i ett HETT set (lanen postat om setet senaste veckan, t.ex. 30th Celebration). */
const RECHECK_HOT_MS = 15 * 60_000;
/**
 * Spelexperten: en LÄNK i beskrivningen syns bara genom att läsa sidan (söket matchar inte
 * ordalydelsen pålitligt — å/ä/ö ger noll träffar och orden byts varje släpp). Heta sidor
 * med köpgräns ("begränsad till 1/hushåll" — båda släppen 2026-10-12) var 2:a min, övriga
 * heta var 10:e.
 */
const RECHECK_HOT_LIMITED_OWN_MS = 2 * 60_000;
const RECHECK_HOT_OWN_MS = 10 * 60_000;
const RECHECK_OTHER_MS = 6 * 3600_000;
const HOT_SET_DAYS = 7;
/** Rebusen jagas så här länge efter att den blev live. Koder jagas så länge de står kvar. */
const LIVE_WINDOW_MS = 6 * 3600_000;
/** En ny/ändrad kod söks FÖRST så här länge — släppet är troligen nu. */
const CODE_PRIORITY_MS = 10 * 60_000;
const REPOST_AFTER_MS = 24 * 3600_000;
const NEWEST_MAX_AGE_MS = 48 * 3600_000;
const PAGES_PER_TICK = 2;
/**
 * Snabba kodloopen: en Spelexperten-sökning var 6:e s (0,17 förfr./s). Medan koder jagas
 * glesas butikens vanliga feed (~12 förfrågningar) ut till 120 s (0,1/s) — totalen stannar
 * kring dagens ~0,27 förfr./s, under taket för egna servrar (restock-poll-interval.ts).
 */
export const FAST_CODE_MS = 3_000;
export const SLOW_FEED_WHILE_CODES_MS = 180_000;
/**
 * SPELEXPERTENS TAKTER (2026-10-12). Upptäckten (fullsök ~330 kB) var 10:e s dagtid, var
 * 60:e s 00–07 svensk tid; kända koder via snabbsöket (~2 kB) var 12:e s; en NY kod var 4:e s
 * i 10 min (släppet är NU); sidläsning (reserv) högst var 30:e s. Med feeden glesad till 180 s
 * blir totalen ~0,3 förfr./s — samma nivå som feeden ensam gav förut. Under de 10 minuterna
 * efter en ny kod är det en kortare topp, en gång per släpp.
 */
const CODE_SEARCH_EVERY_MS = 12_000;
const URGENT_CODE_EVERY_MS = 4_000;
function isNight(): boolean {
  const h = Number(new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }));
  return h >= 0 && h < 7;
}
/** Fullsöket hittar KODER (ASCII-ordalydelse); länkarna hittas av sidläsningen nedan. */
function discoverEveryMs(): number {
  return isNight() ? 120_000 : 15_000;
}
/** En het originalsida läses var 6:e s dagtid (~80 kB gzip) — se RECHECK_HOT_*_OWN_MS. */
function pageReadEveryMs(): number {
  return isNight() ? 60_000 : 6_000;
}

/**
 * LÄNKMÅLETS TAKT (Spelexperten 2026-10-12). Den dolda sidan fanns redan på morgonen
 * (bilden laddades upp 08:50) och titeln bar släpptiden ("15:30"):
 *  · ±släpptiden (−90 s … +15 min): var 5:e s — varannan tick i snabbloopen, så
 *    upptäckt/koder inte svälts;
 *  · före släpptiden: glesare, men alltid en läsning när fönstret öppnar (och högst 5 min
 *    mellan, så ett TIDIGT släpp syns ändå);
 *  · utan tid i titeln: var 5:e s de första 15 min efter att länken dök upp, sedan var 30:e s
 *    (2 min nattetid);
 *  · redan postad: var 5:e min (en påfyllning senare).
 */
const LINK_FAST_MS = 5_000;
const LINK_WINDOW_BEFORE_MS = 90_000;
const LINK_WINDOW_AFTER_MS = 15 * 60_000;
export function linkTargetEveryMs(t: LinkTarget | undefined, now: number, posted: boolean, night = false): number {
  if (!t || t.checkedAt === 0) return 0;
  if (posted) return 5 * 60_000;
  if (t.releaseAt != null) {
    if (now >= t.releaseAt - LINK_WINDOW_BEFORE_MS && now <= t.releaseAt + LINK_WINDOW_AFTER_MS) return LINK_FAST_MS;
    if (now < t.releaseAt) return Math.min(5 * 60_000, Math.max(LINK_FAST_MS, t.releaseAt - LINK_WINDOW_BEFORE_MS - t.checkedAt));
  }
  if (now - t.seenAt < LINK_WINDOW_AFTER_MS) return LINK_FAST_MS;
  return night ? 120_000 : 30_000;
}

/** Länkmålen ur en instruktion. */
function linksOf(i: DropInstruction | null | undefined): string[] {
  return i?.kind === "link" ? i.urls : [];
}

/** Instruktionens identitet — ändras den är släppet troligen NU. */
function signatureOf(i: DropInstruction | null | undefined): string {
  return [...codesOf(i), ...linksOf(i)].join(",");
}

/** Koderna ur en instruktion (äldre drops.json bar ett ensamt `code`). */
function codesOf(i: DropInstruction | null | undefined): string[] {
  if (!i || i.kind !== "code") return [];
  const legacy = (i as unknown as { code?: string }).code;
  return i.codes ?? (legacy ? [legacy] : []);
}

/** Priset ur sidans JSON-LD (`"price": "475.00"`) i öre, eller null. */
function jsonLdPriceOre(html: string): number | null {
  const m = html.match(/"price"\s*:\s*"?(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

interface DropPage {
  store: string;
  title: string;
  instruction: DropInstruction | null;
  priceOre: number | null;
  imageKeys: string[];
  checkedAt: number;
  /** När rebusen/koden blev aktiv (rebusen jagas LIVE_WINDOW_MS, tidssignalens mitt). */
  liveAt?: number;
  /** När sidans nuvarande koduppsättning sågs första gången — ny/ändrad ⇒ sökordning först. */
  codesSeenAt?: number;
  /** Köpgräns i sidtexten — hypade varor läses oftare. */
  limited?: boolean;
  /** Länkmålen (kind "link") och deras senaste läsning. */
  targets?: Record<string, LinkTarget>;
}

export interface LinkTarget {
  title: string;
  priceOre: number | null;
  /** Släpptiden ur titeln (ms), eller null. */
  releaseAt: number | null;
  stock: string | null;
  /** 0 = aldrig läst. */
  checkedAt: number;
  /** När länken dök upp på originalsidan. */
  seenAt: number;
}

interface DropFile {
  pages: Record<string, DropPage>;
  /** Heta set (gemener) → senast sedda i lanens cooldown-karta (ms). */
  hot?: Record<string, number>;
  /** Postade nycklar → tid (dold sida / rebus), så vi inte postar samma sak igen. */
  alerted: Record<string, number>;
}

interface FeedSeen {
  url: string;
  title: string;
  stockStatus: string;
  price: number | null;
  imageUrl: string | null;
}

export interface DropWatchDeps {
  file: string;
  routes: RouteTable;
  /** Lanens cooldown-karta: `butik\turl` → senast postad (ms). */
  posted: () => Record<string, number>;
  publish: (posts: RestockPost[]) => Promise<void>;
  baseUrl: string;
}

const SPELEXPERTEN = "https://www.spelexperten.com";

function shopifyOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function shopifyHandle(url: string): string | null {
  return url.match(/\/products\/([^/?#]+)/)?.[1] ?? null;
}

function oreFromShopify(price: unknown): number | null {
  if (typeof price === "number") return price > 0 ? Math.round(price) : null; // .js: öre
  if (typeof price === "string") {
    const n = Number(price);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; // products.json: kronor
  }
  return null;
}

export class DropWatcher {
  private data: DropFile = { pages: {}, alerted: {} };
  private dirty = false;
  private busy = new Set<string>();
  private feed = new Map<string, FeedSeen[]>();
  private newUrls = new Map<string, Set<string>>();
  private codeTurn = new Map<string, number>();
  private lastRun = new Map<string, number>();
  found = 0;
  riddles = 0;

  constructor(private deps: DropWatchDeps) {
    try {
      if (existsSync(deps.file)) {
        const raw = JSON.parse(readFileSync(deps.file, "utf8")) as Partial<DropFile>;
        this.data = { pages: raw.pages ?? {}, alerted: raw.alerted ?? {}, hot: raw.hot ?? {} };
      }
    } catch {
      this.data = { pages: {}, alerted: {} };
    }
  }

  /** Lanens senaste feed för butiken + URL:er som var nya i state det här varvet. */
  noteFeed(store: string, items: FeedSeen[], fresh: string[]) {
    if (!DROP_STORES.has(store)) return;
    this.feed.set(store, items);
    const set = this.newUrls.get(store) ?? new Set<string>();
    for (const u of fresh) set.add(u);
    this.newUrls.set(store, set);
  }

  /** Serialiserat innehåll när något ändrats, annars null. */
  takeDirty(): string | null {
    if (!this.dirty) return null;
    this.dirty = false;
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const [k, t] of Object.entries(this.data.alerted)) if (t < cutoff) delete this.data.alerted[k];
    return JSON.stringify(this.data);
  }

  private wasAlerted(key: string): boolean {
    const t = this.data.alerted[key];
    return t != null && Date.now() - t < REPOST_AFTER_MS;
  }

  private markAlerted(key: string) {
    this.data.alerted[key] = Date.now();
    this.dirty = true;
  }

  /** Set lanen postat om (alla butiker) senaste veckan — där händer släppen. */
  private hotSets(): Set<string> {
    // ⛔ Lanens cooldown-karta bär bara 24 h (FLAP_WINDOW_HOURS) — minnet i drops.json gör
    //    att "senaste veckan" faktiskt betyder det. Utan det läste första produktionsjobbet
    //    (2026-10-11) slumpvisa sidor i stället för 30th-sidorna.
    const now = Date.now();
    const hot = (this.data.hot ??= {});
    for (const [key, t] of Object.entries(this.deps.posted())) {
      const url = key.slice(key.indexOf("\t") + 1).split("#")[0];
      const set = this.deps.routes[url]?.setName?.toLowerCase();
      if (set && (hot[set] ?? 0) < t) {
        hot[set] = t;
        this.dirty = true;
      }
    }
    const sets = new Set<string>();
    for (const [set, t] of Object.entries(hot)) {
      if (now - t > HOT_SET_DAYS * 86_400_000) delete hot[set];
      else sets.add(set);
    }
    return sets;
  }

  /**
   * Vilka sidor är det dags att läsa? Ordning: aktiv instruktion → hett set → aldrig läst →
   * resten, och inom varje grupp den som legat längst. ⛔ Spelexperten har ~300 slutsålda
   * Pokémon-sidor — utan ordningen tog första varvet ~2,5 h innan 30th-sidorna nåddes.
   */
  private duePages(store: string, max = PAGES_PER_TICK, maxRank = 4): string[] {
    const now = Date.now();
    const prefix = `${store}\t`;
    const hot = this.hotSets();
    const isHot = (url: string, title: string) => {
      const set = this.deps.routes[url]?.setName?.toLowerCase();
      if (set && hot.has(set)) return true;
      const t = title.toLowerCase();
      for (const s of hot) if (s.length >= 6 && t.includes(s)) return true;
      return false;
    };
    const candidates = new Map<string, string>();
    for (const it of this.feed.get(store) ?? []) {
      // Hypade varor bär köpgränsen i titeln (Dragon's Lair); originalsidan till ett dolt
      // släpp står som slut/kommande (Spelexperten).
      if (/max\.?\s*\d/i.test(it.title) || it.stockStatus !== "IN_STOCK") candidates.set(it.url, it.title);
    }
    for (const [key, t] of Object.entries(this.deps.posted())) {
      if (key.startsWith(prefix) && !key.includes("#") && now - t < 14 * 86_400_000) {
        const url = key.slice(prefix.length);
        if (!candidates.has(url)) candidates.set(url, this.deps.routes[url]?.title ?? "");
      }
    }
    for (const u of this.newUrls.get(store) ?? []) if (!candidates.has(u)) candidates.set(u, "");
    for (const [u, p] of Object.entries(this.data.pages)) {
      if (p.store === store && p.instruction && !candidates.has(u)) candidates.set(u, p.title);
    }

    const cdn = store !== "Spelexperten";
    const due: { url: string; rank: number; age: number }[] = [];
    for (const [url, title] of candidates) {
      const p = this.data.pages[url];
      const active = !!p?.instruction;
      const hotPage = isHot(url, title || p?.title || "");
      const limited = hotPage && !!p?.limited;
      const age = p ? now - p.checkedAt : Infinity;
      const every = active
        ? cdn
          ? RECHECK_ACTIVE_CDN_MS
          : RECHECK_ACTIVE_OWN_MS
        : hotPage
          ? cdn
            ? RECHECK_HOT_MS
            : limited
              ? RECHECK_HOT_LIMITED_OWN_MS
              : RECHECK_HOT_OWN_MS
          : RECHECK_OTHER_MS;
      if (age < every) continue;
      // Aktiv → het med köpgräns → het → aldrig läst → resten.
      const rank = active ? 0 : limited ? 1 : hotPage ? 2 : p ? 4 : 3;
      if (rank <= maxRank) due.push({ url, rank, age });
    }
    due.sort((a, b) => a.rank - b.rank || b.age - a.age);
    return due.slice(0, max).map((d) => d.url);
  }

  async tick(store: string, stopAt: number) {
    // Spelexperten sköts helt av snabbloopen (`fastTick`): en förfrågan var 6:e s.
    if (!DROP_STORES.has(store) || store === "Spelexperten" || this.busy.has(store)) return;
    if (stopAt && Date.now() >= stopAt) return;
    this.busy.add(store);
    try {
      for (const url of this.duePages(store)) await this.readPage(store, url);
      this.newUrls.delete(store);
      if (stopAt && Date.now() >= stopAt) return;
      await this.hunt(store);
    } catch (e) {
      console.warn(`[drop-watch] ${store}:`, e instanceof Error ? e.message : e);
    } finally {
      this.busy.delete(store);
    }
  }

  /** Läs originalsidan och dess instruktion. */
  private async readPage(store: string, url: string) {
    if (process.env.DROP_WATCH_DEBUG === "1") console.log(`[drop-watch] läs ${url.slice(-50)} ${new Date().toISOString()}`);
    const seen = (this.feed.get(store) ?? []).find((it) => it.url === url);
    const prev = this.data.pages[url];
    let text = "";
    let priceOre = seen?.price ?? prev?.priceOre ?? null;
    let images: string[] = seen?.imageUrl ? [seen.imageUrl] : [];
    let title = seen?.title ?? prev?.title ?? "";
    let ownCodes: string[] = [];
    let links: string[] = [];
    if (store === "Spelexperten") {
      const res = await politeFetch(url, { delayMs: 2000 });
      if (!res.ok) return;
      const html = await res.text();
      text = htmlToText(html);
      const artnr = spelexpertenArtnr(html);
      if (artnr) ownCodes = [artnr];
      links = spelexpertenDropLinks(html, SPELEXPERTEN, url);
      images = [...images, ...[...html.matchAll(/\/bilder\/artiklar\/[^"?\s]+/g)].map((m) => m[0])];
    } else {
      const origin = shopifyOrigin(url);
      const handle = shopifyHandle(url);
      if (!origin || !handle) return;
      const res = await politeFetch(`${origin}/products/${handle}.js`, {
        delayMs: 800,
        headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
      });
      if (!res.ok) return;
      const d = (await res.json()) as { title?: string; description?: string; price?: number; images?: string[] };
      text = htmlToText(d.description ?? "");
      links = shopifyDropLinks(d.description ?? "", origin, handle);
      priceOre = oreFromShopify(d.price) ?? priceOre;
      images = [...images, ...(d.images ?? [])];
      title = d.title ?? title;
    }
    let instruction = readDropInstruction(text, prev?.instruction ?? null, ownCodes);
    // En länk i beskrivningen slår en rebus (den pekar ut sidan direkt); en kod går före —
    // den sköts av sökvägen som redan är mätt.
    if (links.length && instruction?.kind !== "code") instruction = { kind: "link", urls: links };
    const isLive = (i: DropInstruction | null | undefined) => !!i && (i.kind !== "riddle" || i.phase === "live");
    const becameLive = isLive(instruction) && !isLive(prev?.instruction);
    const codes = signatureOf(instruction);
    // "Ny kod" = den ÄNDRADES på en sida vi kände, eller står på en helt ny sida. En kod vi
    // bara läser för första gången (t.ex. första jobbet efter deployen) är inte en nyhet.
    const knownBefore = !!prev || !!this.newUrls.get(store)?.has(url);
    const codesChanged = codes !== signatureOf(prev?.instruction) && knownBefore;
    const now = Date.now();
    const targets: Record<string, LinkTarget> = {};
    for (const u of linksOf(instruction)) {
      targets[u] = prev?.targets?.[u] ?? { title: "", priceOre: null, releaseAt: null, stock: null, checkedAt: 0, seenAt: now };
    }
    this.data.pages[url] = {
      store,
      title,
      instruction,
      priceOre,
      imageKeys: [...new Set(images.map(imageKey).filter(Boolean))],
      checkedAt: Date.now(),
      liveAt: becameLive ? Date.now() : instruction ? prev?.liveAt : undefined,
      codesSeenAt: codes ? (codesChanged ? Date.now() : (prev?.codesSeenAt ?? 0)) : undefined,
      limited: hasPurchaseLimit(text) || /max\.?\s*\d/i.test(title),
      ...(Object.keys(targets).length ? { targets } : {}),
    };
    this.dirty = true;
    if (instruction && (!prev?.instruction || becameLive || codesChanged)) {
      console.log(
        `[drop-watch] ${store}: ${
          instruction.kind === "code"
            ? `sökkod ${instruction.codes.join(" / ")}`
            : instruction.kind === "link"
              ? `länk till ${instruction.urls.join(" / ")}`
              : `rebus (${instruction.phase})`
        } på ${url}`
      );
    }
  }

  /** Leta efter den dolda sidan för butikens aktiva instruktioner. */
  private async hunt(store: string) {
    const now = Date.now();
    // ⛔ Koder jagas SÅ LÄNGE DE STÅR KVAR: Spelexperten låter koden stå mellan släppen och
    //    kan återanvända samma sida + kod — ett tidsfönster hade tystat nästa släpp. Rebusen
    //    jagas LIVE_WINDOW_MS (bland nyaste produkter, där en gammal rebus bara ger brus).
    const active = Object.entries(this.data.pages).filter(
      ([, p]) =>
        p.store === store &&
        p.instruction &&
        (p.instruction.kind !== "riddle" ||
          (p.instruction.phase === "live" && now - (p.liveAt ?? now) < LIVE_WINDOW_MS))
    );
    if (!active.length) return;

    // Rebusen postas en gång, så läsarna kan lösa den själva medan vi letar.
    for (const [url, p] of active) {
      if (p.instruction?.kind !== "riddle") continue;
      const key = `${store}\t${url}#rebus`;
      if (this.wasAlerted(key)) continue;
      this.markAlerted(key);
      this.riddles++;
      await this.deps.publish([
        this.post(store, url, url, p, {
          kind: "riddle",
          note: `Rebusen är ute: "${riddleExcerpt(p.instruction.text)}" Lös den på butikens sida — hittar vi den riktiga sidan postar vi länken här.`,
        }),
      ]);
    }

    // Spelexpertens koder och länkar sköts av den SNABBA loopen (`fastTick`).
    if (store === "Spelexperten") return;

    // Shopify-länkar: målet läses direkt (CDN), högst tre per varv.
    let checked = 0;
    for (const [url, p] of active) {
      for (const target of linksOf(p.instruction)) {
        if (checked >= 3) break;
        const t = p.targets?.[target];
        if (now - (t?.checkedAt ?? 0) < linkTargetEveryMs(t, now, this.wasAlerted(`${store}\t${target}`), isNight())) continue;
        checked++;
        await this.checkLinkTarget(store, url, p, target);
      }
    }
    if (active.every(([, p]) => p.instruction?.kind === "link")) return;

    // Shopify: butikens nyaste produkter (en förfrågan), gemensamt för alla aktiva sidor.
    const origin = shopifyOrigin(active[0][0]);
    if (!origin) return;
    const res = await politeFetch(`${origin}/products.json?limit=15`, {
      delayMs: 800,
      headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      products?: {
        handle: string;
        title: string;
        body_html?: string;
        created_at?: string;
        published_at?: string;
        images?: { src: string }[];
        variants?: { price: string; sku?: string | null; available?: boolean }[];
      }[];
    };
    // Publiceringen räknas, inte skapandet: en dold sida kan ha förberetts i förväg och
    // publicerats först vid släppet.
    const stamp = (x: { created_at?: string; published_at?: string }) =>
      Math.max(Date.parse(x.created_at ?? "") || 0, Date.parse(x.published_at ?? "") || 0);
    const fresh = (data.products ?? []).filter((x) => now - stamp(x) < NEWEST_MAX_AGE_MS);
    for (const [url, p] of active) {
      const candidates: (HiddenCandidate & { available: boolean; skus: string[] })[] = fresh
        .map((x) => ({
          url: `${origin}/products/${x.handle}`,
          priceOre: oreFromShopify(x.variants?.[0]?.price),
          imageKeys: (x.images ?? []).map((i) => imageKey(i.src)),
          text: `${x.title} ${htmlToText(x.body_html ?? "")}`,
          available: (x.variants ?? []).some((v) => v.available !== false),
          skus: (x.variants ?? []).map((v) => normalizeCode(v.sku ?? "")),
          publishedAt: Date.parse(x.published_at ?? "") || null,
        }))
        .filter((c) => c.url !== url);
      let pick: { url: string; why: string } | null = null;
      if (p.instruction?.kind === "code") {
        // Flera koder (en kan vara en lockkod): bara om EXAKT EN produkt bär någon av dem.
        const codes = codesOf(p.instruction);
        const byCode = candidates.filter((c) =>
          codes.some((code) => c.skus.includes(code) || normalizeCode(c.text).includes(code))
        );
        if (byCode.length === 1) pick = { url: byCode[0].url, why: `sökkoden ${codes.join("/")}` };
      }
      if (!pick && p.instruction?.kind !== "link") {
        const m = pickHiddenCandidate(
          { url, priceOre: p.priceOre, imageKeys: p.imageKeys, liveAt: p.liveAt },
          candidates
        );
        if (m) pick = { url: m.candidate.url, why: `matchar originalet (${m.signals.join(" + ")})` };
      }
      if (!pick) continue;
      const key = `${store}\t${pick.url}`;
      if (this.wasAlerted(key)) continue;
      if ((await fetchShopifyPurchasable(pick.url)) === false) continue;
      const c = candidates.find((x) => x.url === pick!.url);
      if (c && !c.available) continue;
      this.markAlerted(key);
      this.found++;
      console.log(`[drop-watch] ${store}: dold sida ${pick.url} (${pick.why}) för ${url}`);
      await this.deps.publish([
        this.post(store, url, pick.url, { ...p, priceOre: c?.priceOre ?? p.priceOre }, {
          kind: "hidden",
          note:
            p.instruction?.kind === "code"
              ? `Dold produktsida — hittad via sökkoden på butikens sida (${pick.why}).`
              : `Dold produktsida bakom rebusen — hittad bland butikens nya produkter (${pick.why}).`,
        }),
      ]);
    }
  }

  /** (sida, kod)-paren som jagas hos Spelexperten — nya/ändrade koder först. */
  private codePairs(store: string): { urgent: [string, DropPage, string][]; rest: [string, DropPage, string][] } {
    const now = Date.now();
    const urgent: [string, DropPage, string][] = [];
    const rest: [string, DropPage, string][] = [];
    for (const [url, p] of Object.entries(this.data.pages)) {
      if (p.store !== store || p.instruction?.kind !== "code") continue;
      if (this.wasAlerted(`${store}\t${url}#found`)) continue;
      const fresh = p.codesSeenAt != null && now - p.codesSeenAt < CODE_PRIORITY_MS;
      for (const code of codesOf(p.instruction)) (fresh ? urgent : rest).push([url, p, code]);
    }
    return { urgent, rest };
  }

  /** Finns det koder att jaga? Då glesar lanen ut butikens vanliga feed (se scriptet). */
  hasActiveCodes(store: string): boolean {
    const { urgent, rest } = this.codePairs(store);
    return urgent.length + rest.length > 0 || this.linkTargets(store).length > 0;
  }

  /** Alla (originalsida, länkmål) hos butiken. */
  private linkTargets(store: string): [string, DropPage, string][] {
    const out: [string, DropPage, string][] = [];
    for (const [url, p] of Object.entries(this.data.pages)) {
      if (p.store !== store) continue;
      for (const target of linksOf(p.instruction)) out.push([url, p, target]);
    }
    return out;
  }

  /** Det länkmål som är mest försenat, eller null. */
  private dueLinkTarget(store: string): [string, DropPage, string] | null {
    const now = Date.now();
    let best: { pair: [string, DropPage, string]; late: number } | null = null;
    for (const pair of this.linkTargets(store)) {
      const t = pair[1].targets?.[pair[2]];
      const every = linkTargetEveryMs(t, now, this.wasAlerted(`${store}\t${pair[2]}`), isNight());
      const late = now - (t?.checkedAt ?? 0) - every;
      if (late >= 0 && (!best || late > best.late)) best = { pair, late };
    }
    return best?.pair ?? null;
  }

  /**
   * Läs den dolda sidan bakom en länk: titel (släpptiden), pris, lager. I lager + rimlig
   * (`linkTargetPlausible`) ⇒ post, en gång per 24 h och sida.
   */
  private async checkLinkTarget(store: string, origUrl: string, p: DropPage, target: string) {
    if (process.env.DROP_WATCH_DEBUG === "1") console.log(`[drop-watch] länkmål ${target.slice(-50)} ${new Date().toISOString()}`);
    const now = Date.now();
    const prev = p.targets?.[target] ?? { title: "", priceOre: null, releaseAt: null, stock: null, checkedAt: 0, seenAt: now };
    let title = prev.title;
    let priceOre: number | null = null;
    let stock: string | null = null;
    if (store === "Spelexperten") {
      const res = await politeFetch(target, { delayMs: 1000 });
      if (res.ok) {
        const html = await res.text();
        // Rubriken (H1) bär tiden — `<title>` hos "POK 30 12 oktober 15:00" sa bara "POK 30 12 oktober".
        title =
          htmlToText(html.match(/<h1[^>]*id="ArtikelnamnFalt"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
          htmlToText(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "") ||
          title;
        priceOre = jsonLdPriceOre(html);
        stock = stockFromJsonLd(html) ?? (await verifyStockForUrl(store, target));
      }
    } else {
      const origin = shopifyOrigin(target);
      const handle = shopifyHandle(target);
      if (origin && handle) {
        const res = await politeFetch(`${origin}/products/${handle}.js`, {
          delayMs: 800,
          headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
        });
        if (res.ok) {
          const d = (await res.json()) as { title?: string; price?: number; available?: boolean };
          title = d.title ?? title;
          priceOre = oreFromShopify(d.price);
          stock = d.available && (await fetchShopifyPurchasable(target)) !== false ? "IN_STOCK" : "OUT_OF_STOCK";
        }
      }
    }
    const t: LinkTarget = {
      ...prev,
      title,
      priceOre: priceOre ?? prev.priceOre,
      releaseAt: releaseTimeFromTitle(title, now) ?? prev.releaseAt,
      stock: stock ?? prev.stock,
      checkedAt: now,
    };
    // Sidan kan ha lästs om under tiden — skriv på den AKTUELLA posten (finns länken kvar).
    const page = this.data.pages[origUrl];
    if (page?.targets?.[target]) page.targets[target] = t;
    this.dirty = true;
    if (prev.checkedAt === 0) {
      console.log(
        `[drop-watch] ${store}: länkmål ${target} "${title}"` +
          `${t.releaseAt ? ` släpps ${new Date(t.releaseAt).toISOString()}` : ""} — ${stock ?? "okänt lager"}`
      );
    }
    if (stock !== "IN_STOCK") return;
    const key = `${store}\t${target}`;
    if (this.wasAlerted(key)) return;
    const inFeed = (this.feed.get(store) ?? []).some((it) => it.url === target);
    const plausible = linkTargetPlausible({
      origPriceOre: p.priceOre,
      priceOre: t.priceOre,
      inFeed,
      rootLevel: isRootLevelPage(target),
      title,
    });
    this.markAlerted(key);
    if (!plausible) {
      console.log(
        `[drop-watch] ${store}: länkmål ${target} i lager men inte trovärdigt ` +
          `(pris ${t.priceOre} mot ${p.priceOre}${inFeed ? ", står i feeden" : ""}) — postas inte.`
      );
      return;
    }
    this.found++;
    console.log(`[drop-watch] ${store}: dold sida ${target} (länk i beskrivningen) för ${origUrl}`);
    await this.deps.publish([
      this.post(store, origUrl, target, { ...p, priceOre: t.priceOre ?? p.priceOre }, {
        kind: "hidden",
        note: "Dold produktsida — länkad i beskrivningen på butikens vanliga sida.",
      }),
    ]);
  }

  /**
   * SNABBA KODLOOPEN (Spelexperten): EN sökning per anrop, anropas var `FAST_CODE_MS` av
   * scriptet — oberoende av butikens ~60 s feedvarv. En kod = en sökning var 6:e s; nya/
   * ändrade koder går före, övriga turas om. Artighet: butikens feed glesas samtidigt ut
   * till 120 s, så totalen ligger kvar runt dagens ~0,27 förfr./s.
   */
  async fastTick(store: string, stopAt: number) {
    if (store !== "Spelexperten" || this.busy.has(`${store}#fast`)) return;
    if (stopAt && Date.now() >= stopAt) return;
    this.busy.add(`${store}#fast`);
    try {
      const now = Date.now();
      const last = (k: string) => this.lastRun.get(`${store}#${k}`) ?? 0;
      const stamp = (k: string) => this.lastRun.set(`${store}#${k}`, Date.now());

      // 0. LÄNKMÅL (dold sida länkad från originalet) — släppet sker där. Varannan tick som
      //    mest, så att upptäckt/koder/sidläsning aldrig svälts helt.
      const link = last("lastWasLink") ? null : this.dueLinkTarget(store);
      this.lastRun.set(`${store}#lastWasLink`, link ? 1 : 0);
      if (link) {
        await this.checkLinkTarget(store, link[0], link[1], link[2]);
        return;
      }

      // 1. UPPTÄCKT: fullsök på kodrutans ordalydelse ⇒ alla sidor som JUST NU bär en kod.
      //    Koden läggs ut VID släppet (ägaren 2026-10-12: "koden syns först när de säger att
      //    det släpps") — det här är vägen som ser den inom sekunder. Ny sida i träffarna ⇒
      //    läs den och sök koden direkt, i samma anrop.
      if (now - last("discover") >= discoverEveryMs()) {
        stamp("discover");
        await this.discoverSpelexperten(store);
        return;
      }
      // 2. Kända koder via snabbsöket (~2 kB) i tur och ordning.
      const { urgent, rest } = this.codePairs(store);
      const list = urgent.length ? urgent : rest;
      if (list.length && now - last("code") >= (urgent.length ? URGENT_CODE_EVERY_MS : CODE_SEARCH_EVERY_MS)) {
        stamp("code");
        const key = urgent.length ? `${store}#urgent` : store;
        const turn = (this.codeTurn.get(key) ?? 0) % list.length;
        this.codeTurn.set(key, turn + 1);
        const [url, p, code] = list[turn];
        await this.searchSpelexperten(store, url, p, code);
        return;
      }
      // 3. SIDLÄSNING: heta originalsidor i tur och ordning — så hittas LÄNKAR (och koder
      //    med ny ordalydelse). Köpgräns-sidor var 2:a min, andra heta var 10:e, övriga 6 h.
      if (now - last("page") >= pageReadEveryMs()) {
        const [due] = this.duePages(store, 1);
        if (due) {
          stamp("page");
          await this.readPage(store, due);
          this.newUrls.get(store)?.delete(due);
        }
      }
    } catch (e) {
      console.warn(`[drop-watch] ${store} kodsök:`, e instanceof Error ? e.message : e);
    } finally {
      this.busy.delete(`${store}#fast`);
    }
  }

  /**
   * Fullsök på kodrutans ordalydelse. Varje träff är en sida som NU bär en kod; en sida vi
   * inte redan läst med kod (eller inte läst på en minut) läses direkt, och en ny kod söks
   * i samma anrop — upptäckt → kod → dold sida utan att vänta på nästa plats i loopen.
   */
  private async discoverSpelexperten(store: string) {
    if (process.env.DROP_WATCH_DEBUG === "1") console.log(`[drop-watch] upptäck ${new Date().toISOString()}`);
    const res = await politeFetch(
      `${SPELEXPERTEN}/cgi-bin/ibutik/AIR_ibutik.fcgi?funk=gor_sokning&term=${encodeURIComponent(SPELEXPERTEN_CODE_PHRASE)}`,
      { delayMs: 1000 }
    );
    if (!res.ok) return;
    const now = Date.now();
    for (const url of spelexpertenSearchLinks(await res.text(), SPELEXPERTEN).slice(0, 5)) {
      const known = this.data.pages[url];
      const hasCode = codesOf(known?.instruction).length > 0;
      if (hasCode && now - known!.checkedAt < 60_000) continue;
      const before = codesOf(known?.instruction).join(",");
      // En sida som dyker upp här är per definition ändrad/ny ⇒ dess kod är brådskande.
      this.newUrls.set(store, (this.newUrls.get(store) ?? new Set()).add(url));
      await this.readPage(store, url);
      const p = this.data.pages[url];
      const codes = codesOf(p?.instruction);
      if (!p || !codes.length || codes.join(",") === before) continue;
      p.codesSeenAt = Date.now();
      this.dirty = true;
      for (const code of codes) {
        if (this.wasAlerted(`${store}	${url}#found`)) break;
        await this.searchSpelexperten(store, url, p, code);
      }
    }
  }

  private async searchSpelexperten(store: string, url: string, p: DropPage, code: string) {
    if (process.env.DROP_WATCH_DEBUG === "1") console.log(`[drop-watch] sök ${code} ${new Date().toISOString()}`);
    // Snabbsöket (rullgardinen) matchar artikelnummer — ~2 kB. Fullsöket är reserven.
    const live = await politeFetch(
      `${SPELEXPERTEN}/cgi-bin/ibutik/API.fcgi?funk=as_fil&chars=${encodeURIComponent(code)}&retur=html&Sprak_Suffix=SV`,
      { delayMs: 1000 }
    );
    let links: string[];
    if (live.ok) {
      links = spelexpertenLiveSearchLinks(await live.text(), SPELEXPERTEN);
    } else {
      const res = await politeFetch(
        `${SPELEXPERTEN}/cgi-bin/ibutik/AIR_ibutik.fcgi?funk=gor_sokning&term=${encodeURIComponent(code)}`,
        { delayMs: 1000 }
      );
      if (!res.ok) return;
      links = spelexpertenSearchLinks(await res.text(), SPELEXPERTEN);
    }
    links = links.filter((u) => u !== url);
    for (const link of links.slice(0, 3)) {
      const key = `${store}\t${link}`;
      if (this.wasAlerted(key)) return;
      const page = await politeFetch(link, { delayMs: 1000 });
      if (!page.ok) continue;
      const html = await page.text();
      // ⛔ BUTIKENS SÖK AVGÖR, MEN ARTIKELNUMRET MÅSTE VARA KODEN — originalsidan och
      //    andra varor med koden i texten träffar också sökningen.
      if (spelexpertenArtnr(html) !== code) continue;
      // ⛔ LOCKKOD-SPÄRR: står två koder på sidan kan den ena leda till en ANNAN vara.
      //    Den dolda sidan måste vara en Pokémon-vara eller kosta som originalet.
      // ⛔ Bara VARANS egna text (sidtitel + JSON-LD), aldrig hela sidan — menyn bär
      //    "Pokémon" på varje Spelexperten-sida.
      const priceOre = jsonLdPriceOre(html);
      const ownText = [
        html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "",
        ...[...html.matchAll(/"(?:name|description)"\s*:\s*"([^"]{0,500})"/g)].map((m) => m[1]),
      ].join(" ");
      const plausible =
        /pok[eé]mon/i.test(htmlToText(ownText)) ||
        /\/pokemon\//i.test(link) ||
        (priceOre != null && p.priceOre != null && priceOre === p.priceOre);
      if (!plausible) continue;
      // Lagret ur sidan vi redan hämtat (JSON-LD) — en hämtning mindre när det är bråttom.
      const stock = stockFromJsonLd(html) ?? (await verifyStockForUrl(store, link));
      if (stock !== "IN_STOCK") return;
      this.markAlerted(key);
      this.markAlerted(`${store}\t${url}#found`);
      this.found++;
      console.log(`[drop-watch] ${store}: dold sida ${link} (sökkod ${code}) för ${url}`);
      await this.deps.publish([
        this.post(store, url, link, p, {
          kind: "hidden",
          note: `Dold produktsida — hittad via sökkoden ${code} på butikens sida.`,
        }),
      ]);
      return;
    }
  }

  private post(
    store: string,
    originalUrl: string,
    storeUrl: string,
    p: DropPage,
    drop: { kind: "hidden" | "riddle"; note: string }
  ): RestockPost {
    const route = this.deps.routes[originalUrl];
    const site = this.deps.baseUrl.replace(/\/$/, "");
    return {
      key: `${store}\t${storeUrl}${drop.kind === "riddle" ? "#rebus" : ""}`,
      title: route?.title ?? p.title,
      storeName: store,
      storeUrl,
      priceOre: p.priceOre,
      marketValueOre: route?.marketValueOre ?? null,
      soldMedianOre: route?.soldMedianOre ?? null,
      soldCount: route?.soldCount ?? null,
      imageUrl: route?.imageUrl ?? null,
      setName: route?.setName ?? null,
      series: route?.series ?? null,
      language: route?.language ?? null,
      productUrl: route ? `${site}/produkter/${route.slug}` : null,
      productSlug: drop.kind === "hidden" ? (route?.slug ?? null) : null,
      transition: drop.kind === "hidden" ? { from: "ABSENT", to: "IN_STOCK" } : undefined,
      noHit: drop.kind === "riddle",
      drop: { kind: drop.kind, note: drop.note, originalUrl },
    };
  }
}
