/**
 * KORT-KVADRATEN: detektering + varp måste (1) hitta ett kort med känd geometri,
 * (2) vägra gissa när det inte finns någon kvadrat, och (3) räkna IDENTISKT på
 * 3 kanaler (sharp/harness) och 4 kanaler (canvas/klient) — samma parvisa vakt
 * som art-fingerprint.test.ts, av samma skäl: harnesset MÄTER den kod klienten
 * shippar, och en tyst avvikelse gör mätningen till en lögn.
 */
import { describe, expect, it } from "vitest";
import {
  RECTIFIED_H,
  RECTIFIED_W,
  detectCardQuad,
  detectCardRegions,
  warpPerspective,
} from "@/lib/card-quad";

/** Ritar ett "kort" (ljus platta med mörk ram och lite inre struktur) på en
 *  mörk bakgrund, med hörnen på givna positioner (enkel bilinjär kvadrat). */
function renderQuad(
  w: number,
  h: number,
  channels: 3 | 4,
  corners: [number, number][]
): Uint8Array {
  const img = new Uint8Array(w * h * channels);
  // Mörk bakgrund med svag gradient (som ett skrivbord).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * channels;
      const bg = 18 + (x / w) * 10;
      img[p] = bg;
      img[p + 1] = bg + 2;
      img[p + 2] = bg + 4;
      if (channels === 4) img[p + 3] = 255;
    }
  }
  const [tl, tr, br, bl] = corners;
  // Skanna kvadratens inre via bilinjär interpolation i (u,v).
  const steps = Math.max(w, h) * 2;
  for (let vi = 0; vi <= steps; vi++) {
    const v = vi / steps;
    for (let ui = 0; ui <= steps; ui++) {
      const u = ui / steps;
      const x =
        (1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + u * v * br[0] + (1 - u) * v * bl[0];
      const y =
        (1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + u * v * br[1] + (1 - u) * v * bl[1];
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      const p = (yi * w + xi) * channels;
      const edge = u < 0.05 || u > 0.95 || v < 0.04 || v > 0.96;
      // Ram mörk, inre ljust med "konst" (varierande band) i mitten.
      const inner = 190 + 40 * Math.sin(u * 9) * Math.cos(v * 7);
      img[p] = edge ? 70 : inner;
      img[p + 1] = edge ? 60 : inner * 0.9;
      img[p + 2] = edge ? 50 : inner * 0.75;
      if (channels === 4) img[p + 3] = 255;
    }
  }
  return img;
}

/** Ett rakt kort: 240×335 i en 400×500-vy med 10 % marginal och lätt rotation. */
function straightCorners(rot = 0): [number, number][] {
  const cx = 200;
  const cy = 250;
  const hw = 120;
  const hh = 167;
  const r = (rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const pt = (dx: number, dy: number): [number, number] => [
    cx + dx * cos - dy * sin,
    cy + dx * sin + dy * cos,
  ];
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}

describe("detectCardQuad", () => {
  it("hittar ett rakt kort med hörn inom ~4 % av sanningen", () => {
    const truth = straightCorners(0);
    const img = renderQuad(400, 500, 4, truth);
    const quad = detectCardQuad(img, 400, 500, 4);
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(quad!.corners[i][0] - truth[i][0])).toBeLessThan(16);
      expect(Math.abs(quad!.corners[i][1] - truth[i][1])).toBeLessThan(20);
    }
  });

  it("hittar ett roterat kort (8°)", () => {
    const truth = straightCorners(8);
    const img = renderQuad(400, 500, 4, truth);
    const quad = detectCardQuad(img, 400, 500, 4);
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(quad!.corners[i][0] - truth[i][0])).toBeLessThan(20);
      expect(Math.abs(quad!.corners[i][1] - truth[i][1])).toBeLessThan(24);
    }
  });

  it("hittar ett perspektivskevt kort", () => {
    // Övre kanten smalare än nedre (kamera under kortets mitt).
    const truth: [number, number][] = [
      [110, 90],
      [290, 84],
      [320, 420],
      [82, 428],
    ];
    const img = renderQuad(400, 500, 4, truth);
    const quad = detectCardQuad(img, 400, 500, 4);
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(quad!.corners[i][0] - truth[i][0])).toBeLessThan(24);
      expect(Math.abs(quad!.corners[i][1] - truth[i][1])).toBeLessThan(28);
    }
  });

  it("vägrar gissa på en bild utan kvadrat (brusfält)", () => {
    const w = 400;
    const h = 500;
    const img = new Uint8Array(w * h * 4);
    // Deterministiskt "brus" utan raka kanter.
    for (let i = 0; i < w * h; i++) {
      const v = 60 + 50 * Math.sin(i * 0.37) * Math.cos(i * 0.11);
      img[i * 4] = v;
      img[i * 4 + 1] = v;
      img[i * 4 + 2] = v;
      img[i * 4 + 3] = 255;
    }
    expect(detectCardQuad(img, w, h, 4)).toBeNull();
  });

  it("vägrar en kvadrat med fel sidoförhållande (liggande låda)", () => {
    const truth: [number, number][] = [
      [40, 180],
      [360, 180],
      [360, 320],
      [40, 320],
    ];
    const img = renderQuad(400, 500, 4, truth);
    expect(detectCardQuad(img, 400, 500, 4)).toBeNull();
  });

  it("3 och 4 kanaler ger samma hörn (harness = klient)", () => {
    const truth = straightCorners(5);
    const img3 = renderQuad(400, 500, 3, truth);
    const img4 = renderQuad(400, 500, 4, truth);
    const q3 = detectCardQuad(img3, 400, 500, 3);
    const q4 = detectCardQuad(img4, 400, 500, 4);
    expect(q3).not.toBeNull();
    expect(q4).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(q3!.corners[i][0]).toBeCloseTo(q4!.corners[i][0], 6);
      expect(q3!.corners[i][1]).toBeCloseTo(q4!.corners[i][1], 6);
    }
  });
});

describe("detectCardRegions", () => {
  /** Bordsbild: mörkt bord med N ljusa "kort" på givna positioner. */
  function renderTable(
    w: number,
    h: number,
    cards: Array<{ x: number; y: number; cw: number; ch: number }>
  ): Uint8Array {
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        // Träbordet: mörkt med svag ådring (deterministisk variation).
        const grain = 8 * Math.sin(x * 0.15) * Math.cos(y * 0.05);
        img[p] = 55 + grain;
        img[p + 1] = 40 + grain;
        img[p + 2] = 28;
        img[p + 3] = 255;
      }
    }
    for (const c of cards) {
      for (let y = c.y; y < c.y + c.ch; y++) {
        for (let x = c.x; x < c.x + c.cw; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const p = (y * w + x) * 4;
          const u = (x - c.x) / c.cw;
          const v = (y - c.y) / c.ch;
          const edge = u < 0.06 || u > 0.94 || v < 0.05 || v > 0.95;
          img[p] = edge ? 200 : 160 + 50 * Math.sin(u * 7);
          img[p + 1] = edge ? 190 : 150 + 40 * Math.cos(v * 5);
          img[p + 2] = edge ? 120 : 90;
        }
      }
    }
    return img;
  }

  it("hittar fyra utspridda kort och inget mer", () => {
    const cards = [
      { x: 40, y: 50, cw: 130, ch: 180 },
      { x: 260, y: 40, cw: 130, ch: 180 },
      { x: 50, y: 300, cw: 130, ch: 180 },
      { x: 270, y: 310, cw: 130, ch: 180 },
    ];
    const img = renderTable(480, 560, cards);
    const regions = detectCardRegions(img, 480, 560, 4);
    expect(regions.length).toBe(4);
    // Varje sant kort ska ha EN region vars centrum ligger inne i kortet.
    for (const c of cards) {
      const hit = regions.find((r) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return cx > c.x && cx < c.x + c.cw && cy > c.y && cy < c.y + c.ch;
      });
      expect(hit).toBeDefined();
    }
  });

  it("hittar ett roterat kort (bbox-form är generös)", () => {
    // Grovt "roterat" kort: parallellogram-aktig placering via två överlappande
    // rektanglar — bbox blir bredare än 63:88 men inom spannet.
    const img = renderTable(480, 560, [{ x: 120, y: 150, cw: 200, ch: 160 }]);
    const regions = detectCardRegions(img, 480, 560, 4);
    expect(regions.length).toBe(1);
  });

  it("tomt bord → inga regioner", () => {
    const img = renderTable(480, 560, []);
    expect(detectCardRegions(img, 480, 560, 4).length).toBe(0);
  });

  it("FRÅN HÅLL: sex små kort hittas allihop (ägarens buggfall 2026-08-01)", () => {
    // Varje kort ~1,6 % av bilden — under det gamla areagolvet (0,4 % gick,
    // men verkliga foton hade ännu mindre kort + lägre kontrast). Sex kort i
    // 3×2 med mellanrum ska ge exakt sex regioner.
    const cards = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        cards.push({ x: 40 + c * 150, y: 80 + r * 220, cw: 62, ch: 87 });
      }
    }
    const img = renderTable(480, 560, cards);
    const regions = detectCardRegions(img, 480, 560, 4, 12);
    expect(regions.length).toBe(6);
    for (const c of cards) {
      const hit = regions.find((r) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return cx > c.x && cx < c.x + c.cw && cy > c.y && cy < c.y + c.ch;
      });
      expect(hit).toBeDefined();
    }
  });

  it("STORLEKSSAMSTÄMMIGHET: ett kortformat FÖREMÅL som är för stort förkastas", () => {
    // Formvillkoren är med flit generösa (snedlagt kort ⇒ bred bbox) och
    // släppte därför igenom fotografens kropp i ägarens riktiga fångst
    // 2026-07-31: 28 % av bilden, bbox-form 1,55, fyllnadsgrad hög — den
    // passerade varenda villkor. Men alla Pokémon-kort är FYSISKT lika stora,
    // så en blob 3x kortarean är per definition inte ett kort bland korten.
    const cards = [
      { x: 30, y: 40, cw: 90, ch: 126 },
      { x: 150, y: 40, cw: 90, ch: 126 },
      { x: 30, y: 200, cw: 90, ch: 126 },
      { x: 150, y: 200, cw: 90, ch: 126 },
    ];
    // Kortformad (0,8) och innanför areataket (26 %), men 3,2x kortarean.
    const bulk = { x: 280, y: 130, cw: 180, ch: 225 };
    const img = renderTable(480, 560, [...cards, bulk]);
    const regions = detectCardRegions(img, 480, 560, 4, 12);

    expect(regions.length).toBe(4);
    for (const c of cards) {
      const hit = regions.find((r) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return cx > c.x && cx < c.x + c.cw && cy > c.y && cy < c.y + c.ch;
      });
      expect(hit).toBeDefined();
    }
  });

  it("OJÄMNT LJUS: fönsterljus-ramp över bordet fäller inte korten i skuggdelen", () => {
    // Bordet går 45 → 150 i ljusstyrka vänster→höger (fönsterljus). Kort i den
    // MÖRKA delen ligger nära bildens GLOBALA medianfärg — en global bakgrund
    // missar dem; per-tile-bakgrunden ska hitta alla fyra.
    const w = 480;
    const h = 560;
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const base = 45 + (x / w) * 105;
        img[p] = base;
        img[p + 1] = base * 0.8;
        img[p + 2] = base * 0.6;
        img[p + 3] = 255;
      }
    }
    const cards = [
      { x: 30, y: 60, cw: 110, ch: 154 },
      { x: 30, y: 330, cw: 110, ch: 154 },
      { x: 320, y: 60, cw: 110, ch: 154 },
      { x: 320, y: 330, cw: 110, ch: 154 },
    ];
    for (const c of cards) {
      for (let y = c.y; y < c.y + c.ch; y++) {
        for (let x = c.x; x < c.x + c.cw; x++) {
          const p = (y * w + x) * 4;
          // Kortet är ljust men LOKALT: i mörka delen ~95, dvs nära den globala
          // bordsmedianen (~97) — bara en lokal bakgrund skiljer dem åt.
          const local = 45 + (x / w) * 105;
          img[p] = local + 50;
          img[p + 1] = local + 45;
          img[p + 2] = local + 55;
        }
      }
    }
    const regions = detectCardRegions(img, w, h, 4, 8);
    expect(regions.length).toBe(4);
  });

  it("LÅG KONTRAST: kort nära bordets färg hittas ändå (Otsu, inte fast golv)", () => {
    // Kort bara ~35 RGB-enheter från bordet — under gamla fasta golvet (~37).
    const w = 480;
    const h = 560;
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        img[p] = 120;
        img[p + 1] = 110;
        img[p + 2] = 100;
        img[p + 3] = 255;
      }
    }
    for (const c of [
      { x: 60, y: 80, cw: 120, ch: 168 },
      { x: 280, y: 300, cw: 120, ch: 168 },
    ]) {
      for (let y = c.y; y < c.y + c.ch; y++) {
        for (let x = c.x; x < c.x + c.cw; x++) {
          const p = (y * w + x) * 4;
          img[p] = 140;
          img[p + 1] = 130;
          img[p + 2] = 125;
        }
      }
    }
    expect(detectCardRegions(img, w, h, 4, 4).length).toBe(2);
  });

  it("bordet självt (jätteblob) förkastas via areataket", () => {
    // Ett "kort" som täcker nästan hela bilden = pärmsidefallet/felsegmentering.
    const img = renderTable(480, 560, [{ x: 10, y: 10, cw: 460, ch: 540 }]);
    expect(detectCardRegions(img, 480, 560, 4).length).toBe(0);
  });
});

describe("warpPerspective", () => {
  it("rätar upp ett skevt kort till kortets kanoniska geometri", () => {
    const truth: [number, number][] = [
      [110, 90],
      [290, 84],
      [320, 420],
      [82, 428],
    ];
    const img = renderQuad(400, 500, 4, truth);
    const warped = warpPerspective(img, 400, 500, 4, truth);
    expect(warped).not.toBeNull();
    expect(warped!.length).toBe(RECTIFIED_W * RECTIFIED_H * 4);
    // Mitten av varpen ska vara kortets ljusa inre, hörnzonerna ramens mörka.
    const at = (x: number, y: number) => warped![(y * RECTIFIED_W + x) * 4];
    const mid = at(RECTIFIED_W >> 1, RECTIFIED_H >> 1);
    expect(mid).toBeGreaterThan(120);
    // Ramen (2 % in från varpens kant ligger inom kortets 4–5 %-ram).
    const edge = at(Math.round(RECTIFIED_W * 0.02), RECTIFIED_H >> 1);
    expect(edge).toBeLessThan(110);
  });

  it("3 och 4 kanaler varpar identiskt", () => {
    const truth = straightCorners(3);
    const img3 = renderQuad(300, 400, 3, truth);
    const img4 = renderQuad(300, 400, 4, truth);
    const w3 = warpPerspective(img3, 300, 400, 3, truth);
    const w4 = warpPerspective(img4, 300, 400, 4, truth);
    expect(w3).not.toBeNull();
    expect(w4).not.toBeNull();
    expect(Buffer.from(w3!).equals(Buffer.from(w4!))).toBe(true);
  });

  it("vägrar degenererade hörn", () => {
    const img = renderQuad(300, 400, 4, straightCorners(0));
    const line: [number, number][] = [
      [10, 10],
      [200, 10],
      [200, 10],
      [10, 10],
    ];
    expect(warpPerspective(img, 300, 400, 4, line)).toBeNull();
  });
});
