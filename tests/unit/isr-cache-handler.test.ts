/**
 * Persistent ISR-cache (server/cache-handler.cjs) — kontraktet mot Next 14.2 och
 * de två regler som gör den säker över deployer:
 *   · PAGE-poster överlever ett byggbyte (det är hela poängen),
 *   · FETCH-poster gör det INTE (datans form följer koden).
 * Plus tagg-invalidering (revalidateTag/revalidatePath) och fail-open utan volym.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handlerPath = path.resolve(__dirname, "../../server/cache-handler.cjs");
const syncPath = path.resolve(__dirname, "../../server/isr-static-sync.cjs");

type Handler = {
  get: (key: string, ctx?: Record<string, unknown>) => Promise<{ lastModified: number; value: unknown } | null>;
  set: (key: string, data: unknown, ctx?: Record<string, unknown>) => Promise<void>;
  revalidateTag: (tags: string | string[]) => Promise<void>;
  prune: (now?: number) => Promise<{ pages: number; fetchDirs: number }>;
};

let tmp: string;
let distA: string;
let distB: string;

function makeDist(buildId: string): string {
  const dir = path.join(tmp, `dist-${buildId}`, "server");
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "..", "BUILD_ID"), buildId);
  return dir;
}

/** Ny "process": modulen laddas om så minnes-LRU + tags-manifest börjar tomma. */
function load(serverDistDir: string, extra: Record<string, unknown> = {}): Handler {
  delete require.cache[require.resolve(handlerPath)];
  const Ctor = require(handlerPath);
  return new Ctor({ serverDistDir, maxMemoryCacheSize: 1024 * 1024, _appDir: true, experimental: {}, ...extra });
}

/** Samma process, ny instans — så som Next skapar en hanterare PER REQUEST. */
function reinstantiate(serverDistDir: string): Handler {
  const Ctor = require(handlerPath);
  return new Ctor({ serverDistDir, maxMemoryCacheSize: 1024 * 1024, _appDir: true, experimental: {} });
}

const page = (html: string, tags?: string) => ({
  kind: "PAGE",
  html,
  pageData: "rsc",
  headers: tags ? { "x-next-cache-tags": tags } : undefined,
  status: 200,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "isr-cache-"));
  process.env.ISR_CACHE_DIR = path.join(tmp, "vol");
  process.env.ISR_CACHE_NO_PRUNE = "1";
  distA = makeDist("buildA");
  distB = makeDist("buildB");
});

afterEach(() => {
  delete process.env.ISR_CACHE_DIR;
  delete process.env.ISR_CACHE_NO_PRUNE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PersistentIsrCache", () => {
  it("minne och tagg-manifest delas mellan instanser i samma process (Next skapar en per request)", async () => {
    delete process.env.ISR_CACHE_DIR; // utan volym: BARA minnet kan ge träff
    const first = load(distA);
    await first.set("/sv/produkter/req1", page("R1"));
    const second = reinstantiate(distA);
    expect((await second.get("/sv/produkter/req1", { kindHint: "app" }))?.value).toMatchObject({ html: "R1" });
    // Tagg-manifestet är också delat: en revalidering i EN instans syns i nästa.
    await new Promise((r) => setTimeout(r, 5));
    await first.set("/sv/produkter/req2", page("R2", "_N_T_/sv/produkter/req2"));
    await new Promise((r) => setTimeout(r, 5));
    await second.revalidateTag("_N_T_/sv/produkter/req2");
    expect(await reinstantiate(distA).get("/sv/produkter/req2", { kindHint: "app" })).toBeNull();
  });

  it("prune rör aldrig en färsk .tmp (pågående skrivning), bara övergivna", async () => {
    const a = load(distA);
    const pagesDir = path.join(process.env.ISR_CACHE_DIR!, "v1", "pages");
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(path.join(pagesDir, "fresh.gz.1.tmp"), "x");
    fs.writeFileSync(path.join(pagesDir, "abandoned.gz.2.tmp"), "x");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(pagesDir, "abandoned.gz.2.tmp"), old, old);
    expect(await a.prune()).toEqual({ pages: 1, fetchDirs: 0 });
    expect(fs.existsSync(path.join(pagesDir, "fresh.gz.1.tmp"))).toBe(true);
  });

  it("skriver en PAGE till volymen och läser den i en NY process/bygge", async () => {
    const a = load(distA);
    await a.set("/sv/produkter/x", page("<html>A</html>"));
    const b = load(distB); // nytt bygge, tomt minne
    const hit = await b.get("/sv/produkter/x", { kindHint: "app" });
    expect(hit?.value).toMatchObject({ kind: "PAGE", html: "<html>A</html>" });
  });

  it("FETCH-poster (unstable_cache) delas INTE mellan byggen", async () => {
    const a = load(distA);
    await a.set("fetchkey", { kind: "FETCH", data: { body: "1" }, revalidate: 60 }, { tags: ["priser"] });
    expect((await load(distA).get("fetchkey", { kindHint: "fetch", tags: ["priser"] }))?.value).toMatchObject({
      kind: "FETCH",
    });
    expect(await load(distB).get("fetchkey", { kindHint: "fetch", tags: ["priser"] })).toBeNull();
  });

  it("revalidateTag gör en taggad PAGE till miss (blockerande omrendering), även efter omstart", async () => {
    const a = load(distA);
    await a.set("/sv/sets/x", page("S", "_N_T_/[locale]/sets/[id]/page,_N_T_/sv/sets/x"));
    await new Promise((r) => setTimeout(r, 5));
    await a.revalidateTag("_N_T_/[locale]/sets/[id]/page");
    expect(await a.get("/sv/sets/x", { kindHint: "app" })).toBeNull();
    // manifestet ligger på volymen → gäller även för nästa process
    expect(await load(distA).get("/sv/sets/x", { kindHint: "app" })).toBeNull();
  });

  it("revalidateTag på datataggen tömmer FETCH men rör inte otaggade sidor", async () => {
    const a = load(distA);
    await a.set("/sv/produkter/y", page("P"));
    await a.set("f2", { kind: "FETCH", data: { body: "2" }, revalidate: 60 }, { tags: ["priser"] });
    await new Promise((r) => setTimeout(r, 5));
    await a.revalidateTag(["priser"]);
    expect(await a.get("f2", { kindHint: "fetch", tags: ["priser"] })).toBeNull();
    expect((await a.get("/sv/produkter/y", { kindHint: "app" }))?.value).toMatchObject({ html: "P" });
  });

  it("läser byggets prerenderade filer som seed när volymen saknar posten", async () => {
    fs.mkdirSync(path.join(distA, "app", "sv"), { recursive: true });
    fs.writeFileSync(path.join(distA, "app", "sv", "om.html"), "<html>om</html>");
    fs.writeFileSync(path.join(distA, "app", "sv", "om.rsc"), "rsc-om");
    const a = load(distA);
    const hit = await a.get("/sv/om", { kindHint: "app" });
    expect(hit?.value).toMatchObject({ kind: "PAGE", html: "<html>om</html>", pageData: "rsc-om" });
  });

  it("prune tar gamla sidor och andra byggens datacache, aldrig det egna byggets", async () => {
    const a = load(distA);
    await a.set("/sv/produkter/old", page("old"));
    await a.set("fa", { kind: "FETCH", data: {}, revalidate: 60 }, { tags: [] });
    const b = load(distB);
    await b.set("fb", { kind: "FETCH", data: {}, revalidate: 60 }, { tags: [] });
    const r = await b.prune(Date.now() + 60 * 24 * 3600 * 1000);
    expect(r).toEqual({ pages: 1, fetchDirs: 1 });
    expect(await b.get("fb", { kindHint: "fetch", tags: [] })).not.toBeNull();
  });

  it("utan volym: fail-open (bara minne + seed), ingen kastning", async () => {
    delete process.env.ISR_CACHE_DIR;
    const a = load(distA);
    await a.set("/sv/produkter/z", page("Z"));
    expect((await a.get("/sv/produkter/z", { kindHint: "app" }))?.value).toMatchObject({ html: "Z" });
    expect(await load(distA).get("/sv/produkter/z", { kindHint: "app" })).toBeNull();
  });
});

describe("syncStaticAssets", () => {
  it("återställer gamla chunks in i bygget, arkiverar nya och rensar bara gamla som bygget saknar", () => {
    const { syncStaticAssets } = require(syncPath) as {
      syncStaticAssets: (o: { cacheDir: string; buildStaticDir: string; now?: number }) => {
        restored: number;
        archived: number;
        pruned: number;
      };
    };
    const cacheDir = path.join(tmp, "vol");
    const buildStatic = path.join(tmp, "next-static");
    fs.mkdirSync(path.join(buildStatic, "chunks"), { recursive: true });
    fs.writeFileSync(path.join(buildStatic, "chunks", "new-abc.js"), "new");
    // Volymen har en gammal chunk (annat bygge) och en uråldrig som ska bort.
    fs.mkdirSync(path.join(cacheDir, "static", "chunks"), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "static", "chunks", "old-def.js"), "old");
    fs.writeFileSync(path.join(cacheDir, "static", "chunks", "ancient-000.js"), "ancient");
    const ancient = new Date(Date.now() - 100 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(cacheDir, "static", "chunks", "ancient-000.js"), ancient, ancient);

    const r = syncStaticAssets({ cacheDir, buildStaticDir: buildStatic });
    expect(r).toEqual({ restored: 1, archived: 1, pruned: 1 });
    expect(fs.existsSync(path.join(buildStatic, "chunks", "old-def.js"))).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, "static", "chunks", "new-abc.js"))).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, "static", "chunks", "ancient-000.js"))).toBe(false);
    // ⛔ En chunk som fortfarande finns i bygget rensas aldrig, hur gammal den än är.
    fs.utimesSync(path.join(cacheDir, "static", "chunks", "new-abc.js"), ancient, ancient);
    expect(syncStaticAssets({ cacheDir, buildStaticDir: buildStatic }).pruned).toBe(0);
  });
});
