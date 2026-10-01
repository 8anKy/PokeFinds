import { describe, expect, it } from "vitest";
import {
  axisRatio,
  clampLine,
  combinedPsaCap,
  defaultLines,
  formatRatio,
  guessLines,
  isEReaderSet,
  measureCentering,
  psaCapFor,
  type CenteringLines,
} from "@/lib/centering";

const lines = (o: Partial<CenteringLines>): CenteringLines => ({ ...defaultLines(), ...o });

describe("centrering", () => {
  it("räknar andelar per axel och skriver bredaste sidan först", () => {
    const r = axisRatio(6, 4)!;
    expect(r.a).toBeCloseTo(60);
    expect(formatRatio(r)).toBe("60/40");
    expect(formatRatio(axisRatio(4, 6)!)).toBe("60/40");
    expect(axisRatio(0, 0)).toBeNull();
  });

  it("följer PSA:s publicerade gränser, fram och bak", () => {
    expect(psaCapFor(55, "front")).toBe(10);
    expect(psaCapFor(55.4, "front")).toBe(10); // halv procentenhet tolerans
    expect(psaCapFor(56, "front")).toBe(9);
    expect(psaCapFor(60, "front")).toBe(9);
    expect(psaCapFor(65, "front")).toBe(8);
    expect(psaCapFor(70, "front")).toBe(7);
    expect(psaCapFor(80, "front")).toBe(6);
    expect(psaCapFor(75, "back")).toBe(10);
    expect(psaCapFor(80, "back")).toBe(9);
    expect(psaCapFor(95, "back")).toBe(1);
  });

  it("dömer båda axlarna var för sig — den sämsta styr", () => {
    // V/H 50/50 men Ö/N 60/40 ⇒ inte en 10.
    const l = lines({
      outerLeft: 0, innerLeft: 0.05, innerRight: 0.95, outerRight: 1,
      outerTop: 0, innerTop: 0.06, innerBottom: 0.96, outerBottom: 1,
    });
    const r = measureCentering(l, 1000, 1000, "front", "standard");
    expect(formatRatio(r.leftRight!)).toBe("50/50");
    expect(formatRatio(r.topBottom!)).toBe("60/40");
    expect(r.psaCap).toBe(9);
  });

  it("e-Reader-framsidan jämför ÖVRE mot HÖGRA kanten i pixlar, aldrig vänster/nedre", () => {
    // Bred vänster- och nederkant (punktkoden) får inte påverka.
    const l = lines({
      outerLeft: 0, innerLeft: 0.2, innerRight: 0.95, outerRight: 1,
      outerTop: 0, innerTop: 0.04, innerBottom: 0.8, outerBottom: 1,
    });
    // Bild 700×1000: höger = 0,05 × 700 = 35 px, övre = 0,04 × 1000 = 40 px.
    const r = measureCentering(l, 700, 1000, "front", "ereader");
    expect(r.leftRight).toBeNull();
    expect(r.topBottom).toBeNull();
    expect(formatRatio(r.topRight!)).toBe("53/47");
    expect(r.psaCap).toBe(10);
    // Baksidan på ett e-Reader-kort mäts som vanligt.
    const back = measureCentering(l, 700, 1000, "back", "ereader");
    expect(back.mode).toBe("standard");
    expect(back.leftRight).not.toBeNull();
  });

  it("taket för hela kortet är det strängaste av fram och bak", () => {
    expect(combinedPsaCap([{ psaCap: 10 } as never, { psaCap: 9 } as never])).toBe(9);
    expect(combinedPsaCap([null, undefined])).toBeNull();
  });

  it("känner igen e-Reader-seten på namnet", () => {
    expect(isEReaderSet("Expedition Base Set")).toBe(true);
    expect(isEReaderSet("Aquapolis")).toBe(true);
    expect(isEReaderSet("Skyridge")).toBe(true);
    expect(isEReaderSet("Base Set")).toBe(false);
    expect(isEReaderSet(null)).toBe(false);
  });

  it("linjerna kan aldrig korsa varandra", () => {
    const l = defaultLines();
    expect(clampLine(l, "innerLeft", 0.01)).toBeGreaterThan(l.outerLeft);
    expect(clampLine(l, "outerLeft", 0.5)).toBeLessThan(l.innerLeft);
    expect(clampLine(l, "outerBottom", 2)).toBe(1);
  });

  it("startgissningen hittar ytter- och innerkant på ett syntetiskt kort", () => {
    const w = 300;
    const h = 420;
    const g = new Float32Array(w * h);
    // Bakgrund 20, kort 220 (x 30..270, y 30..390), ram 140 inuti (x 45..255, y 48..372).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 20;
        if (x >= 30 && x < 270 && y >= 30 && y < 390) v = 220;
        if (x >= 45 && x < 255 && y >= 48 && y < 372) v = 140;
        g[y * w + x] = v;
      }
    }
    const l = guessLines(g, w, h);
    expect(l.outerLeft * w).toBeCloseTo(30, -1);
    expect(l.innerLeft * w).toBeCloseTo(45, -1);
    expect(l.outerRight * w).toBeCloseTo(270, -1);
    expect(l.innerTop * h).toBeCloseTo(48, -1);
    expect(l.outerBottom * h).toBeCloseTo(390, -1);
  });
});
