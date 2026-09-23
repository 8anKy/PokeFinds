/**
 * Två följdfel i Tradera-flödet (2026-09-23), båda MÄTTA i produktion:
 *
 *  1. Aktiva svepet kastade FÖRSEGLADE annonser där säljaren fyllt i Traderas
 *     graderingsfält ("Övriga") — samma felifyllning som gav boosterpaket en
 *     graderad serie i sålt-svepet (2026-09-22). Titeln dömer i parsern; fältet
 *     döms först mot produktens kategori (`gradingBlocksListing`).
 *  2. Katalogens "Pokémon GO Elite Trainer Box" saknade särskiljande ord ("go" var
 *     för kort och räknades bara på ANNONS-sidan) — 17 av 17 sålda "GO-ETB:er" var
 *     30th Celebration-ETB:er, och "Pokemon TCG Booster Pack" landade på GO-boostern.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { gradingBlocksListing, parseItemsFromXml, type TraderaItem } from "@/jobs/tradera-sweep";
import { applySetAliases, distinctiveOverlap, matchProduct, type MatchIndex } from "@/scrapers/matching";

const grading = (issuer: string, grade: string) => `
  <TermAttributeValues><Name>pokemon_grading_issuer</Name><Values><string>${issuer}</string></Values></TermAttributeValues>
  <TermAttributeValues><Name>pokemon_grade</Name><Values><string>${grade}</string></Values></TermAttributeValues>`;

const item = (id: string, title: string, cat: number, extra = "") => `<Items>
  <Id>${id}</Id>
  <ShortDescription>${title}</ShortDescription>
  <CategoryId>${cat}</CategoryId>
  <BuyItNowPrice>500</BuyItNowPrice>
  <ItemLink>https://www.tradera.com/item/${cat}/${id}/x</ItemLink>
  ${extra}
</Items>`;

const XML = `<SearchResult><TotalNumberOfPages>1</TotalNumberOfPages>
${item("1", "Pitch Black Booster Pack", 1001339, grading("Övriga", "10"))}
${item("2", "Charizard ex PSA 10", 1001337)}
${item("3", "Umbreon VMAX 215/203", 1001337, grading("PSA", "9"))}
${item("4", "Pitch Black Elite Trainer Box", 1001341)}
</SearchResult>`;

describe("graderingsfältet på förseglat (aktiva svepet)", () => {
  const { items } = parseItemsFromXml(XML);
  const byId = new Map(items.map((i) => [i.itemId, i]));

  it("en förseglad annons med ifyllt graderingsfält KASTAS INTE i parsern", () => {
    expect(byId.get("1")?.gradingAttr).toEqual({ issuer: "Övriga", grade: "10" });
  });

  it("titeln dömer direkt: en slab i titeln kommer aldrig ut ur parsern", () => {
    expect(byId.has("2")).toBe(false);
  });

  it("fältet döms mot produktens kategori: förseglat släpps, kort blockeras", () => {
    const sealed = byId.get("1") as TraderaItem;
    expect(gradingBlocksListing("BOOSTER_PACK", sealed)).toBe(false);
    expect(gradingBlocksListing("ETB", sealed)).toBe(false);
    const card = byId.get("3") as TraderaItem;
    expect(gradingBlocksListing("SINGLE_CARD", card)).toBe(true);
  });

  it("utan graderingsfält blockeras ingenting", () => {
    expect(gradingBlocksListing("SINGLE_CARD", byId.get("4") as TraderaItem)).toBe(false);
  });
});

const INDEX: MatchIndex = [
  "pokemon go elite trainer box",
  "pokemon go booster",
  "xy booster",
  "dp collection",
  "30th celebration elite trainer box",
  "30th celebration pokemon center elite trainer box",
  "celebrations elite trainer box",
].map((normalizedTitle, i) => ({ id: `p${i}`, normalizedTitle, card: null, language: "EN" as const }));
const titleOf = (id: string | undefined) => INDEX.find((p) => p.id === id)?.normalizedTitle ?? null;
const match = async (t: string) => titleOf((await matchProduct(t, INDEX, t))?.productId);

describe("set-lösa titlar och korta set-namn (matchProduct)", () => {
  it("en katalogprodukt med kort set-namn har ett särskiljande ord", () => {
    expect(distinctiveOverlap("", "pokemon go elite trainer box")).toBe(0);
    expect(distinctiveOverlap("", "xy booster")).toBe(0);
    expect(distinctiveOverlap("", "dp collection")).toBe(0);
  });

  it("en set-lös titel matchar INTE Pokémon GO / XY", async () => {
    expect(await match("Pokemon TCG Booster Pack")).toBeNull();
    expect(await match("Elite Trainer Box")).toBeNull();
  });

  it("GO-titlar hittar fortfarande GO-produkterna", async () => {
    expect(await match("Pokémon GO Elite Trainer Box")).toBe("pokemon go elite trainer box");
    expect(await match("Pokémon GO Booster Pack")).toBe("pokemon go booster");
  });

  it("svenska och korta namn på 30th Celebration hittar rätt set", async () => {
    for (const t of [
      "Pokémon TCG: 30-årsjubileum Elite Trainer Box (ETB)",
      "Pokémon TCG: Elite Trainer Box - 30-årsfirande",
      "Pokemon 30th elite trainer box",
    ]) {
      expect(await match(t), t).toBe("30th celebration elite trainer box");
    }
  });

  it("aliaset rör inte titlar som redan säger Celebration, och aldrig 25-årets Celebrations", async () => {
    expect(applySetAliases("30th celebration booster bundle")).toBe("30th celebration booster bundle");
    expect(await match("Pokémon Celebrations Elite Trainer Box")).toBe("celebrations elite trainer box");
  });
});
