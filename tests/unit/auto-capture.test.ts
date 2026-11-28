/**
 * Auto-fångstens avtryckare (lib/auto-capture.ts): stilla + skarpt + ny scen ⇒ slutaren går.
 * Förut krävdes att live-pollen var "säker" — mätt 2026-11-28 på 13 % av riktiga rutor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTO_MAX_PENDING,
  AUTO_MISS_BACKOFF_MS,
  AUTO_REARM_MAX,
  AUTO_STILL_FRAMES,
  AUTO_STILL_MIN,
  autoCaptureFired,
  autoCapturePaused,
  autoCaptureResult,
  autoCaptureStep,
  frameCorrelation,
  newAutoCaptureState,
} from "@/lib/auto-capture";

/** Deterministiskt "kort": 264 int8 ur ett frö. */
function card(seed: number): Int8Array {
  const out = new Int8Array(264);
  let x = seed * 2654435761;
  for (let i = 0; i < out.length; i++) {
    x = (Math.imul(x ^ (x >>> 15), 2246822519) + 374761393) | 0;
    out[i] = ((x >>> 8) % 201) - 100;
  }
  return out;
}
/** Samma kort med lite brus (en stadig hand). */
function jitter(fp: Int8Array, amount: number, seed: number): Int8Array {
  const noise = card(seed + 1000);
  return fp.map((v, i) => Math.max(-127, Math.min(127, Math.round(v + (noise[i] * amount) / 100))));
}
const frame = (fp: Int8Array | null, over: Partial<{ blurry: boolean; pending: number; now: number }> = {}) => ({
  fp,
  blurry: false,
  pending: 0,
  now: 0,
  ...over,
});
/** Matar samma kort tills slutaren går; returnerar antal rutor det tog (0 = gick aldrig). */
function feedUntilFire(state: ReturnType<typeof newAutoCaptureState>, fp: Int8Array, max = 10, over = {}): number {
  for (let i = 1; i <= max; i++) {
    if (autoCaptureStep(state, frame(jitter(fp, 5, i), over)).fire) return i;
  }
  return 0;
}

describe("frameCorrelation", () => {
  it("samma ruta = 1, olika kort nära 0, svart ruta aldrig 'lik'", () => {
    const a = card(1);
    expect(frameCorrelation(a, a)).toBeCloseTo(1, 6);
    expect(Math.abs(frameCorrelation(a, card(2)))).toBeLessThan(0.3);
    const black = new Int8Array(264);
    expect(frameCorrelation(black, black)).toBe(0);
    expect(frameCorrelation(a, black)).toBe(0);
  });

  it("lätt brus ligger över stillhetströskeln", () => {
    const a = card(3);
    expect(frameCorrelation(a, jitter(a, 5, 1))).toBeGreaterThan(AUTO_STILL_MIN);
  });
});

describe("autoCaptureStep", () => {
  it("går efter AUTO_STILL_FRAMES stilla rutor — inte tidigare", () => {
    const s = newAutoCaptureState();
    expect(feedUntilFire(s, card(1))).toBe(AUTO_STILL_FRAMES);
  });

  it("går inte medan rutan rör sig (olika innehåll varje ruta)", () => {
    const s = newAutoCaptureState();
    for (let i = 0; i < 12; i++) {
      expect(autoCaptureStep(s, frame(card(100 + i))).fire).toBe(false);
    }
  });

  it("samma scen fångas inte två gånger", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    expect(feedUntilFire(s, a)).toBeGreaterThan(0);
    autoCaptureFired(s, a);
    expect(feedUntilFire(s, a, 20)).toBe(0);
  });

  it("nytt kort efter en fångst går av sig självt", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    feedUntilFire(s, a);
    autoCaptureFired(s, a);
    expect(feedUntilFire(s, card(2))).toBe(AUTO_STILL_FRAMES);
  });

  it("två LIKA kort i rad: en enda avvikande ruta mellan dem laddar om", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    feedUntilFire(s, a);
    autoCaptureFired(s, a);
    // Bytet: en ruta mitt i rörelsen (annat innehåll), sedan ett likadant kort.
    expect(autoCaptureStep(s, frame(card(77))).fire).toBe(false);
    expect(feedUntilFire(s, a)).toBe(AUTO_STILL_FRAMES);
  });

  it("ett MANUELLT tryck spärrar scenen för auto-fångsten", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    autoCaptureStep(s, frame(a));
    autoCaptureFired(s, a); // slutarknappen
    expect(feedUntilFire(s, a, 20)).toBe(0);
  });

  it("suddig ruta och full kö håller inne — utan att tappa stillheten", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    expect(feedUntilFire(s, a, 6, { blurry: true })).toBe(0);
    expect(autoCaptureStep(s, frame(a)).fire).toBe(true);

    const s2 = newAutoCaptureState();
    expect(feedUntilFire(s2, a, 6, { pending: AUTO_MAX_PENDING })).toBe(0);
    expect(autoCaptureStep(s2, frame(a, { pending: AUTO_MAX_PENDING - 1 })).fire).toBe(true);
  });

  it("en ruta utan avtryck nollar stillheten", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    autoCaptureStep(s, frame(a));
    autoCaptureStep(s, frame(a));
    autoCaptureStep(s, frame(null));
    expect(autoCaptureStep(s, frame(a)).fire).toBe(false);
  });

  it("paus (ark över kameran) glömmer rörelsen men MINNS det fångade kortet", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    feedUntilFire(s, a);
    autoCaptureFired(s, a);
    autoCapturePaused(s);
    expect(feedUntilFire(s, a, 20)).toBe(0);
  });

  it("rapporterar lägsta likheten i den stilla raden (mätdata)", () => {
    const s = newAutoCaptureState();
    const a = card(1);
    let last = { fire: false, stillMin: 1 };
    for (let i = 1; i <= AUTO_STILL_FRAMES; i++) last = autoCaptureStep(s, frame(jitter(a, 8, i)));
    expect(last.fire).toBe(true);
    expect(last.stillMin).toBeGreaterThanOrEqual(AUTO_STILL_MIN);
    expect(last.stillMin).toBeLessThan(1);
  });
});

describe("autoCaptureResult — bromsen när vyn saknar kort", () => {
  it("första auto-missen är gratis, sedan växande paus; en träff nollar", () => {
    const s = newAutoCaptureState();
    autoCaptureResult(s, { auto: true, hit: false, now: 1000 });
    expect(s.pausedUntil).toBe(0);
    autoCaptureResult(s, { auto: true, hit: false, now: 2000 });
    expect(s.pausedUntil).toBe(2000 + AUTO_MISS_BACKOFF_MS[2]);
    for (let i = 0; i < 10; i++) autoCaptureResult(s, { auto: true, hit: false, now: 3000 });
    expect(s.pausedUntil).toBe(3000 + AUTO_MISS_BACKOFF_MS[AUTO_MISS_BACKOFF_MS.length - 1]);
    autoCaptureResult(s, { auto: false, hit: true, now: 4000 });
    expect(s.misses).toBe(0);
    expect(s.pausedUntil).toBe(0);
  });

  it("en MANUELL miss bromsar inte automatiken", () => {
    const s = newAutoCaptureState();
    for (let i = 0; i < 5; i++) autoCaptureResult(s, { auto: false, hit: false, now: 1000 });
    expect(s.misses).toBe(0);
  });

  it("pausen håller inne slutaren tills den gått ut", () => {
    const s = newAutoCaptureState();
    autoCaptureResult(s, { auto: true, hit: false, now: 0 });
    autoCaptureResult(s, { auto: true, hit: false, now: 0 });
    const a = card(1);
    expect(feedUntilFire(s, a, 6, { now: 100 })).toBe(0);
    expect(autoCaptureStep(s, frame(a, { now: AUTO_MISS_BACKOFF_MS[2] + 1 })).fire).toBe(true);
  });
});

describe("trösklarna hänger ihop", () => {
  it("omladdningströskeln ligger under stillhetströskeln (en stadig hand laddar inte om)", () => {
    expect(AUTO_REARM_MAX).toBeLessThan(AUTO_STILL_MIN);
  });

  it("slutarknappen skickar aldrig klickhändelsen som auto-markör", () => {
    const page = readFileSync("src/app/[locale]/(scan)/skanna/page.tsx", "utf8");
    expect(page).not.toMatch(/onCapture=\{[^}]*:\s*capture\}/);
    expect(page).toContain("onCapture={bulkMode ? captureBulk : manualCapture}");
  });
});
