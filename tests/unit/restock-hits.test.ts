/**
 * LARM-HITS: Discord-lanens väg till mejl/push utan att röra Neon själv
 * (src/lib/restock-hits.ts + src/services/restock-hits.ts + /api/cron/restock-hit).
 *
 * Tre saker vaktas:
 *   1. Den rena domen: bara RUTTADE påfyllningar blir hits, aldrig prissänkningar; kön
 *      dedupar, TTL:ar och tappar aldrig en nyare övergång när en äldre levereras.
 *   2. Appens skrivningar sker i SAMMA ordning som nattkedjans offer-diff:
 *      RestockEvent → checkRestockAlerts → Offer.stockStatus SIST.
 *   3. Invarianten som gör lanen gratis: workflowet kör med DÖD DATABASE_URL och
 *      scriptet rör aldrig Prisma — hitsen går över HTTP.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RestockPost } from "@/lib/discord-restock";
import {
  HIT_TTL_MS,
  hitsFromPosts,
  mergePendingHits,
  parsePendingHits,
  removeDelivered,
  sendRestockHits,
  type RestockHit,
} from "@/lib/restock-hits";

const retailerFindUnique = vi.fn();
const offerFindFirst = vi.fn();
const offerUpdate = vi.fn();
const productFindUnique = vi.fn();
const restockEventCreate = vi.fn();
const checkRestockAlerts = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    retailer: { findUnique: (...a: unknown[]) => retailerFindUnique(...a) },
    offer: {
      findFirst: (...a: unknown[]) => offerFindFirst(...a),
      update: (...a: unknown[]) => offerUpdate(...a),
    },
    product: { findUnique: (...a: unknown[]) => productFindUnique(...a) },
    restockEvent: { create: (...a: unknown[]) => restockEventCreate(...a) },
  },
}));
vi.mock("@/services/alerts", () => ({
  checkRestockAlerts: (...a: unknown[]) => checkRestockAlerts(...a),
}));
vi.mock("@/services/products", () => ({
  HIDDEN_CATEGORIES: ["ACCESSORY", "GRADED_CARD", "OTHER"],
}));

import { applyRestockHits, laneStatus } from "@/services/restock-hits";

const NOW = new Date("2026-09-06T12:00:00Z");

function post(over: Partial<RestockPost> = {}): RestockPost {
  return {
    key: "Rogerz\thttps://rogerz.se/p/pitch-black-etb",
    title: "Pitch Black Elite Trainer Box",
    storeName: "Rogerz",
    storeUrl: "https://rogerz.se/p/pitch-black-etb",
    priceOre: 64900,
    imageUrl: null,
    setName: "Pitch Black",
    series: "Mega Evolution",
    language: "EN",
    productUrl: "https://foilio.se/produkter/pitch-black-etb",
    productSlug: "pitch-black-etb",
    transition: { from: "OUT_OF_STOCK", to: "IN_STOCK" },
    ...over,
  };
}

function hit(over: Partial<RestockHit> = {}): RestockHit {
  return {
    key: "Rogerz\thttps://rogerz.se/p/pitch-black-etb",
    storeName: "Rogerz",
    storeUrl: "https://rogerz.se/p/pitch-black-etb",
    productSlug: "pitch-black-etb",
    priceOre: 64900,
    from: "OUT_OF_STOCK",
    to: "IN_STOCK",
    at: NOW.getTime(),
    ...over,
  };
}

describe("hitsFromPosts — vad som blir en larm-hit", () => {
  it("ett ruttat påfyllningsinlägg blir en hit med lanens övergång", () => {
    const hits = hitsFromPosts([post()], NOW);
    expect(hits).toEqual([hit()]);
  });

  it("en URL utan rutt (ingen produkt) blir ALDRIG en hit — det finns inga bevakare", () => {
    expect(hitsFromPosts([post({ productUrl: null, productSlug: null })], NOW)).toEqual([]);
  });

  it("en prissänkning är ingen påfyllning", () => {
    expect(hitsFromPosts([post({ previousPriceOre: 79900 })], NOW)).toEqual([]);
  });

  it("förhandsbokning ⇒ to = PREORDER, så copyn blir 'går nu att förhandsboka'", () => {
    const [h] = hitsFromPosts(
      [post({ preorder: true, transition: { from: "OUT_OF_STOCK", to: "PREORDER" } })],
      NOW
    );
    expect(h.to).toBe("PREORDER");
  });

  it("'ABSENT' följer med som från-status — appen tolkar det som okänt", () => {
    const [h] = hitsFromPosts([post({ transition: { from: "ABSENT", to: "IN_STOCK" } })], NOW);
    expect(h.from).toBe("ABSENT");
  });
});

describe("kön — dedup, TTL och leverans", () => {
  it("samma URL + samma slutstatus ⇒ den senaste vinner, äldst först", () => {
    const a = hit({ at: 1000 });
    const b = hit({ at: 2000 });
    const other = hit({ key: "X\thttps://x.se/y", storeUrl: "https://x.se/y", at: 1500 });
    const merged = mergePendingHits([a], [b, other], new Date(3000));
    expect(merged.map((h) => [h.key, h.at])).toEqual([
      [other.key, 1500],
      [b.key, 2000],
    ]);
  });

  it("samma URL men olika slutstatus (förhandsbokning → släpp) är två hits", () => {
    const pre = hit({ to: "PREORDER", at: 1000 });
    const rel = hit({ to: "IN_STOCK", at: 2000 });
    expect(mergePendingHits([pre], [rel], new Date(3000))).toHaveLength(2);
  });

  it("inaktuella hits (> TTL) faller bort — ett larm två timmar senare gäller något som redan är slut", () => {
    const stale = hit({ at: NOW.getTime() - HIT_TTL_MS - 1 });
    const fresh = hit({ key: "Y\thttps://y.se/z", storeUrl: "https://y.se/z", at: NOW.getTime() - 60_000 });
    expect(mergePendingHits([stale, fresh], [], NOW).map((h) => h.key)).toEqual([fresh.key]);
  });

  it("removeDelivered tar bort det som skickats men behåller en NYARE övergång på samma nyckel", () => {
    const sent = hit({ at: 1000 });
    const requeued = hit({ at: 5000 });
    const untouched = hit({ key: "Z\thttps://z.se/q", storeUrl: "https://z.se/q", at: 900 });
    expect(removeDelivered([requeued, untouched], [sent])).toEqual([requeued, untouched]);
    expect(removeDelivered([sent, untouched], [sent])).toEqual([untouched]);
  });

  it("parsePendingHits tål skräp och hoppar bara den trasiga raden", () => {
    expect(parsePendingHits(null)).toEqual([]);
    expect(parsePendingHits("nope")).toEqual([]);
    expect(parsePendingHits({ hits: "nope" })).toEqual([]);
    const good = hit();
    const bad = { ...hit(), to: "SOLD_OUT" };
    expect(parsePendingHits({ hits: [bad, good] })).toEqual([good]);
    expect(parsePendingHits([good])).toEqual([good]);
  });
});

describe("sendRestockHits — transporten", () => {
  const fetchWith = (status: number, body: unknown) =>
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    })) as unknown as typeof fetch;

  it("POST:ar till /api/cron/restock-hit med x-cron-secret och tolkar räknarna", async () => {
    const f = fetchWith(200, { ok: true, paused: false, received: 1, matched: 1, events: 1, alerts: 3, skipped: {} });
    const res = await sendRestockHits([hit()], { baseUrl: "https://foilio.se/", secret: "s3", fetchImpl: f });
    expect(res).toMatchObject({ ok: true, paused: false, permanent: false, status: 200 });
    expect(res.result?.alerts).toBe(3);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://foilio.se/api/cron/restock-hit");
    expect((init.headers as Record<string, string>)["x-cron-secret"]).toBe("s3");
    expect(JSON.parse(init.body as string)).toEqual({ hits: [hit()] });
  });

  it("'paused' från appen ⇒ ok men inga räknare — hitsen är inte värda att spara", async () => {
    const res = await sendRestockHits([hit()], {
      baseUrl: "https://foilio.se",
      secret: "s3",
      fetchImpl: fetchWith(200, { ok: true, paused: true, received: 1 }),
    });
    expect(res).toMatchObject({ ok: true, paused: true });
    expect(res.result).toBeUndefined();
  });

  it("401 är permanent (fel hemlighet ger samma svar igen), 503 och nätfel är omförsök", async () => {
    const denied = await sendRestockHits([hit()], { baseUrl: "u", secret: "x", fetchImpl: fetchWith(401, "nej") });
    expect(denied).toMatchObject({ ok: false, permanent: true, status: 401 });
    const down = await sendRestockHits([hit()], { baseUrl: "u", secret: "x", fetchImpl: fetchWith(503, "") });
    expect(down).toMatchObject({ ok: false, permanent: false, status: 503 });
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const net = await sendRestockHits([hit()], { baseUrl: "u", secret: "x", fetchImpl: boom });
    expect(net).toMatchObject({ ok: false, permanent: false, status: 0, detail: "ECONNRESET" });
  });
});

describe("applyRestockHits — appens skrivningar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retailerFindUnique.mockResolvedValue({ id: "r1" });
    offerFindFirst.mockResolvedValue({
      id: "o1",
      productId: "p1",
      stockStatus: "OUT_OF_STOCK",
      product: { category: "SEALED", hiddenAt: null },
    });
    offerUpdate.mockResolvedValue({});
    restockEventCreate.mockResolvedValue({});
    checkRestockAlerts.mockResolvedValue({ triggered: 2 });
  });

  it("RestockEvent → checkRestockAlerts → Offer.stockStatus SIST, med lanens från/till", async () => {
    const order: string[] = [];
    restockEventCreate.mockImplementation(async () => order.push("event"));
    checkRestockAlerts.mockImplementation(async () => {
      order.push("alerts");
      return { triggered: 2 };
    });
    offerUpdate.mockImplementation(async () => order.push("flip"));

    const r = await applyRestockHits([hit()]);

    expect(order).toEqual(["event", "alerts", "flip"]);
    expect(restockEventCreate).toHaveBeenCalledWith({
      data: { productId: "p1", retailerId: "r1", oldStatus: "OUT_OF_STOCK", newStatus: "IN_STOCK", price: 64900 },
    });
    expect(checkRestockAlerts).toHaveBeenCalledWith("p1", "r1", { from: "OUT_OF_STOCK", to: "IN_STOCK" });
    expect(offerUpdate).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: expect.objectContaining({ stockStatus: "IN_STOCK", price: 64900 }),
    });
    expect(r).toMatchObject({ received: 1, matched: 1, events: 1, alerts: 2, skipped: {} });
  });

  it("lanens 'ABSENT' ⇒ okänt från-läge; databasens IN_STOCK får inte bli en IN→IN-rad", async () => {
    offerFindFirst.mockResolvedValue({
      id: "o1",
      productId: "p1",
      stockStatus: "IN_STOCK",
      product: { category: "SEALED", hiddenAt: null },
    });
    await applyRestockHits([hit({ from: "ABSENT", priceOre: null })]);
    expect(restockEventCreate).toHaveBeenCalledWith({
      data: { productId: "p1", retailerId: "r1", oldStatus: "UNKNOWN", newStatus: "IN_STOCK", price: null },
    });
    expect(checkRestockAlerts).toHaveBeenCalledWith("p1", "r1", { from: null, to: "IN_STOCK" });
    // null-pris rör inte offerpriset.
    expect(offerUpdate.mock.calls[0][0].data).not.toHaveProperty("price");
  });

  it("gömd produkt (hiddenAt / gömd kategori): lagret uppdateras men inget larm, ingen händelse", async () => {
    offerFindFirst.mockResolvedValue({
      id: "o1",
      productId: "p1",
      stockStatus: "OUT_OF_STOCK",
      product: { category: "SEALED", hiddenAt: new Date() },
    });
    const r = await applyRestockHits([hit()]);
    expect(restockEventCreate).not.toHaveBeenCalled();
    expect(checkRestockAlerts).not.toHaveBeenCalled();
    expect(offerUpdate).toHaveBeenCalledTimes(1);
    expect(r.skipped).toEqual({ "gömd produkt": 1 });
    expect(r.matched).toBe(1);
  });

  it("ingen Offer på URL:en ⇒ produkten slås upp på slug (bunden StoreListing), ingen statusflipp", async () => {
    offerFindFirst.mockResolvedValue(null);
    productFindUnique.mockResolvedValue({ id: "p9", category: "SEALED", hiddenAt: null });
    const r = await applyRestockHits([hit()]);
    expect(productFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "pitch-black-etb" } }));
    expect(restockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: "p9", retailerId: "r1", oldStatus: "OUT_OF_STOCK" }),
    });
    expect(checkRestockAlerts).toHaveBeenCalledWith("p9", "r1", { from: "OUT_OF_STOCK", to: "IN_STOCK" });
    expect(offerUpdate).not.toHaveBeenCalled();
    expect(r.matched).toBe(1);
  });

  it("okänd butik eller okänd produkt räknas som hoppad, inget skrivs", async () => {
    retailerFindUnique.mockResolvedValueOnce(null);
    offerFindFirst.mockResolvedValue(null);
    productFindUnique.mockResolvedValue(null);
    const r = await applyRestockHits([hit(), hit({ storeName: "Annan" })]);
    expect(r.skipped).toEqual({ "okänd butik": 1, "okänd produkt": 1 });
    expect(restockEventCreate).not.toHaveBeenCalled();
    expect(checkRestockAlerts).not.toHaveBeenCalled();
    expect(offerUpdate).not.toHaveBeenCalled();
  });

  it("laneStatus: bara riktiga StockStatus passerar", () => {
    expect(laneStatus("ABSENT")).toBeNull();
    expect(laneStatus(null)).toBeNull();
    expect(laneStatus("PREORDER")).toBe("PREORDER");
  });
});

describe("invarianten som gör lanen gratis", () => {
  const root = resolve(__dirname, "../..");
  const workflow = readFileSync(resolve(root, ".github/workflows/discord-restock.yml"), "utf8");
  const script = readFileSync(resolve(root, "scripts/discord-restock-run.ts"), "utf8");
  const route = readFileSync(resolve(root, "src/app/api/cron/restock-hit/route.ts"), "utf8");
  const lib = readFileSync(resolve(root, "src/lib/restock-hits.ts"), "utf8");

  it("workflowet kör fortfarande med DÖD DATABASE_URL och skickar hitsen med CRON_SECRET", () => {
    expect(workflow).toContain('DATABASE_URL: "postgresql://disabled:disabled@127.0.0.1:1/disabled"');
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
  });

  it("scriptet rör aldrig Prisma — hitsen går över HTTP", () => {
    expect(script).toContain('from "../src/lib/restock-hits"');
    expect(script).not.toMatch(/\bprisma\./);
    expect(script).not.toContain('from "../src/lib/db"');
  });

  it("den delade lib-filen är DB- och FS-fri (importeras av lanen)", () => {
    expect(lib).not.toMatch(/from "[^"]*\/db"/);
    expect(lib).not.toMatch(/@prisma\/client/);
    expect(lib).not.toMatch(/node:fs/);
  });

  it("rutten svarar 'paused' FÖRE ensureDbAwake — pausat läge kostar noll vaken tid", () => {
    const paused = route.indexOf("restockAlertsPaused()");
    const wake = route.indexOf("ensureDbAwake()");
    const auth = route.indexOf("x-cron-secret");
    expect(auth).toBeGreaterThan(-1);
    expect(paused).toBeGreaterThan(auth);
    expect(wake).toBeGreaterThan(paused);
  });
});
