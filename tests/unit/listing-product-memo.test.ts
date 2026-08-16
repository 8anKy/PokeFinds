/**
 * REGRESSIONSVAKT för memot i ensureListingProduct (src/scrapers/runner.ts).
 *
 * Auto-importen frågade Haiku "är detta samma produkt?" och band annonsen — men för en
 * URL som ALDRIG kan få en egen Offer (butiken har redan en offer på produkten via en
 * annan variant-URL; Offer är unik på produkt+butik+skick+språk) skrevs ingenting. Nästa
 * körning såg därför samma "nya" URL igen och betalade för samma dom. Var 10:e minut.
 * MÄTT 2026-08-14: 720 anrop/dygn för domar vi redan hade — ~90 % av hela API-notan.
 *
 * Testerna nedan gör det omöjligt att ta bort memot tyst, och vaktar de två sätt det
 * kan bli FARLIGT: att det överlever en ändrad titel, och att det kortsluter denylisten.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockStatus } from "@prisma/client";

const URL = "https://rogerz.dk/products/breakthrough-etb?variant=56576194969931";
const RAW_TITLE = "Pokémon TCG: XY BreakThrough Elite Trainer Box - Alm. moms / Mewtwo X";

/** Vad huvudboken svarar när memot slås upp. Skrivs om per test. */
const ledger: {
  current: { productId: string | null; productMatchTitle: string | null; gtin: string | null } | null;
} = { current: null };

const storeListingFindUnique = vi.fn(async () => ledger.current);
const storeListingUpdateMany = vi.fn(async () => ({ count: 1 }));

/**
 * `offer.findFirst` slås upp på TVÅ ställen med olika betydelse: cross-produkt-vakten
 * frågar på URL:en ("äger någon redan den här sidan?"), upsertListingOffer frågar på
 * produkten ("har butiken redan en offer på varan?"). En mock som svarar likadant på
 * båda gör testet meningslöst — den första hade svarat ja och funktionen returnerat
 * innan den nådde det testet påstår.
 */
const ownerOffer: { current: { productId: string } | null } = { current: null };
const storeOffer: { current: { id: string; gtin: string | null } | null } = {
  current: { id: "o1", gtin: null },
};
// `args` är valfri i signaturen med flit: anropsställena spreadar `...(a as [])`,
// vilket typas som noll argument. Funktionen läser redan med `args?.` — kravet på
// ett argument var alltså bara en typ, aldrig en förutsättning.
const offerFindFirst = vi.fn(async (args?: { where?: { url?: string } }) =>
  args?.where?.url !== undefined ? ownerOffer.current : storeOffer.current
);
const offerCreate = vi.fn(async () => ({}));

vi.mock("@/lib/db", () => ({
  withDbRetry: (fn: () => Promise<unknown>) => fn(),
  ensureDbAwake: async () => {},
  prisma: {
    storeListing: {
      findUnique: (...a: unknown[]) => storeListingFindUnique(...(a as [])),
      updateMany: (...a: unknown[]) => storeListingUpdateMany(...(a as [])),
    },
    offer: {
      findFirst: (...a: unknown[]) => offerFindFirst(...(a as [])),
      create: (...a: unknown[]) => offerCreate(...(a as [])),
    },
    product: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => ({}),
    },
  },
}));

/** DEN DYRA VÄGEN: både LLM-domen och butikens produktsida (HTTP) ska hoppas över. */
const judgeSameProduct = vi.fn(async () => ({ same: true, reason: "" }));
vi.mock("@/lib/same-product", () => ({ judgeSameProduct: (...a: unknown[]) => judgeSameProduct(...(a as [])) }));

const fetchListingFacts = vi.fn(async () => ({ gtin: null, name: null }));
vi.mock("@/scrapers/gtin-source", () => ({
  fetchListingFacts: (...a: unknown[]) => fetchListingFacts(...(a as [])),
  fetchListingGtin: async () => null,
}));

const denied = { current: false };
vi.mock("@/scrapers/import-denylist", () => ({
  isDeniedListingUrl: () => denied.current,
  setDynamicDenylist: () => {},
  dynamicDenylistSize: () => 0,
}));

const { ensureListingProduct } = await import("@/scrapers/runner");

const item = {
  title: RAW_TITLE,
  url: URL,
  price: 49900,
  imageUrl: null,
  retailerId: "r1",
  category: "ETB",
  sourceName: "Rogerz",
};

beforeEach(() => {
  vi.clearAllMocks();
  denied.current = false;
  ledger.current = null;
  ownerOffer.current = null;
  storeOffer.current = { id: "o1", gtin: null };
});

describe("ensureListingProduct — memot", () => {
  it("MEMO-TRÄFF: samma URL + samma titel → ingen LLM-dom, ingen produktsidehämtning", async () => {
    ledger.current = { productId: "p1", productMatchTitle: RAW_TITLE, gtin: null };

    const productId = await ensureListingProduct(item, StockStatus.IN_STOCK);

    expect(productId).toBe("p1");
    // Det här ÄR besparingen: 720 anrop/dygn blir 0.
    expect(judgeSameProduct).not.toHaveBeenCalled();
    expect(fetchListingFacts).not.toHaveBeenCalled();
  });

  it("MEMO-TRÄFF kortsluter INTE offer-skrivningen (en misslyckad skrivning ska kunna göras om)", async () => {
    ledger.current = { productId: "p1", productMatchTitle: RAW_TITLE, gtin: null };
    storeOffer.current = null; // butiken saknar offer på produkten → den SKA skapas

    await ensureListingProduct(item, StockStatus.IN_STOCK);

    expect(offerCreate).toHaveBeenCalledOnce();
  });

  // De två missarna nedan använder en TILLBEHÖRSTITEL: den faller på isAccessoryListing
  // direkt efter produktsidehämtningen, så testet bevisar att memot INTE tog över utan
  // att behöva mocka hela matchnings- och skapandekedjan.
  const accessoryItem = { ...item, title: "Pokémon Sleeves Deck Protector Mewtwo" };

  it("ÄNDRAD TITEL ogiltigförklarar memot → annonsen prövas på nytt", async () => {
    ledger.current = { productId: "p1", productMatchTitle: "En HELT annan titel", gtin: null };

    await ensureListingProduct(accessoryItem, StockStatus.IN_STOCK);

    // Domen gällde en annan text: vi litar inte på den, utan går den dyra vägen igen.
    expect(fetchListingFacts).toHaveBeenCalled();
  });

  it("MEMO UTAN produktId (avvisad annons) prövas på nytt — ett null-svar cachas aldrig", async () => {
    ledger.current = { productId: null, productMatchTitle: accessoryItem.title, gtin: null };

    await ensureListingProduct(accessoryItem, StockStatus.IN_STOCK);

    expect(fetchListingFacts).toHaveBeenCalled();
  });

  it("DENYLISTAD URL läses aldrig ur memot — admins borttagning står över cachen", async () => {
    denied.current = true;
    ledger.current = { productId: "p1", productMatchTitle: RAW_TITLE, gtin: null };

    const productId = await ensureListingProduct(item, StockStatus.IN_STOCK);

    expect(productId).toBeNull();
    expect(storeListingFindUnique).not.toHaveBeenCalled();
  });
});
