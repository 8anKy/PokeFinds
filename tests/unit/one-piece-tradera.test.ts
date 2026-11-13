import { describe, expect, it } from "vitest";
import { matchOnePieceTraderaSingle, onePieceCodesInTitle, type OpCardRow } from "@/lib/one-piece-tradera";

/** Riktiga annonser ur Traderas One Piece-kategori 2026-11-13 mot en liten katalog. */
const rows: OpCardRow[] = [
  { productId: "nami-base", number: "OP01-016", name: "Nami", title: "Nami OP01-016", setCode: "OP01" },
  { productId: "nami-aa", number: "OP01-016", name: "Nami", title: "Nami OP01-016 (Alternate Art)", setCode: "OP01" },
  { productId: "nami-prb", number: "OP01-016", name: "Nami", title: "Nami OP01-016", setCode: "PRB01" },
  { productId: "luffy-sp", number: "OP09-119", name: "Monkey.D.Luffy", title: "Monkey.D.Luffy OP09-119 (Special Rare)", setCode: "OP09" },
  { productId: "luffy-base", number: "OP09-119", name: "Monkey.D.Luffy", title: "Monkey.D.Luffy OP09-119", setCode: "OP09" },
  { productId: "rosinante", number: "OP02-108", name: "Donquixote Rosinante", title: "Donquixote Rosinante OP02-108", setCode: "OP02" },
  { productId: "shanks-p", number: "P-083", name: "Shanks", title: "Shanks P-083", setCode: "P" },
  { productId: "alvida", number: "EB05-021", name: "Alvida", title: "Alvida EB05-021", setCode: "EB05" },
];
const byNumber = new Map<string, OpCardRow[]>();
for (const r of rows) (byNumber.get(r.number) ?? byNumber.set(r.number, []).get(r.number)!).push(r);
const hit = (t: string) => { const v = matchOnePieceTraderaSingle(t, byNumber); return "reason" in v ? v.reason : v.productId; };

describe("onePieceCodesInTitle", () => {
  it("läser koder i de former säljare skriver", () => {
    expect(onePieceCodesInTitle("One piece Kalgara OP08-098 Leader")).toEqual(["OP08-098"]);
    expect(onePieceCodesInTitle("Dr. Hogback op14-110")).toEqual(["OP14-110"]);
    expect(onePieceCodesInTitle("Shanks P-083 - One Piece Card Game")).toEqual(["P-083"]);
    expect(onePieceCodesInTitle("Roger #118 - 2024 One Piece OP09 - PSA 10")).toEqual([]);
  });
});

describe("matchOnePieceTraderaSingle", () => {
  it("utan märke = grundtryckningen i ursprungssetet, aldrig omtrycket", () => {
    expect(hit("Nami - OP01-016 - One Piece Card Game")).toBe("nami-base");
    expect(hit("Alvida - EB05-021 SR - One Piece Card Game")).toBe("alvida");
    expect(hit("Shanks P-083 - One Piece Card Game")).toBe("shanks-p");
  });
  it("läser tryckningen ur titeln", () => {
    expect(hit("Nami OP01-016 Alternate Art One Piece")).toBe("nami-aa");
    expect(hit("Monkey D. Luffy - OP09-119 SP - One Piece Card Game")).toBe("luffy-sp");
  });
  it("fäller det som inte går att peka ut", () => {
    expect(hit("One Piece Card Game Tsuru OP02-108 SR")).toBe("kortnamnet saknas (fel kod?)");
    expect(hit("Nami OP01-016 Treasure Cup promo")).toBe("särtryck utan säker tryckning");
    expect(hit("Nami OP01-016 Manga")).toBe("tryckningen Manga Rare går inte att peka ut");
    expect(hit("Monkey D. Luffy - OP09-119 - PSA 10 GEM MT")).toBe("graderat");
    expect(hit("Nami OP01-016 japansk")).toBe("annat språk");
    expect(hit("Nami OP01-016 + Luffy OP09-119")).toBe("flera kortkoder");
    expect(hit("4x Nami OP01-016")).toBe("parti/antal");
    expect(hit("One Piece kort")).toBe("ingen kortkod");
    expect(hit("Brook ST01-011 Pirate Foil")).toBe("koden saknas i katalogen");
  });
});
