/**
 * FÅNGSTKVALITETEN GRINDAR AUTO-SLUTAREN — ett mått som tyst blir 0 skulle
 * stänga av automatiken helt, och ett som tyst blir stort skulle göra grinden
 * verkningslös. Båda felen är osynliga i drift.
 */
import { describe, expect, it } from "vitest";
import { frameSharpness, SHARP_AUTO_MIN } from "@/lib/frame-sharpness";

/** RGBA-buffert ur en funktion som ger gråvärde per pixel. */
function gray(w: number, h: number, f: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = f(x, y);
      const i = (y * w + x) * 4;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return px;
}

describe("frameSharpness", () => {
  it("ett schackrutmönster är skarpare än en jämn yta", () => {
    const w = 32;
    const h = 32;
    const flat = frameSharpness(gray(w, h, () => 128), w, h);
    const checker = frameSharpness(gray(w, h, (x, y) => ((x + y) % 2 ? 200 : 60)), w, h);
    expect(flat).toBe(0);
    expect(checker).not.toBeNull();
    expect(checker!).toBeGreaterThan(flat!);
  });

  it("oskärpa SÄNKER talet — samma motiv, utsuddade kanter", () => {
    // En kant var 4:e pixel (skarp) mot en linjär ramp över samma avstånd
    // (utsuddad). Samma medelluminans, samma amplitud — bara flankens brantheten
    // skiljer, vilket är precis vad rörelseoskärpa gör med en fångst.
    const w = 64;
    const h = 64;
    const sharp = frameSharpness(gray(w, h, (x) => (Math.floor(x / 4) % 2 ? 200 : 60)), w, h);
    const blurred = frameSharpness(
      gray(w, h, (x) => 130 + 70 * Math.sin((x / 4) * Math.PI * 0.5)),
      w,
      h
    );
    expect(sharp!).toBeGreaterThan(blurred!);
  });

  it("EXPONERINGSOKÄNSLIGT: samma motiv dubbelt så ljust ger samma tal", () => {
    // ⛔ Utan normaliseringen mot medelluminansen rankas en ljus bild över en
    // mörk oavsett skärpa — och skannern används både i solljus och i soffan.
    // Då hade grinden blivit en ljusmätare, inte en skärpemätare.
    const w = 32;
    const h = 32;
    const dim = frameSharpness(gray(w, h, (x, y) => ((x + y) % 2 ? 100 : 30)), w, h);
    const bright = frameSharpness(gray(w, h, (x, y) => ((x + y) % 2 ? 200 : 60)), w, h);
    expect(dim!).toBeCloseTo(bright!, 5);
  });

  it("null, INTE 0, när måttet inte gick att räkna", () => {
    // ⛔ 0 betyder "helt jämn yta" (ett vitt papper i ramen). null betyder "gick
    // inte att mäta". Blandas de ihop blockerar en omätbar ruta auto-slutaren
    // för alltid — samma klass av fel som `priceOreFromEur` finns för.
    expect(frameSharpness(gray(2, 2, () => 128), 2, 2)).toBeNull();
    expect(frameSharpness(gray(16, 16, () => 0), 16, 16)).toBeNull();
    expect(frameSharpness(gray(16, 16, () => 128), 16, 16)).toBe(0);
  });

  it("en helt jämn yta faller under auto-tröskeln, ett skarpt motiv över", () => {
    const w = 48;
    const h = 48;
    expect(frameSharpness(gray(w, h, () => 128), w, h)!).toBeLessThan(SHARP_AUTO_MIN);
    expect(
      frameSharpness(gray(w, h, (x) => (Math.floor(x / 3) % 2 ? 210 : 45)), w, h)!
    ).toBeGreaterThan(SHARP_AUTO_MIN);
  });
});
