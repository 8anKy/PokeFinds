/**
 * NUMRET OCH TOTALEN KOMMER UR SAMMA LÄSNING. När katalogen bekräftar totalen
 * för en tryckning med samma namn, men numret pekar på ett set totalen
 * utesluter, är numret den felläsa halvan och ger inget bevis.
 *
 * Fallet är det VERKLIGA: ägarens fältrunda 2026-08-02 läste Scorbunny 36
 * (Ascended Heroes, 217 kort) som "026/217" och landade på Scorbunny 26
 * (Stellar Crown, 142) — med så stor marginal att träffen aldrig märktes "?".
 */
import { describe, expect, it } from "vitest";
import { namesConfirmingTotal, numberMatchBonus } from "@/services/scanner/index";

const card = (name: string, totalCards: number) => ({ name, set: { totalCards } });

const SCORBUNNY_POOL = [
  card("Scorbunny", 217), // 36 · Ascended Heroes — RÄTT kort
  card("Scorbunny", 142), // 26 · Stellar Crown
  card("Scorbunny", 132), // 26 · Mega Evolution
  card("Scorbunny", 198), // 26 · Chilling Reign
  card("Baltoy", 217),
];

describe("namesConfirmingTotal", () => {
  it("pekar ut namnet när ett set i poolen har EXAKT den lästa totalen", () => {
    expect(namesConfirmingTotal(SCORBUNNY_POOL, 217)).toEqual(new Set(["scorbunny", "baltoy"]));
  });

  it("är tom när modellen inte läste någon total", () => {
    expect(namesConfirmingTotal(SCORBUNNY_POOL, null).size).toBe(0);
  });

  it("är tom när totalen inte pekar ut något set — en ren felläsning", () => {
    // "109/111": ingen kandidat har 111 kort → totalen säger ingenting.
    expect(namesConfirmingTotal(SCORBUNNY_POOL, 111).size).toBe(0);
  });

  it("räknar aldrig ett set med okänd storlek som bekräftelse", () => {
    expect(namesConfirmingTotal([card("Snorunt", 0)], 0).size).toBe(0);
  });
});

describe("numberMatchBonus", () => {
  const confirmed = namesConfirmingTotal(SCORBUNNY_POOL, 217);

  it("SCORBUNNY-FALLET: nummerträff i ett set totalen utesluter ger NOLL", () => {
    expect(numberMatchBonus(card("Scorbunny", 142), 217, confirmed)).toBe(0);
  });

  it("…medan nummer + total som stämmer är det starkaste beviset", () => {
    expect(numberMatchBonus(card("Scorbunny", 217), 217, confirmed)).toBe(0.5);
  });

  it("oläst total ger den mellersta bonusen — numret står ensamt", () => {
    expect(numberMatchBonus(card("Scorbunny", 142), null, new Set())).toBe(0.4);
  });

  it("motsägande total som INTE pekar någon annanstans ger kvar 0,25", () => {
    // Cynthia's Gible lästes "109/111". Ingen kandidat har 111 kort, så totalen
    // är bara felläst — då får nummerträffen inte underkännas.
    const none = namesConfirmingTotal(SCORBUNNY_POOL, 111);
    expect(numberMatchBonus(card("Cynthia's Gible", 217), 111, none)).toBe(0.25);
  });

  it("SECRET RARES rörs inte: setet bär den TRYCKTA totalen", () => {
    // Kort 225 i ett set tryckt "/217" → grenen "nummer + total matchar".
    expect(numberMatchBonus(card("Scorbunny", 217), 217, confirmed)).toBe(0.5);
  });

  it("okänd setstorlek behandlas som samstämmig, aldrig som motsägelse", () => {
    expect(numberMatchBonus(card("Okänt", 0), 217, confirmed)).toBe(0.5);
  });

  it("ett ANNAT korts namn påverkas inte av bekräftelsen", () => {
    // Poolens Baltoy bekräftar 217, men en nummerträff på Snorunt i ett set med
    // annan storlek ska inte underkännas av det.
    expect(numberMatchBonus(card("Snorunt", 142), 217, confirmed)).toBe(0.25);
  });
});
