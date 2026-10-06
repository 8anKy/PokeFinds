import { describe, expect, it } from "vitest";
import { duplicateKey, rotationSlice } from "@/lib/store-social-rotation";

describe("rotationSlice", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("börjar vid markören och varvar runt", () => {
    expect(rotationSlice(items, 3, 3)).toEqual({ picked: ["d", "e", "a"], next: 1 });
  });

  it("läser aldrig samma konto två gånger i en körning", () => {
    expect(rotationSlice(items, 0, 45)).toEqual({ picked: items, next: 0 });
  });

  it("en markör bortom listan (listan krympte) normaliseras", () => {
    expect(rotationSlice(items, 12, 2).picked).toEqual(["c", "d"]);
  });

  it("tom lista", () => {
    expect(rotationSlice([], 7, 10)).toEqual({ picked: [], next: 0 });
  });
});

describe("duplicateKey", () => {
  it("samma text från två filialer ger samma nyckel trots emoji, versaler och radbrytningar", () => {
    const a = "Pokémon 30th Celebration finns nu hos oss! 🎉\nVälkommen in";
    const b = "POKEMON 30th celebration finns nu hos oss!! Välkommen in ✨";
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });

  it("olika text ger olika nyckel", () => {
    expect(duplicateKey("Pokémon 30th Celebration finns nu hos oss")).not.toBe(
      duplicateKey("Pokémon Phantasmal Flames finns nu hos oss")
    );
  });

  it("för kort text dedupliceras inte", () => {
    expect(duplicateKey("Nu finns den!")).toBeNull();
  });
});
