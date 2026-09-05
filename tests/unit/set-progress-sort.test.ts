/**
 * Sorteringarna i Set-fliken. Rena komparatorer.
 *
 * Den bärande regeln testerna vaktar: OKÄNT SORTERAS SIST i varje läge. Ett set
 * utan nämnare (de 95 japanska, noll kort hos oss) eller utan känt värde får
 * aldrig hamna överst genom att räknas som 0 — då hade "närmast klart" toppats
 * av det vi vet minst om.
 */
import { describe, expect, it } from "vitest";
import { sortSetRows } from "@/app/[locale]/(portfolio)/samling/set-progress-sort";
import type { SetPortfolioRow } from "@/services/set-portfolio";

function row(p: Partial<SetPortfolioRow> & { setId: string }): SetPortfolioRow {
  return {
    setName: p.setId,
    series: "",
    logoUrl: null,
    ownedCards: 0,
    copies: 0,
    total: null,
    percent: null,
    ownedPrintings: 0,
    printings: null,
    masterPercent: null,
    printingsElsewhere: null,
    catalogShort: false,
    valueOre: null,
    valueMissingCount: 0,
    sealedOnly: false,
    ...p,
  };
}

const ids = (rows: SetPortfolioRow[]) => rows.map((r) => r.setId);

describe("sortSetRows", () => {
  it("närmast klart: högst procent först, okänt sist", () => {
    const rows = [
      row({ setId: "a", percent: 10, ownedCards: 10, total: 100 }),
      row({ setId: "jp", percent: null, total: null }),
      row({ setId: "b", percent: 90, ownedCards: 90, total: 100 }),
    ];
    expect(ids(sortSetRows(rows, "closest"))).toEqual(["b", "a", "jp"]);
  });

  it("lika procent bryts på antal ägda kort", () => {
    const rows = [
      row({ setId: "liten", percent: 50, ownedCards: 5, total: 10 }),
      row({ setId: "stor", percent: 50, ownedCards: 95, total: 190 }),
    ];
    expect(ids(sortSetRows(rows, "closest"))).toEqual(["stor", "liten"]);
  });

  it("högst värde först, okänt värde sist", () => {
    const rows = [
      row({ setId: "billig", valueOre: 1000 }),
      row({ setId: "okänd", valueOre: null }),
      row({ setId: "dyr", valueOre: 500000 }),
    ];
    expect(ids(sortSetRows(rows, "value"))).toEqual(["dyr", "billig", "okänd"]);
  });

  it("flest kvar: FÄRREST kvar först — listan 'vad kan jag bli klar med nu?'", () => {
    const rows = [
      row({ setId: "långt", ownedCards: 10, total: 200 }),
      row({ setId: "nära", ownedCards: 115, total: 120 }),
      row({ setId: "okänt", ownedCards: 3, total: null }),
    ];
    expect(ids(sortSetRows(rows, "remaining"))).toEqual(["nära", "långt", "okänt"]);
  });

  it("namn sorteras med svenska regler — å/ä/ö sist, inte som a/o", () => {
    const rows = [
      row({ setId: "ö", setName: "Ödesdiger" }),
      row({ setId: "a", setName: "Astral Radiance" }),
      row({ setId: "z", setName: "Zenith" }),
      row({ setId: "ä", setName: "Ärlig" }),
    ];
    expect(ids(sortSetRows(rows, "name"))).toEqual(["a", "z", "ä", "ö"]);
  });

  it("sorterar en KOPIA — indatan rörs aldrig", () => {
    const rows = [row({ setId: "a", percent: 1 }), row({ setId: "b", percent: 99 })];
    const before = ids(rows);
    sortSetRows(rows, "closest");
    expect(ids(rows)).toEqual(before);
  });

  it("bara okända rader kraschar inte och behåller sin ordning", () => {
    const rows = [row({ setId: "x" }), row({ setId: "y" })];
    expect(ids(sortSetRows(rows, "closest"))).toEqual(["x", "y"]);
    expect(ids(sortSetRows(rows, "value"))).toEqual(["x", "y"]);
    expect(ids(sortSetRows(rows, "remaining"))).toEqual(["x", "y"]);
  });
});
