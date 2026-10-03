import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { hasStorePosition, storesInBounds, storesForBrowsing, storeClusters } from "@/lib/community-map";
import type { CommunityStoreDto } from "@/services/community-stores";
import curated from "@/data/community-stores-curated.json";

const store = (id: string, latitude: number | null, longitude: number | null): CommunityStoreDto => ({ id, name: id, city: "Stockholm", address: "Test", latitude, longitude });
describe("community store map", () => {
  it("keeps the whole catalogue browsable, including stores outside the map and without coordinates", () => {
    const input = [{ ...store("far", 65, 20), city: "Örebro" }, { ...store("unknown", null, null), city: "Boden" }, { ...store("near", 59.3, 18), city: "Alingsås" }];
    expect(storesForBrowsing(input, null).map(s => s.id)).toEqual(["near", "unknown", "far"]);
    expect(input.map(s => s.id)).toEqual(["far", "unknown", "near"]);
  });
  it("uses the user's location for nearest-first browsing and places unknown distances last", () => {
    expect(storesForBrowsing([store("unknown", null, null), store("far", 65, 20), store("near", 59.31, 18.01)], { latitude: 59.3, longitude: 18 }).map(s => s.id)).toEqual(["near", "far", "unknown"]);
  });
  it("never places incomplete or invalid coordinates on the map", () => {
    for (const s of [store("missing", null, null), store("half", 59, null), store("nan", NaN, 18), store("outside", 95, 18)]) expect(hasStorePosition(s)).toBe(false);
  });
  it("uses the visible map area and nearest-first distance, without inventing unmapped pins", () => {
    const a = store("far", 59.4, 18.1); const b = store("near", 59.31, 18.01);
    expect(storesInBounds([a, store("outside", 61, 19), store("unknown", null, null), b], { south: 59, north: 60, west: 17, east: 19 }, { latitude: 59.3, longitude: 18 }).map(s => s.id)).toEqual(["near", "far"]);
  });
  it("clusters overlapping pins but separates them as the projection zooms in", () => {
    const a = store("a", 59, 18); const b = store("b", 59.01, 18.01);
    if (!hasStorePosition(a) || !hasStorePosition(b)) throw Error("fixture");
    expect(storeClusters([a, b], s => ({ x: (s.longitude - 18) * 1000, y: 0 }))).toHaveLength(1);
    expect(storeClusters([a, b], s => ({ x: (s.longitude - 18) * 10000, y: 0 }))).toHaveLength(2);
  });
  it("includes current missing chains and existing retailers with local branch logos", () => {
    for (const name of ["Webhallen Fridhemsplan", "Webhallen Frölunda Torg", "Kandyz Länna", "Speltrollet", "RGB Kingz", "Manatörsk", "Spelgalaxen"]) {
      expect(curated.some(s => s.name === name)).toBe(true);
    }
    for (const s of curated) {
      expect(s.logoUrl).toMatch(/^\/retailer-logos\/[a-z0-9-]+\.png$/);
      expect(existsSync(`public${s.logoUrl}`)).toBe(true);
    }
  });
  it("every seeded store has address and Pokémon evidence; map coordinates require an exact address source", () => {
    expect(new Set(curated.map(s => `${s.name}|${s.address}|${s.city}`)).size).toBe(curated.length);
    for (const s of curated) {
      expect(s.source).toMatch(/^https:\/\//); expect(s.pokemonSource).toMatch(/^https:\/\//);
      if (s.latitude != null) {
        expect(s.longitude).not.toBeNull();
        expect(s.coordinateSource).toMatch(/^https:\/\//);
        if (!s.coordinateSource?.includes("openstreetmap.org")) expect(s.coordinateLabel).toContain(s.address);
        else expect(s.coordinateLabel.toLowerCase()).toContain(s.address.match(/\d+/)?.[0]);
      }
    }
  });
});
