/**
 * SVEP-NER-DOMEN. Regeln har felat i fält TVÅ gånger på en dag, båda gångerna
 * med symtomet "fungerar när jag sveper snabbt, inte när jag sveper långsamt".
 * Testet finns för att en tredje gång ska fångas här i stället för av ägaren.
 */
import { describe, expect, it } from "vitest";
import {
  CLOSE_PX,
  DIRECTION_PX,
  FLICK_PX,
  FLICK_V,
  classifyDrag,
  shouldCloseSheet,
} from "@/lib/sheet-drag";

describe("classifyDrag", () => {
  it("⛔ läser riktningen UNDER webbläsarens scrolltröskel", () => {
    // Hela bugg 2: låstes axeln vid 8 px hann WebKit (~5 px) ta gesten först
    // vid ett långsamt svep, skickade touchcancel och arket frös. Höjs den här
    // konstanten tillbaka mot 8 återuppstår buggen — och den syns BARA för den
    // som sveper långsamt.
    expect(DIRECTION_PX).toBeLessThan(5);
  });

  it("väntar bara så länge riktningen inte går att läsa", () => {
    expect(classifyDrag(0, 0, true)).toBe("wait");
    expect(classifyDrag(2, 2, true)).toBe("wait");
    // Ett LÅNGSAMT svep levererar några pixlar per ruta — och måste ha beslutat
    // sig redan där.
    expect(classifyDrag(0, DIRECTION_PX, false)).toBe("own");
    expect(classifyDrag(0, 4, false)).toBe("own");
  });

  it("äger nedåtdrag både från handtaget och från kroppen", () => {
    expect(classifyDrag(0, 40, true)).toBe("own");
    expect(classifyDrag(0, 40, false)).toBe("own");
    // Snett nedåt är fortfarande nedåt så länge lodrätt dominerar — en tumme
    // drar aldrig rakt.
    expect(classifyDrag(12, 40, false)).toBe("own");
  });

  it("släpper vågräta drag — kandidatraden äger dem", () => {
    expect(classifyDrag(40, 0, false)).toBe("release");
    expect(classifyDrag(40, 12, false)).toBe("release");
    expect(classifyDrag(-40, 12, true)).toBe("release");
  });

  it("släpper drag uppåt i kroppen, men inte på handtaget", () => {
    // Kroppen: uppåt = vanlig scroll och får aldrig stjälas.
    expect(classifyDrag(0, -40, false)).toBe("release");
    // Handtaget scrollar inte — där finns ingen konkurrerande gest att lämna
    // ifrån sig, och draget ger ändå noll förflyttning (dy klampas till 0).
    expect(classifyDrag(0, -40, true)).toBe("own");
  });
});

describe("shouldCloseSheet", () => {
  it("stänger på sträcka även när farten är noll", () => {
    // Det LÅNGSAMMA svepet: ingen fart alls, men fingret har gått långt.
    expect(shouldCloseSheet(CLOSE_PX + 1, 0)).toBe(true);
    expect(shouldCloseSheet(CLOSE_PX - 1, 0)).toBe(false);
  });

  it("stänger på fart även när sträckan är kort", () => {
    expect(shouldCloseSheet(FLICK_PX + 1, FLICK_V + 0.1)).toBe(true);
  });

  it("läser inte en darrning som ett kast", () => {
    // Hög fart men nästan ingen sträcka = fingret studsade vid pekytan.
    expect(shouldCloseSheet(FLICK_PX - 1, 2)).toBe(false);
    expect(shouldCloseSheet(0, 5)).toBe(false);
  });

  it("stänger inte på ett drag uppåt", () => {
    expect(shouldCloseSheet(0, -3)).toBe(false);
  });
});
