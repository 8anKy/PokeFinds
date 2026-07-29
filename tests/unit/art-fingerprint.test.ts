/**
 * KONSTAVTRYCKET måste räknas IDENTISKT på server och klient.
 *
 * Servern bygger indexet ur `sharp().removeAlpha().raw()` — 3 kanaler. Klienten
 * räknar avtrycket ur `canvas.getImageData()` — 4 kanaler (RGBA). Räknar de två
 * olika blir varje jämförelse meningslös, och felet är TYST: matchningen blir bara
 * gradvis sämre, inget kastar. Det är samma fälla som `Card.numberSortKey` mot
 * `cardNumberSortKey()`, och den fångas på samma sätt — genom att jämföra dem
 * parvis i ett test.
 */
import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_BYTES,
  FINGERPRINT_INSETS,
  GRID_H,
  GRID_W,
  cosineSimilarity,
  fingerprintFromRgb,
  toUnitVector,
} from "@/lib/art-fingerprint";

/**
 * Deterministiskt testmotiv definierat på NORMALISERADE koordinater (u,v ∈ [0,1]).
 *
 * Att motivet är en funktion av u/v och inte av pixelindex är hela poängen: då är
 * `makeImage(88, 121)` och `makeImage(352, 484)` SAMMA bild i två upplösningar,
 * vilket är precis fallet avtrycket måste tåla — referensen byggs ur en
 * katalogbild (~245×342) och frågan ur en kamerafångst (~914×1280).
 *
 * (Första versionen använde ett modulomönster på pixelindex. Det gav två HELT
 * OLIKA aliasmönster i de två storlekarna, så testet mätte ingenting — det såg
 * bara ut som om avtrycket vore upplösningskänsligt.)
 *
 * Amplituden hålls inom [40, 215] så ett ljusstyrketillägg på ±25 inte klipper
 * mot 0/255 — klippning är en ANNAN sorts förändring än en exponeringsändring.
 */
function makeImage(w: number, h: number, channels: 3 | 4, shift = 0): Uint8Array {
  const px = new Uint8Array(w * h * channels);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const p = (y * w + x) * channels;
      px[p] = clamp(128 + 80 * Math.sin(6.2 * u) * Math.cos(3.1 * v) + shift);
      px[p + 1] = clamp(128 + 70 * Math.sin(2.7 * v + 1.1) + shift);
      px[p + 2] = clamp(128 + 60 * Math.cos(4.3 * u + 2.0 * v) + shift);
      if (channels === 4) px[p + 3] = 255;
    }
  }
  return px;
}

describe("art-fingerprint", () => {
  it("ger 264 byte (8×11 celler × RGB)", () => {
    expect(FINGERPRINT_BYTES).toBe(GRID_W * GRID_H * 3);
    expect(FINGERPRINT_BYTES).toBe(264);
    const fp = fingerprintFromRgb(makeImage(80, 110, 3), 80, 110, 3);
    expect(fp).not.toBeNull();
    expect(fp!.length).toBe(264);
  });

  it("RGB och RGBA ger EXAKT samma avtryck (server mot klient)", () => {
    // Servern läser 3 kanaler, klienten 4. Samma bildinnehåll måste ge samma
    // nyckel — annars jämför vi äpplen med päron vid varje skanning.
    const w = 91;
    const h = 127;
    const rgb = fingerprintFromRgb(makeImage(w, h, 3), w, h, 3);
    const rgba = fingerprintFromRgb(makeImage(w, h, 4), w, h, 4);
    expect(rgb).not.toBeNull();
    expect(Array.from(rgba!)).toEqual(Array.from(rgb!));
  });

  it("är oberoende av ljusstyrka (monitor + kameraexponering)", () => {
    const w = 96;
    const h = 132;
    const a = fingerprintFromRgb(makeImage(w, h, 3), w, h, 3)!;
    const b = fingerprintFromRgb(makeImage(w, h, 3, 25), w, h, 3)!;
    // Per-kanal standardisering ska göra en jämn ljusförskjutning nästan gratis.
    const sim = cosineSimilarity(toUnitVector(a), toUnitVector(b));
    expect(sim).toBeGreaterThan(0.99);
  });

  it("boxmedelvärdet är upplösningsokänsligt: samma motiv i två storlekar", () => {
    // DET HÄR ÄR KÄRNKRAVET. Indexet byggs ur katalogbilder (~245×342) och frågan
    // kommer från en kamerafångst (~914×1280). Ger samma motiv olika nyckel i
    // olika upplösning är hela bildmatchningen värdelös.
    const small = fingerprintFromRgb(makeImage(88, 121, 3), 88, 121, 3)!;
    const large = fingerprintFromRgb(makeImage(352, 484, 3), 352, 484, 3)!;
    const sim = cosineSimilarity(toUnitVector(small), toUnitVector(large));
    expect(sim).toBeGreaterThan(0.99);
  });

  it("tål udda storlekar som inte delar sig jämnt i rutnätet", () => {
    // 8×11 går inte upp i 245×342 — cellerna får då olika många källpixlar.
    // Eftersom vi delar med antalet per cell (medelvärde, inte summa) ska det
    // inte spela någon roll. En summa hade gett större celler högre värden och
    // avtrycket hade blivit beroende av bildens exakta mått.
    const a = fingerprintFromRgb(makeImage(245, 342, 3), 245, 342, 3)!;
    const b = fingerprintFromRgb(makeImage(914, 1280, 3), 914, 1280, 3)!;
    const sim = cosineSimilarity(toUnitVector(a), toUnitVector(b));
    expect(sim).toBeGreaterThan(0.99);
  });

  it("en helt jämn yta bär ingen information (alla nollor, ingen division med noll)", () => {
    const flat = new Uint8Array(40 * 55 * 3).fill(128);
    const fp = fingerprintFromRgb(flat, 40, 55, 3)!;
    expect(fp.every((v) => v === 0)).toBe(true);
    // Ska inte ge NaN när vektorn normaliseras.
    expect(toUnitVector(fp).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("tolkar Buffer från databasen som int8 med tecken", () => {
    // Prisma ger `Bytes` som Buffer, dvs 0..255. Negativa värden ligger som
    // 128..255 och MÅSTE tolkas om — annars blir varje negativt tal ett stort
    // positivt, och avtrycket är obrukbart utan att något felar.
    const signed = new Int8Array([-127, -1, 0, 1, 127]);
    const asBuffer = Buffer.from(signed.buffer, signed.byteOffset, signed.length);
    const fromInt8 = toUnitVector(signed);
    const fromBuffer = toUnitVector(asBuffer);
    expect(Array.from(fromBuffer)).toEqual(Array.from(fromInt8));
    expect(fromBuffer[0]).toBeLessThan(0);
  });

  it("identiska bilder ger cosinuslikhet 1, olika bilder märkbart lägre", () => {
    const w = 96;
    const h = 132;
    const a = toUnitVector(fingerprintFromRgb(makeImage(w, h, 3), w, h, 3)!);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);

    // Ett annat motiv: invertera bilden.
    const other = makeImage(w, h, 3);
    for (let i = 0; i < other.length; i++) other[i] = 255 - other[i];
    const b = toUnitVector(fingerprintFromRgb(other, w, h, 3)!);
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });

  describe("inset (svepet som gör ramen oviktig)", () => {
    /** Lägger mörk bakgrund runt bilden — som en fångst där ramen inte sitter tätt. */
    function pad(px: Uint8Array, w: number, h: number, frac: number) {
      const dx = Math.round(w * frac);
      const dy = Math.round(h * frac);
      const W = w + dx * 2;
      const H = h + dy * 2;
      const out = new Uint8Array(W * H * 3).fill(20);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = (y * w + x) * 3;
          const d = ((y + dy) * W + x + dx) * 3;
          out[d] = px[s];
          out[d + 1] = px[s + 1];
          out[d + 2] = px[s + 2];
        }
      }
      return { px: out, w: W, h: H };
    }

    it("ett inset som matchar marginalen återställer avtrycket", () => {
      // KÄRNAN I FIXEN. Marginal runt kortet smittar ytterringen av rutnätet (34
      // av 88 celler) och gjorde kortet omöjligt att hitta i produktion. Beskärs
      // frågan med motsvarande inset ska avtrycket bli nästan identiskt igen.
      const w = 200;
      const h = 279;
      const base = makeImage(w, h, 3);
      const clean = toUnitVector(fingerprintFromRgb(base, w, h, 3)!);

      const padded = pad(base, w, h, 0.06);
      const naive = toUnitVector(
        fingerprintFromRgb(padded.px, padded.w, padded.h, 3)!
      );
      // Marginalen ska GÖRA SKILLNAD — annars mäter testet ingenting.
      expect(cosineSimilarity(clean, naive)).toBeLessThan(0.95);

      // 6 % marginal på en bild som vuxit 12 % ⇒ inset 0,06/1,12 ≈ 0,0536.
      const corrected = toUnitVector(
        fingerprintFromRgb(padded.px, padded.w, padded.h, 3, 0.06 / 1.12)!
      );
      expect(cosineSimilarity(clean, corrected)).toBeGreaterThan(0.99);
    });

    it("svepet innehåller 0 först, så en tätt sittande ram inte straffas", () => {
      expect(FINGERPRINT_INSETS[0]).toBe(0);
      expect(FINGERPRINT_INSETS.length).toBeGreaterThan(1);
      // Alla inset måste vara meningsfulla andelar.
      for (const i of FINGERPRINT_INSETS) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(0.25);
      }
    });

    it("avvisar ett inset som äter upp bilden", () => {
      // 0,49 × 2 = 98 % bortskuret → för få pixlar kvar för rutnätet.
      expect(fingerprintFromRgb(makeImage(20, 28, 3), 20, 28, 3, 0.49)).toBeNull();
    });
  });

  it("avvisar orimliga indata i stället för att räkna på skräp", () => {
    expect(fingerprintFromRgb(new Uint8Array(0), 0, 0, 3)).toBeNull();
    // För få pixlar för de angivna måtten.
    expect(fingerprintFromRgb(new Uint8Array(10), 100, 100, 3)).toBeNull();
  });
});
