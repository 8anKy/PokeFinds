import { describe, expect, it } from "vitest";
import { isAccessoryListing } from "@/scrapers/matching";

/**
 * SKYDDSPLASTVAKTEN (`PROTECTOR_SIGNS`, utökad 2026-08-16).
 *
 * `protectors?` fångade inte adjektivet, så Hobbykorts fem "Pokémon **Protective**
 * Case - Booster Box / Elite Trainer Box / Mini Tin Display" passerade HELA
 * vaktkedjan — formordet "Booster Box" gav dem till och med en giltig kategori. De
 * kunde alltså både bli katalogprodukter och postas som restock-larm i Discord.
 *
 * ⛔ BART `\bprotective\b` ÄR FÖRBJUDET. Mätt mot prod-katalogen är "Protective
 *    Goggles · 151 164/165" och "Protective Orb · Unseen Forces 90/115" riktiga
 *    trainer-KORT (4 rader, 9 offers), och vakten sitter också i `productsConflict`
 *    där en falsk träff blockerar en korrekt butikslänk TYST. Substantivet är det som
 *    gör tecknet entydigt — samma läxa som bart "accessory", bart "display" och bart
 *    "figure" redan lärt oss.
 */
describe("protective + substantiv = tillbehör", () => {
  const accessories = [
    "Pokémon Protective Case - Booster Box Japanese (Regular)",
    "Pokémon Protective Case - Booster Bundle Display",
    "Pokémon Protective Case - Mini Tin Display",
    "Pokémon Protective Case - Elite Trainer Box",
    "Pokemon Protective Sleeves 100-pack",
  ];
  for (const t of accessories) {
    it(`fäller "${t}"`, () => expect(isAccessoryListing(t)).toBe(true));
  }

  const realCards = [
    "Protective Goggles · 151 164/165",
    "Protective Goggles · 151 164/165 · Reverse Holo",
    "Protective Orb · Unseen Forces 90/115",
    "Protective Orb · Unseen Forces 90/115 · Reverse Holo",
  ];
  for (const t of realCards) {
    it(`släpper IGENOM det riktiga kortet "${t}"`, () =>
      expect(isAccessoryListing(t)).toBe(false));
  }
});
