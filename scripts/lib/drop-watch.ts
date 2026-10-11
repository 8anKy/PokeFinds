/**
 * DOLDA SLÄPP I LANEN (ägarbeslut 2026-10-11) — körtiden runt `src/lib/drop-pages.ts`.
 *
 * Per butik (DROP_STORES): hitta ORIGINALSIDOR med en sök-/rebusinstruktion, bevaka dem
 * medan de är aktiva och leta upp den dolda, köpbara sidan.
 *  · Spelexperten (iButik): sidan hämtas som HTML; koden söks i butikens sök
 *    (`AIR_ibutik.fcgi?funk=gor_sokning`) och träffen vars Artnr ÄR koden tas.
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
import { fetchShopifyPurchasable, verifyStockForUrl } from "../../src/scrapers/stock-verify";
import type { RestockPost } from "../../src/lib/discord-restock";
import type { RouteTable } from "../../src/lib/restock-feed-events";
import {
  htmlToText,
  imageKey,
  normalizeCode,
  pickHiddenCandidate,
  readDropInstruction,
  riddleExcerpt,
  spelexpertenArtnr,
  spelexpertenSearchLinks,
  type DropInstruction,
  type HiddenCandidate,
} from "../../src/lib/drop-pages";

export const DROP_STORES = new Set(["Spelexperten", "Dragon's Lair"]);

const RECHECK_ACTIVE_MS = 90_000;
const RECHECK_OTHER_MS = 6 * 3600_000;
const LIVE_WINDOW_MS = 6 * 3600_000;
const REPOST_AFTER_MS = 24 * 3600_000;
const NEWEST_MAX_AGE_MS = 48 * 3600_000;
const PAGES_PER_TICK = 2;
const SEARCHES_PER_TICK = 2;

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
  /** När rebusen/koden blev aktiv — sökningen ger upp efter LIVE_WINDOW_MS. */
  liveAt?: number;
}

interface DropFile {
  pages: Record<string, DropPage>;
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
  found = 0;
  riddles = 0;

  constructor(private deps: DropWatchDeps) {
    try {
      if (existsSync(deps.file)) {
        const raw = JSON.parse(readFileSync(deps.file, "utf8")) as Partial<DropFile>;
        this.data = { pages: raw.pages ?? {}, alerted: raw.alerted ?? {} };
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

  /** Vilka sidor är det dags att läsa? Aktiva instruktioner först. */
  private duePages(store: string): string[] {
    const now = Date.now();
    const prefix = `${store}\t`;
    const candidates = new Set<string>();
    for (const it of this.feed.get(store) ?? []) {
      // Hypade varor bär köpgränsen i titeln (Dragon's Lair); originalsidan till ett dolt
      // släpp står som slut/kommande (Spelexperten). Båda läses högst var 6:e timme.
      if (/max\.?\s*\d/i.test(it.title) || it.stockStatus !== "IN_STOCK") candidates.add(it.url);
    }
    for (const [key, t] of Object.entries(this.deps.posted())) {
      if (key.startsWith(prefix) && !key.includes("#") && now - t < 14 * 86_400_000) {
        candidates.add(key.slice(prefix.length));
      }
    }
    for (const u of this.newUrls.get(store) ?? []) candidates.add(u);
    for (const [u, p] of Object.entries(this.data.pages)) if (p.store === store && p.instruction) candidates.add(u);

    const due: { url: string; active: boolean }[] = [];
    for (const url of candidates) {
      const p = this.data.pages[url];
      const active = !!p?.instruction;
      const age = p ? now - p.checkedAt : Infinity;
      if (age >= (active ? RECHECK_ACTIVE_MS : RECHECK_OTHER_MS)) due.push({ url, active });
    }
    due.sort((a, b) => Number(b.active) - Number(a.active));
    return due.slice(0, PAGES_PER_TICK).map((d) => d.url);
  }

  async tick(store: string, stopAt: number) {
    if (!DROP_STORES.has(store) || this.busy.has(store)) return;
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
    const seen = (this.feed.get(store) ?? []).find((it) => it.url === url);
    const prev = this.data.pages[url];
    let text = "";
    let priceOre = seen?.price ?? prev?.priceOre ?? null;
    let images: string[] = seen?.imageUrl ? [seen.imageUrl] : [];
    let title = seen?.title ?? prev?.title ?? "";
    let ownCodes: string[] = [];
    if (store === "Spelexperten") {
      const res = await politeFetch(url, { delayMs: 2000 });
      if (!res.ok) return;
      const html = await res.text();
      text = htmlToText(html);
      const artnr = spelexpertenArtnr(html);
      if (artnr) ownCodes = [artnr];
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
      priceOre = oreFromShopify(d.price) ?? priceOre;
      images = [...images, ...(d.images ?? [])];
      title = d.title ?? title;
    }
    const instruction = readDropInstruction(text, prev?.instruction ?? null, ownCodes);
    const becameLive =
      instruction &&
      (instruction.kind === "code" || instruction.phase === "live") &&
      !(prev?.instruction && (prev.instruction.kind === "code" || prev.instruction.phase === "live"));
    this.data.pages[url] = {
      store,
      title,
      instruction,
      priceOre,
      imageKeys: [...new Set(images.map(imageKey).filter(Boolean))],
      checkedAt: Date.now(),
      liveAt: becameLive ? Date.now() : instruction ? prev?.liveAt : undefined,
    };
    this.dirty = true;
    if (instruction && (!prev?.instruction || becameLive)) {
      console.log(
        `[drop-watch] ${store}: ${instruction.kind === "code" ? `sökkod ${instruction.codes.join(" / ")}` : `rebus (${instruction.phase})`} på ${url}`
      );
    }
  }

  /** Leta efter den dolda sidan för butikens aktiva instruktioner. */
  private async hunt(store: string) {
    const now = Date.now();
    const active = Object.entries(this.data.pages).filter(
      ([, p]) =>
        p.store === store &&
        p.instruction &&
        (p.instruction.kind === "code" || p.instruction.phase === "live") &&
        now - (p.liveAt ?? now) < LIVE_WINDOW_MS
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

    if (store === "Spelexperten") {
      // Varje (sida, kod)-par i tur och ordning — två koder på samma sida söks båda.
      const pairs: [string, DropPage, string][] = [];
      for (const [url, p] of active) {
        if (this.wasAlerted(`${store}\t${url}#found`)) continue;
        for (const code of codesOf(p.instruction)) pairs.push([url, p, code]);
      }
      if (!pairs.length) return;
      for (let i = 0; i < Math.min(SEARCHES_PER_TICK, pairs.length); i++) {
        const turn = (this.codeTurn.get(store) ?? 0) % pairs.length;
        this.codeTurn.set(store, turn + 1);
        const [url, p, code] = pairs[turn];
        if (this.wasAlerted(`${store}\t${url}#found`)) continue;
        await this.searchSpelexperten(store, url, p, code);
      }
      return;
    }

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
      if (!pick) {
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

  private async searchSpelexperten(store: string, url: string, p: DropPage, code: string) {
    const res = await politeFetch(
      `${SPELEXPERTEN}/cgi-bin/ibutik/AIR_ibutik.fcgi?funk=gor_sokning&term=${encodeURIComponent(code)}`,
      { delayMs: 2000 }
    );
    if (!res.ok) return;
    const links = spelexpertenSearchLinks(await res.text(), SPELEXPERTEN).filter((u) => u !== url);
    for (const link of links.slice(0, 3)) {
      const key = `${store}\t${link}`;
      if (this.wasAlerted(key)) return;
      const page = await politeFetch(link, { delayMs: 2000 });
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
      if ((await verifyStockForUrl(store, link)) !== "IN_STOCK") return;
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
