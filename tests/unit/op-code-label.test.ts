import { describe, expect, it } from "vitest";
import { matchOnePieceListing, opCodeLabel, withOpCode } from "@/lib/one-piece-listing";

describe("One Piece-koden i namn (ägaren 2026-11-12)", () => {
  it("skrivs som spelarna skriver den", () => {
    expect(opCodeLabel("OP17")).toBe("OP-17");
    expect(opCodeLabel("OP-18")).toBe("OP-18");
    expect(opCodeLabel("EB05")).toBe("EB-05");
    expect(opCodeLabel("ST35")).toBe("ST-35");
    expect(opCodeLabel("PRB02")).toBe("PRB-02");
    expect(opCodeLabel("OP17P")).toBeNull();
    expect(opCodeLabel(null)).toBeNull();
  });

  it("läggs först i namnet, en gång", () => {
    expect(withOpCode("The World's Strongest Warriors", "OP17")).toBe("OP-17 The World's Strongest Warriors");
    expect(withOpCode("OP-17 The World's Strongest Warriors Booster Box", "OP17")).toBe("OP-17 The World's Strongest Warriors Booster Box");
    expect(withOpCode("Promos: The Time of Battle", "OP16P")).toBe("Promos: The Time of Battle");
  });

  it("butiksmatchningen tål koden i katalogtiteln", () => {
    const catalog = {
      sets: [{ id: "s17", name: "The World's Strongest Warriors", code: "OP17" }],
      products: [
        { id: "box", title: "OP-17 The World's Strongest Warriors Booster Box", setId: "s17" },
        { id: "pack", title: "OP-17 The World's Strongest Warriors Booster", setId: "s17" },
        { id: "dp", title: "Double Pack Set Vol.10", setId: null },
      ],
    };
    expect(matchOnePieceListing("One Piece TCG: The World's Strongest Warriors Booster Box (OP-17)", catalog)).toBe("box");
    expect(matchOnePieceListing("One Piece Card Game The World's Strongest Warriors Booster", catalog)).toBe("pack");
    expect(matchOnePieceListing("One Piece Double Pack Set Vol.10 (DP-10)", catalog)).toBe("dp");
  });
});
