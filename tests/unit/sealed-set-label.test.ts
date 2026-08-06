/**
 * Set-etiketteraren — vakterna, inte lyckofallet.
 *
 * Modulen SKRIVER katalogstruktur (den kan skapa CardSet), så reglerna som hindrar
 * den från att skriva fel väger tyngre än den som får den att skriva rätt:
 *   1. Aldrig skriva över en befintlig etikett.
 *   2. Tvetydigt episodnamn (två av våra set normaliserar lika) → gör ingenting.
 *   3. Episod utan serie hos CM → skapa inget set (det skulle sakna hemvist).
 *   4. `createMissing=false` (delkörning) → etikettera mot BEFINTLIGA set, men
 *      skapa aldrig nya.
 *   5. externalId lämnas NULL så import-tcg-data kan adoptera raden på namn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cardSetFindMany = vi.fn();
const cardSetCreate = vi.fn();
const productUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    cardSet: {
      findMany: (...a: unknown[]) => cardSetFindMany(...a),
      create: (...a: unknown[]) => cardSetCreate(...a),
    },
    product: { update: (...a: unknown[]) => productUpdate(...a) },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...a: unknown[]) => fetchMock(...a));

import { createSetLabeler } from "@/jobs/sealed-set-label";

/** Ett svar från /pokemon/episodes med EN sida. */
function episodesPage(rows: unknown[]) {
  return {
    ok: true,
    json: async () => ({ data: rows, paging: { total: 1 } }),
  };
}

const EPISODE = {
  id: 431,
  name: "30th Celebration",
  released_at: "2026-09-16",
  logo: "https://cm/logo.png",
  cards_total: 0,
  series: { name: "Mega Evolution" },
};

beforeEach(() => {
  cardSetFindMany.mockReset().mockResolvedValue([]);
  cardSetCreate.mockReset().mockResolvedValue({ id: "new-set" });
  productUpdate.mockReset().mockResolvedValue({});
  fetchMock.mockReset().mockResolvedValue(episodesPage([EPISODE]));
  process.env.CARDMARKET_RAPIDAPI_KEY = "test-key";
});

describe("etikettering mot befintliga set", () => {
  it("sätter setId när episodnamnet matchar ett av våra set", async () => {
    cardSetFindMany.mockResolvedValue([{ id: "set-1", name: "Prismatic Evolutions" }]);
    const l = await createSetLabeler(false);

    const res = await l.label("prod-1", null, "Prismatic Evolutions");

    expect(res).toBe("set-1");
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "prod-1" },
      data: { setId: "set-1" },
    });
    expect(l.stats.labeled).toBe(1);
  });

  it("matchar trots skiljetecken och versaler", async () => {
    cardSetFindMany.mockResolvedValue([{ id: "set-1", name: "Scarlet & Violet: 151" }]);
    const l = await createSetLabeler(false);

    expect(await l.label("prod-1", null, "scarlet   violet 151")).toBe("set-1");
  });

  it("⛔ skriver ALDRIG över en befintlig etikett", async () => {
    cardSetFindMany.mockResolvedValue([{ id: "set-1", name: "Prismatic Evolutions" }]);
    const l = await createSetLabeler(false);

    const res = await l.label("prod-1", "redan-satt", "Prismatic Evolutions");

    expect(res).toBeNull();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("gör ingenting utan episodnamn", async () => {
    const l = await createSetLabeler(false);
    expect(await l.label("prod-1", null, null)).toBeNull();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("⛔ TVETYDIGT: två set som normaliserar lika → ingen etikett", async () => {
    cardSetFindMany.mockResolvedValue([
      { id: "set-a", name: "Team Rocket" },
      { id: "set-b", name: "Team  Rocket!" },
    ]);
    const l = await createSetLabeler(false);

    expect(await l.label("prod-1", null, "Team Rocket")).toBeNull();
    expect(productUpdate).not.toHaveBeenCalled();
    expect(l.stats.ambiguous).toBe(1);
  });
});

describe("B2 — skapa saknat set ur CM-episoden", () => {
  it("skapar setet och etiketterar produkten", async () => {
    const l = await createSetLabeler(true);

    const res = await l.label("prod-1", null, "30th Celebration");

    expect(res).toBe("new-set");
    expect(l.stats.setsCreated).toBe(1);
    const data = (cardSetCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.name).toBe("30th Celebration");
    expect(data.series).toBe("Mega Evolution");
    expect(data.logoUrl).toBe("https://cm/logo.png");
  });

  it("⛔ lämnar externalId ORÖRT så pokemontcg.io kan adoptera raden på namn", async () => {
    const l = await createSetLabeler(true);
    await l.label("prod-1", null, "30th Celebration");

    const data = (cardSetCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.externalId).toBeUndefined();
  });

  it("⛔ skapar INGET set när CM-episoden saknar serie", async () => {
    fetchMock.mockResolvedValue(episodesPage([{ ...EPISODE, series: null }]));
    const l = await createSetLabeler(true);

    expect(await l.label("prod-1", null, "30th Celebration")).toBeNull();
    expect(cardSetCreate).not.toHaveBeenCalled();
    expect(l.stats.noSeries).toBe(1);
  });

  it("skapar setet EN gång även när flera produkter delar episod", async () => {
    const l = await createSetLabeler(true);

    await l.label("prod-1", null, "30th Celebration");
    await l.label("prod-2", null, "30th Celebration");

    expect(cardSetCreate).toHaveBeenCalledTimes(1);
    expect(l.stats.setsCreated).toBe(1);
    expect(l.stats.labeled).toBe(2);
  });

  it("⛔ DELKÖRNING (createMissing=false): etiketterar men skapar aldrig set", async () => {
    const l = await createSetLabeler(false);

    expect(await l.label("prod-1", null, "30th Celebration")).toBeNull();
    expect(cardSetCreate).not.toHaveBeenCalled();
    // Episodlistan får inte ens hämtas — ren kvotförbrukning när vi ändå inte skapar.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("okänd episod → ingen etikett, ingen krasch", async () => {
    fetchMock.mockResolvedValue(episodesPage([]));
    const l = await createSetLabeler(true);

    expect(await l.label("prod-1", null, "Något CM inte har")).toBeNull();
    expect(cardSetCreate).not.toHaveBeenCalled();
    expect(l.stats.unresolved).toBe(1);
  });
});
