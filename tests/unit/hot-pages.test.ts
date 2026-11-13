import { beforeEach, describe, expect, it } from "vitest";
import { commitFullFetch, commitHotFetch, planHotFetch, resetHotPages, setHotUrls } from "@/scrapers/hot-pages";

const it_ = (url: string, s = "out") => ({ url, s });
const full = () =>
  new Map([
    ["p1", [it_("a"), it_("b")]],
    ["p2", [it_("c"), it_("d")]],
    ["p3", [it_("e")]],
  ]);

describe("heta sidor (MaxGaming 2026-11-12)", () => {
  beforeEach(() => resetHotPages());

  it("utan läge eller minne är hämtningen full", () => {
    expect(planHotFetch("X", 0).pages).toBeNull();
    expect(planHotFetch("X", 4).pages).toBeNull();
  });

  it("efter en full hämtning läses sida 1 + sidorna med heta URL:er, och var N:e är full", () => {
    commitFullFetch("X", full());
    setHotUrls("X", ["e"]);
    expect(planHotFetch("X", 4).pages).toEqual(["p1", "p3"]);
    for (let i = 0; i < 3; i++) commitHotFetch("X", new Map([["p1", [it_("a"), it_("b")]]]));
    expect(planHotFetch("X", 4).pages).toBeNull();
  });

  it("feeden är alltid komplett och det färska beskedet vinner", () => {
    commitFullFetch("X", full());
    const out = commitHotFetch("X", new Map([["p1", [it_("a", "in"), it_("c", "in")]]]));
    expect(out.map((x) => x.url).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.find((x) => x.url === "a")?.s).toBe("in");
    // "c" flyttade till sida 1: det färska beskedet, inte sida 2:s gamla.
    expect(out.find((x) => x.url === "c")?.s).toBe("in");
    // "b" föll av sida 1 utan att synas någon annanstans: bärs kvar med sitt gamla besked.
    expect(out.find((x) => x.url === "b")?.s).toBe("out");
  });
});

import { liveStockFor, pickLiveChecks, setLiveStock, setWarmUrls, LIVE_TTL_MS } from "@/scrapers/hot-pages";

describe("live-svar från produktsidan (MaxGaming 14:28 mot 14:32, 2026-11-12)", () => {
  beforeEach(() => resetHotPages());

  it("frågar heta varor som listan kallar slut, heta före varma, och roterar", () => {
    setHotUrls("X", ["a", "b", "c"]);
    setWarmUrls("X", ["c", "d", "e"]);
    const items = ["a", "b", "c", "d", "e"].map((url) => ({ url, inStock: url === "b" }));
    expect(pickLiveChecks("X", items, 2)).toEqual(["a", "c"]);
    expect(pickLiveChecks("X", items, 3)).toEqual(["a", "c", "d"]);
    expect(pickLiveChecks("X", items, 0)).toEqual([]);
  });

  it("ett färskt svar gäller i tio minuter och en oenig vara hålls färsk", () => {
    const t = 1_000_000;
    setLiveStock("X", "a", "in", t);
    expect(liveStockFor("X", "a", t + 60_000)).toBe("in");
    expect(liveStockFor("X", "a", t + LIVE_TTL_MS + 1)).toBeNull();
    // Listan säger i lager, sidan sa slut ⇒ fortsatt kandidat.
    setHotUrls("X", ["b"]);
    setLiveStock("X", "b", "out", t);
    expect(pickLiveChecks("X", [{ url: "b", inStock: true }], 2, t + 1000)).toEqual(["b"]);
  });
});
