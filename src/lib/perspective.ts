/**
 * PERSPEKTIVKORRIGERING (2026-10-01) — ren matematik, testad.
 *
 * Ett foto av ett kort är nästan aldrig rakt: kortet lutar och telefonen står
 * snett, så kortets kanter blir ett snett fyrhörn i bilden. Linjära stödlinjer
 * kan då aldrig ligga på kanterna (ägarens fältrapport). Lösningen är den
 * dokumentskannrar använder: användaren lägger fyra hörn, och bilden räknas om
 * (homografi) så att kortet blir en exakt rektangel med kortets proportioner.
 *
 * Används också för delningsbildens 3D-slab: en platt slab-yta "lutas" in i
 * bilden med samma avbildning.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Ett Pokémonkort är 63 × 88 mm. */
export const CARD_ASPECT = 63 / 88;

/**
 * Homografin H (3×3, radvis, h[8] = 1) som avbildar `src[i]` på `dst[i]`.
 * Löser det vanliga 8×8-systemet med gausselimination. null = degenererat
 * fyrhörn (tre punkter på en linje).
 */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyH(h: number[], p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Bakåtavbildning: för varje utpixel slås källpunkten upp med `dstToSrc` och
 * samplas bilinjärt. Utanför källan blir pixeln genomskinlig (alfa 0), så att
 * den varpade bilden kan läggas ovanpå en bakgrund.
 */
export function warpPerspective(src: RgbaImage, dstToSrc: number[], outW: number, outH: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { data, width: sw, height: sh } = src;
  const [a, b, c, d, e, f, g, hh, i] = dstToSrc;
  for (let y = 0; y < outH; y++) {
    const py = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5;
      const w = g * px + hh * py + i;
      const sx = (a * px + b * py + c) / w - 0.5;
      const sy = (d * px + e * py + f) / w - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      const o = (y * outW + x) * 4;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 4; k++) {
        const top = data[i00 + k] + (data[i10 + k] - data[i00 + k]) * fx;
        const bot = data[i01 + k] + (data[i11 + k] - data[i01 + k]) * fx;
        out[o + k] = top + (bot - top) * fy;
      }
    }
  }
  return out;
}

/** Hörnen ordnade medsols från övre vänster: ÖV, ÖH, NH, NV. */
export type Quad = [Pt, Pt, Pt, Pt];

/**
 * Var kortet hamnar i den raka bilden: en rektangel med kortets proportioner och
 * en marginal runt om, så att ytterkanten syns och går att finjustera.
 */
export function straightLayout(cardWidth: number, marginFrac = 0.07) {
  const cardW = Math.round(cardWidth);
  const cardH = Math.round(cardWidth / CARD_ASPECT);
  const m = Math.round(cardW * marginFrac);
  return {
    width: cardW + 2 * m,
    height: cardH + 2 * m,
    rect: { x: m, y: m, w: cardW, h: cardH },
  };
}

/** Fyrhörnets bredd ≈ medel av över- och underkant (för upplösningen ut). */
export function quadWidth(q: Quad): number {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(q[0], q[1]) + d(q[3], q[2])) / 2;
}

/**
 * En rektangel (w × h, centrerad i origo) lutad i 3D och projicerad med en
 * pinhålskamera — slabbens framsida (z = 0) och baksida (z = depth).
 * rx/ry i grader: positiv ry vrider högerkanten bort från betraktaren.
 */
export function projectBox(
  w: number,
  h: number,
  depth: number,
  rxDeg: number,
  ryDeg: number,
  focal: number,
  center: Pt
): { front: Quad; back: Quad } {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const project = (x: number, y: number, z: number): Pt => {
    // Rotera runt y, sedan runt x.
    const x1 = x * Math.cos(ry) - z * Math.sin(ry);
    const z1 = x * Math.sin(ry) + z * Math.cos(ry);
    const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
    const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
    const s = focal / (focal + z2);
    return { x: center.x + x1 * s, y: center.y + y2 * s };
  };
  const front = corners.map(([x, y]) => project(x, y, 0)) as Quad;
  const back = corners.map(([x, y]) => project(x, y, depth)) as Quad;
  return { front, back };
}

/** Konvext hölje (Andrew's monotone chain) — slabbens silhuett fram + bak. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Samma kamera som `projectBox`, för godtyckliga 3D-punkter (rundade hörn m.m.). */
export function makeProjector(rxDeg: number, ryDeg: number, focal: number, center: Pt) {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  return (x: number, y: number, z: number): Pt => {
    const x1 = x * Math.cos(ry) - z * Math.sin(ry);
    const z1 = x * Math.sin(ry) + z * Math.cos(ry);
    const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
    const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
    const s = focal / (focal + z2);
    return { x: center.x + x1 * s, y: center.y + y2 * s };
  };
}

/** Ytterlinjernas rektangel på den raka bilden → kortets hörn i originalfotot (andelar). */
export function cardQuadInPhoto(
  l: { outerLeft: number; outerRight: number; outerTop: number; outerBottom: number },
  straight: { w: number; h: number },
  base: { w: number; h: number },
  dstToSrc: number[]
): Quad {
  const pts: Pt[] = [
    { x: l.outerLeft, y: l.outerTop },
    { x: l.outerRight, y: l.outerTop },
    { x: l.outerRight, y: l.outerBottom },
    { x: l.outerLeft, y: l.outerBottom },
  ];
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return pts.map((p) => {
    const q = applyH(dstToSrc, { x: p.x * straight.w, y: p.y * straight.h });
    return { x: r(q.x / base.w), y: r(q.y / base.h) };
  }) as Quad;
}
