/**
 * PERSISTENT ISR-CACHE PÅ EN RAILWAY-VOLYM (2026-08-29).
 *
 * VARFÖR: Nexts inbyggda cache bor i containerns `.next/` och KASTAS vid varje
 * deploy (16 deployer 2026-08-29). Med ~63 600 produktvägar och ett crawlersvep
 * som tar 14–23 dygn på sig runt ytan var träffkvoten ≈ 0: nästan varje
 * crawler-träff blev en kall rendering med ~25–50 Neon-frågor, och det var
 * DET — inte jobben — som höll Neon vaken ~19 h/dygn (mätt 2026-08-26,
 * `scripts/neon-wake-attribution.ts`). En rendering per sida per 30 dygn i
 * stället för per timme kräver att posten ÖVERLEVER deployen. Därav den här
 * modulen: samma kontrakt som Nexts `FileSystemCache` (14.2), men lagret ligger
 * i `ISR_CACHE_DIR` (default `$RAILWAY_VOLUME_MOUNT_PATH/isr`), gzip-packat.
 *
 * TRE LAGER, i ordning: minnes-LRU (samma tak som `cacheMaxMemorySize`) →
 * volymen → byggets egna prerenderade filer i `.next/server/app` (seed, exakt
 * som FileSystemCache läser dem).
 *
 * ⛔ SIDOR DELAS ÖVER BYGGEN, DATA GÖR DET INTE.
 *   · PAGE-poster nycklas på `PAGE_EPOCH` + väg. En cachad HTML från bygge A
 *     refererar A:s `/_next/static/...`-chunks — de hålls kvar av
 *     `isr-cache-boot.mjs`, som ackumulerar statiska filer på volymen och
 *     kopierar tillbaka dem vid varje start. Utan det steget vore en gammal
 *     sida en sida som aldrig hydrerar.
 *   · FETCH-poster (`unstable_cache`, dvs `cachedRead`) nycklas på BUILD_ID:
 *     formen på cachad data följer koden, och en post med ett fält som nästa
 *     bygge kräver hade kraschat sidan tyst i upp till en TTL.
 * ⛔ BUMPA `PAGE_EPOCH` när en ISR-sidas UI ändras på ett sätt som måste nå
 *   besökare inom 30 dygn (t.ex. ett nytt API-kontrakt som gammal klientkod
 *   inte talar). Vanliga prisändringar kräver INGET — priset ligger inte i
 *   HTML:en längre (se produkter/[slug]/page.tsx).
 *
 * Fail-open överallt: ett skriv-/läsfel på volymen loggas och behandlas som
 * cache-miss. Aldrig ett kastat fel ur en cache.
 */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const PAGE_EPOCH = "1";
const STORE_VERSION = "v1";
/** Sidor äldre än så rensas oavsett TTL (ISR-TTL:en för produktsidor är 30 d). */
const PAGE_MAX_AGE_MS = 45 * 24 * 3600 * 1000;
const PRUNE_INTERVAL_MS = 6 * 3600 * 1000;
const NEXT_CACHE_TAGS_HEADER = "x-next-cache-tags";

function resolveCacheDir(env = process.env) {
  if (env.ISR_CACHE_DIR) return env.ISR_CACHE_DIR;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, "isr");
  return null;
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function readBuildId(serverDistDir) {
  try {
    return fs.readFileSync(path.join(serverDistDir, "..", "BUILD_ID"), "utf8").trim() || "dev";
  } catch {
    return "dev";
  }
}

function entrySize(value) {
  if (!value) return 25;
  if (value.kind === "FETCH") return JSON.stringify(value.data || "").length;
  if (value.kind === "ROUTE") return value.body ? value.body.length : 0;
  if (value.kind === "PAGE")
    return (value.html ? value.html.length : 0) + (JSON.stringify(value.pageData) || "").length;
  return JSON.stringify(value).length;
}

/** Minimal LRU på bytes — Map:ens iterationsordning är insättningsordningen. */
class MemoryLru {
  constructor(maxBytes) {
    this.max = maxBytes > 0 ? maxBytes : 0;
    this.map = new Map();
    this.bytes = 0;
  }
  get(key) {
    if (!this.max) return undefined;
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.entry;
  }
  set(key, entry) {
    if (!this.max) return;
    const size = entrySize(entry.value) + 64;
    if (size > this.max) return;
    const prev = this.map.get(key);
    if (prev) {
      this.bytes -= prev.size;
      this.map.delete(key);
    }
    this.map.set(key, { entry, size });
    this.bytes += size;
    while (this.bytes > this.max && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      this.bytes -= this.map.get(oldest).size;
      this.map.delete(oldest);
    }
  }
  delete(key) {
    const prev = this.map.get(key);
    if (!prev) return;
    this.bytes -= prev.size;
    this.map.delete(key);
  }
}

function serialize(obj) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 4 });
}

function deserialize(buf) {
  return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
}

class PersistentIsrCache {
  constructor(ctx = {}) {
    this.dir = resolveCacheDir();
    this.serverDistDir = ctx.serverDistDir || path.join(process.cwd(), ".next", "server");
    this.appDir = ctx._appDir !== false;
    this.revalidatedTags = ctx.revalidatedTags || [];
    this.ppr = !!(ctx.experimental && ctx.experimental.ppr);
    this.debug = !!process.env.NEXT_PRIVATE_DEBUG_CACHE;
    this.memory = new MemoryLru(ctx.maxMemoryCacheSize || 0);
    this.buildId = readBuildId(this.serverDistDir);
    this.tagsManifest = null;

    if (this.dir) {
      try {
        fs.mkdirSync(this.pagesDir(), { recursive: true });
        fs.mkdirSync(this.fetchDir(), { recursive: true });
      } catch (err) {
        console.warn("[isr-cache] kunde inte skapa cachekatalog — kör utan volym:", err);
        this.dir = null;
      }
    }
    this.loadTagsManifest();
    if (this.dir && !process.env.ISR_CACHE_NO_PRUNE) {
      const timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
      if (typeof timer.unref === "function") timer.unref();
      void this.prune();
    }
  }

  // ── Kataloger ──────────────────────────────────────────────────────────────
  root() {
    return path.join(this.dir, STORE_VERSION);
  }
  pagesDir() {
    return path.join(this.root(), "pages");
  }
  fetchDir() {
    return path.join(this.root(), "fetch", this.buildId);
  }
  tagsManifestPath() {
    return path.join(this.root(), "tags-manifest.json");
  }
  pageFile(key) {
    return path.join(this.pagesDir(), `${sha1(`${PAGE_EPOCH}:${key}`)}.gz`);
  }
  fetchFile(key) {
    return path.join(this.fetchDir(), `${sha1(key)}.gz`);
  }

  // ── Taggar (samma semantik som FileSystemCache) ────────────────────────────
  loadTagsManifest() {
    if (this.tagsManifest) return;
    try {
      this.tagsManifest = this.dir
        ? JSON.parse(fs.readFileSync(this.tagsManifestPath(), "utf8"))
        : { version: 1, items: {} };
      if (!this.tagsManifest || typeof this.tagsManifest !== "object" || !this.tagsManifest.items) {
        this.tagsManifest = { version: 1, items: {} };
      }
    } catch {
      this.tagsManifest = { version: 1, items: {} };
    }
  }

  async revalidateTag(...args) {
    let [tags] = args;
    tags = typeof tags === "string" ? [tags] : tags;
    if (!tags || tags.length === 0) return;
    this.loadTagsManifest();
    const now = Date.now();
    for (const tag of tags) this.tagsManifest.items[tag] = { revalidatedAt: now };
    if (!this.dir) return;
    try {
      await this.writeAtomic(this.tagsManifestPath(), JSON.stringify(this.tagsManifest));
    } catch (err) {
      console.warn("[isr-cache] kunde inte skriva tags-manifest:", err);
    }
  }

  tagRevalidatedSince(tag, lastModified) {
    if (this.revalidatedTags.includes(tag)) return true;
    const item = this.tagsManifest && this.tagsManifest.items[tag];
    return !!(item && item.revalidatedAt && item.revalidatedAt >= (lastModified || Date.now()));
  }

  // ── get/set ────────────────────────────────────────────────────────────────
  async get(...args) {
    const [key, ctx = {}] = args;
    const { tags, softTags, kindHint } = ctx;
    let data = this.memory.get(key);

    if (!data && kindHint !== "fetch") data = await this.readPage(key);
    if (!data && kindHint !== "app" && kindHint !== "pages") data = await this.readFetch(key, tags);
    if (!data && kindHint !== "fetch") data = await this.readSeed(key);

    if (data && this.memory) this.memory.set(key, data);

    if (data && data.value && data.value.kind === "PAGE") {
      const header = data.value.headers && data.value.headers[NEXT_CACHE_TAGS_HEADER];
      const cacheTags = typeof header === "string" ? header.split(",") : [];
      if (cacheTags.length) {
        this.loadTagsManifest();
        if (cacheTags.some((t) => this.tagRevalidatedSince(t, data.lastModified))) data = undefined;
      }
    }
    if (data && data.value && data.value.kind === "FETCH") {
      this.loadTagsManifest();
      const combined = [...(tags || []), ...(softTags || [])];
      if (combined.some((t) => this.tagRevalidatedSince(t, data.lastModified))) data = undefined;
    }
    if (this.debug) console.log("[isr-cache] get", key, kindHint, !!data);
    return data ?? null;
  }

  async set(...args) {
    const [key, data, ctx = {}] = args;
    const entry = { value: data, lastModified: Date.now() };
    this.memory.set(key, entry);
    if (!this.dir || !data) return;
    try {
      if (data.kind === "FETCH") {
        await this.writeAtomic(
          this.fetchFile(key),
          serialize({ key, lastModified: entry.lastModified, value: { ...data, tags: ctx.tags } })
        );
      } else if (data.kind === "PAGE" || data.kind === "ROUTE" || data.kind === "REDIRECT") {
        await this.writeAtomic(this.pageFile(key), serialize({ key, lastModified: entry.lastModified, value: data }));
      }
    } catch (err) {
      console.warn("[isr-cache] skrivfel (fail-open):", key, err && err.code ? err.code : err);
    }
  }

  resetRequestCache() {}

  // ── Lagerläsningar ─────────────────────────────────────────────────────────
  async readPage(key) {
    if (!this.dir) return undefined;
    try {
      const parsed = deserialize(await fsp.readFile(this.pageFile(key)));
      if (!parsed || parsed.key !== key || !parsed.value) return undefined;
      return { lastModified: parsed.lastModified, value: parsed.value };
    } catch {
      return undefined;
    }
  }

  async readFetch(key, tags) {
    if (!this.dir) return undefined;
    try {
      const parsed = deserialize(await fsp.readFile(this.fetchFile(key)));
      if (!parsed || parsed.key !== key || !parsed.value || parsed.value.kind !== "FETCH") return undefined;
      const stored = parsed.value.tags || [];
      if (tags && !tags.every((t) => stored.includes(t))) {
        // Nya taggar på en befintlig post: skriv unionen (samma som FileSystemCache).
        await this.set(key, parsed.value, { tags: [...new Set([...stored, ...tags])] });
      }
      return { lastModified: parsed.lastModified, value: parsed.value };
    } catch {
      return undefined;
    }
  }

  /** Byggets prerenderade filer — läses exakt som FileSystemCache gör. */
  async readSeed(key) {
    if (!this.appDir) return undefined;
    const base = path.join(this.serverDistDir, "app", key);
    try {
      const body = await fsp.readFile(`${base}.body`);
      const { mtime } = await fsp.stat(`${base}.body`);
      const meta = JSON.parse(await fsp.readFile(`${base}.meta`, "utf8"));
      return { lastModified: mtime.getTime(), value: { kind: "ROUTE", body, headers: meta.headers, status: meta.status } };
    } catch {
      /* ingen route-seed */
    }
    try {
      const html = await fsp.readFile(`${base}.html`, "utf8");
      const { mtime } = await fsp.stat(`${base}.html`);
      const pageData = await fsp.readFile(`${base}${this.ppr ? ".prefetch.rsc" : ".rsc"}`, "utf8");
      let meta;
      try {
        meta = JSON.parse(await fsp.readFile(`${base}.meta`, "utf8"));
      } catch {
        /* valfri */
      }
      return {
        lastModified: mtime.getTime(),
        value: {
          kind: "PAGE",
          html,
          pageData,
          postponed: meta && meta.postponed,
          headers: meta && meta.headers,
          status: meta && meta.status,
        },
      };
    } catch {
      return undefined;
    }
  }

  async writeAtomic(file, content) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, file);
  }

  /** Gamla sidor + andra byggens datacache. Körs sällan, aldrig i request-vägen. */
  async prune(now = Date.now()) {
    if (!this.dir) return { pages: 0, fetchDirs: 0 };
    let pages = 0;
    let fetchDirs = 0;
    try {
      for (const name of await fsp.readdir(this.pagesDir())) {
        const file = path.join(this.pagesDir(), name);
        try {
          const st = await fsp.stat(file);
          if (name.endsWith(".tmp") || now - st.mtimeMs > PAGE_MAX_AGE_MS) {
            await fsp.unlink(file);
            pages++;
          }
        } catch {
          /* borta redan */
        }
      }
      const fetchRoot = path.dirname(this.fetchDir());
      for (const name of await fsp.readdir(fetchRoot)) {
        if (name === this.buildId) continue;
        await fsp.rm(path.join(fetchRoot, name), { recursive: true, force: true });
        fetchDirs++;
      }
      if (pages || fetchDirs) console.log(`[isr-cache] rensade ${pages} sidor, ${fetchDirs} gamla datacacher`);
    } catch (err) {
      console.warn("[isr-cache] prune misslyckades:", err);
    }
    return { pages, fetchDirs };
  }
}

module.exports = PersistentIsrCache;
module.exports.PersistentIsrCache = PersistentIsrCache;
module.exports.resolveCacheDir = resolveCacheDir;
module.exports.PAGE_EPOCH = PAGE_EPOCH;
module.exports.PAGE_MAX_AGE_MS = PAGE_MAX_AGE_MS;
