import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { artRankTargets } from "@/services/scanner";

const byArt = [{ cardId: "poltchageist-5" }, { cardId: "toedscool-15" }, { cardId: "dartrix-4" }, { cardId: "croagunk-114" }];

describe("artRankTargets — bildens topp märks 'visas alltid'", () => {
  it("AVGJORD bild: bara vinnaren märks — tvåan/trean är kort bilden dömt ut", () => {
    // Fältfall 2026-08-30: Poltchageist #5 avgjord på 0,802 (marginal 0,13),
    // raden visade Croagunk/Mankey/Toedscool/Dartrix — samma ram, annan Pokémon.
    expect(artRankTargets(byArt, "poltchageist-5").map((c) => c.cardId)).toEqual(["poltchageist-5"]);
  });

  it("⛔ OSÄKER bild: topp-3 märks som förut (Probopass 0,722 mot hallucinerat namn)", () => {
    expect(artRankTargets(byArt, null).map((c) => c.cardId)).toEqual([
      "poltchageist-5",
      "toedscool-15",
      "dartrix-4",
    ]);
  });
});
