/**
 * SLABBEN SNURRAR (ägarens önskan 2026-10-01) — samma ritning driver den levande
 * förhandsvisningen i delningsarket OCH videon som delas (MP4, 1080 × 1920).
 *
 * VARFÖR INTE three.js: slabben är två platta sidor och en tjocklek som vrids runt
 * EN lodrät axel. Då har varje lodrät pixelkolumn ett och samma djup, så rätt
 * perspektiv blir exakt en skalning per kolumn — texturen ritas i smala lodräta
 * remsor med `drawImage` (GPU:n gör jobbet). ~100 remsor per bild räcker för
 * 60 fps på en telefon, ingen 3D-motor (~150 kB) behövs, och videon och
 * förhandsvisningen ser garanterat likadana ut.
 *
 * Rörelsen: en hel varv (fram → bak → fram) med mjuk start och stopp och en kort
 * paus med framsidan mot betraktaren. Slutet är exakt början, så videon LOOPAR
 * sömlöst (stories spelar upp i loop).
 *
 * ⛔ KOSTAR INGENTING I DRIFT: allt ritas och kodas på telefonen (WebCodecs via
 *    `mediabunny`, laddas bara när någon väljer Video). Ingen server, ingen DB.
 */
import type { GradeSpinLayers } from "@/lib/share-card";
import { convexHull } from "@/lib/perspective";
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from "@/lib/share-card";

export const SPIN_DURATION_SEC = 4;
/** Paus med framsidan mot betraktaren i början av varje varv. */
export const SPIN_HOLD_SEC = 0.7;
export const SPIN_FPS = 30;

/** Slabbens storlek i videon — lite mindre än stillbilden, så den närmaste kanten
 *  aldrig når delpoängen under (perspektivet förstorar den med ~12 %). */
const SPIN_SCALE = 0.84;
const FOCAL = 3000;
const STRIPS = 96;

/** Vinkeln (grader) vid tiden t i ett varv. Ren funktion — testad. */
export function spinAngleAt(tSec: number, duration = SPIN_DURATION_SEC, hold = SPIN_HOLD_SEC): number {
  const t = ((tSec % duration) + duration) % duration;
  if (t <= hold) return 0;
  const x = (t - hold) / (duration - hold);
  return 180 * (1 - Math.cos(Math.PI * x)); // 0 → 360, mjukt i båda ändar
}

export interface FaceStrip {
  /** Skärmkolumner (bildens enheter). Inre gränser är HELA pixlar. */
  x0: number;
  x1: number;
  /** Texturkolumner som EXAKT hör till x0..x1 (perspektivet inverterat). */
  t0: number;
  t1: number;
  /** Perspektivskalan mitt i remsan (höjden). */
  s: number;
}

/**
 * Dela den synliga sidan i lodräta remsor. Ren funktion — testad.
 *
 * SKÄRPAN (ägarens fältrapport 2026-10-02: "videon ser ut som 720p"): remsorna var
 * förut lika breda i TEXTUREN (760 / 96 ≈ 7,9 px) och kanterna avrundades sedan på
 * skärmen — varannan remsa blev 6 px, varannan 7, så texturen trycktes ihop omväxlande
 * 24 % och 12 % med en halv pixels hopp i varje skarv. På etikettens text såg det ut
 * som en uppskalad lågupplöst bild. Nu väljs gränserna på HELA skärmpixlar och
 * texturkolumnen räknas BAKLÄNGES ur perspektivet, så varje remsa har exakt rätt
 * skala. Rakt framifrån (pausen, där ögat stannar) är perspektivet affint och sidan
 * ritas i ETT drag.
 */
export function faceStrips(p: {
  cx: number;
  sin: number;
  cos: number;
  /** Sidans djup (w) i projektionen. */
  depthW: number;
  halfW: number;
  texW: number;
  /** Framsidan (annars baksidan, spegelvänd). */
  front: boolean;
  /** Skärm-x för texturens kolumn 0 resp. texW. */
  xA: number;
  xB: number;
}): FaceStrip[] {
  const { cx, sin, cos, depthW: w, halfW, texW } = p;
  const sAtU = (u: number) => FOCAL / (FOCAL - u * sin + w * cos);
  const uOfT = (t: number) => (p.front ? -halfW + (t / texW) * 2 * halfW : halfW - (t / texW) * 2 * halfW);
  const tAtX = (x: number) => {
    const dx = x - cx;
    const u = (dx * (FOCAL + w * cos) - FOCAL * w * sin) / (FOCAL * cos + dx * sin);
    const t = p.front ? ((u + halfW) / (2 * halfW)) * texW : ((halfW - u) / (2 * halfW)) * texW;
    return Math.min(texW, Math.max(0, t));
  };
  const lo = Math.min(p.xA, p.xB);
  const hi = Math.max(p.xA, p.xB);
  const tLo = p.xA <= p.xB ? 0 : texW;
  const tHi = texW - tLo;

  if (Math.abs(sin) < 1e-6) {
    return [{ x0: lo, x1: hi, t0: Math.min(tLo, tHi), t1: Math.max(tLo, tHi), s: sAtU(uOfT(texW / 2)) }];
  }

  const px = Math.max(1, Math.ceil((hi - lo) / STRIPS));
  const xs = [lo];
  for (let x = Math.floor(lo) + px; x < hi; x += px) xs.push(x);
  xs.push(hi);
  const ts = xs.map((x, i) => (i === 0 ? tLo : i === xs.length - 1 ? tHi : tAtX(x)));
  const strips: FaceStrip[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const t0 = Math.min(ts[i], ts[i + 1]);
    const t1 = Math.max(ts[i], ts[i + 1]);
    if (xs[i + 1] - xs[i] <= 0 || t1 - t0 <= 0) continue;
    strips.push({ x0: xs[i], x1: xs[i + 1], t0, t1, s: sAtU(uOfT((t0 + t1) / 2)) });
  }
  return strips;
}

/** Ett återanvänt lager för sidans remsor (en per process — ritningen är synkron). */
let faceCanvas: HTMLCanvasElement | null = null;
function faceLayer(w: number, h: number): HTMLCanvasElement {
  faceCanvas ??= document.createElement("canvas");
  if (faceCanvas.width < w) faceCanvas.width = w;
  if (faceCanvas.height < h) faceCanvas.height = h;
  return faceCanvas;
}

interface P {
  x: number;
  y: number;
}

function roundedOutline(w: number, h: number, r: number, perCorner = 6): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = [];
  const corners = [
    { cx: w / 2 - r, cy: -h / 2 + r, a0: -Math.PI / 2 },
    { cx: w / 2 - r, cy: h / 2 - r, a0: 0 },
    { cx: -w / 2 + r, cy: h / 2 - r, a0: Math.PI / 2 },
    { cx: -w / 2 + r, cy: -h / 2 + r, a0: Math.PI },
  ];
  for (const c of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = c.a0 + (i / perCorner) * (Math.PI / 2);
      pts.push({ u: c.cx + r * Math.cos(a), v: c.cy + r * Math.sin(a) });
    }
  }
  return pts;
}

function path(ctx: CanvasRenderingContext2D, pts: P[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * Rita en bild: bakgrunden och slabben vriden `angleDeg` grader runt sin lodräta axel.
 * `ctx` är 1080 × 1920 i sina egna enheter (skala ned med ctx.scale för förhandsvisningen).
 */
export function drawSpinFrame(ctx: CanvasRenderingContext2D, layers: GradeSpinLayers, angleDeg: number) {
  ctx.drawImage(layers.background, 0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const tex = layers.front;
  const W = tex.width;
  const H = tex.height;
  const k = SPIN_SCALE;
  const half = { w: (W / 2) * k, h: (H / 2) * k, d: (layers.depth / 2) * k };
  const { x: cx, y: cy } = layers.center;
  const th = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const project = (u: number, v: number, w: number): P & { s: number; z: number } => {
    const X = u * cos + w * sin;
    const Z = -u * sin + w * cos;
    const s = FOCAL / (FOCAL + Z);
    return { x: cx + X * s, y: cy + v * s, s, z: Z };
  };

  // Skugga mot golvet: lika bred som slabbens projektion just nu.
  const span = Math.abs(project(half.w, 0, -half.d).x - project(-half.w, 0, -half.d).x);
  const floorY = cy + half.h * 1.06;
  ctx.save();
  ctx.translate(cx, floorY);
  ctx.scale(1, 0.1);
  const rad = Math.max(60, span * 0.62);
  const shadow = ctx.createRadialGradient(0, 0, 10, 0, 0, rad);
  shadow.addColorStop(0, "rgba(0,0,0,0.7)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // TJOCKLEKEN SOM ETT STYCKE (ägarens fältrapport 2026-10-01: "ramen glider fram
  // och tillbaka i stället för att vara en hel slab"). Två tunna kantpaneler lästes
  // som att framsidans ram flyttade sig. Nu: konturen av fram- OCH baksidan fylls
  // som en enda kropp av plast — samma grepp som stillbilden — och den bortre sidans
  // kontur syns svagt genom plasten. Sidan som vänder sig mot oss ritas sist, ovanpå.
  const outlineUV = roundedOutline(half.w * 2, half.h * 2, layers.radius * k);
  const frontRing = outlineUV.map((p) => project(p.u, p.v, -half.d));
  const backRing = outlineUV.map((p) => project(p.u, p.v, half.d));
  const hull = convexHull([...frontRing, ...backRing]);
  ctx.save();
  path(ctx, hull);
  const hxs = hull.map((p) => p.x);
  const body = ctx.createLinearGradient(Math.min(...hxs), 0, Math.max(...hxs), 0);
  body.addColorStop(0, "rgba(190,215,222,0.26)");
  body.addColorStop(1, "rgba(120,150,160,0.40)");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Vilken sida vänder sig mot oss? Framsidans projektion avgör (perspektivrätt).
  const frontVisible = project(half.w, 0, -half.d).x > project(-half.w, 0, -half.d).x;
  const faceW = frontVisible ? -half.d : half.d;
  const face = frontVisible ? layers.front : layers.back;
  // Baksidan spegelvänds så att den läses rätt bakifrån.
  const uAt = (t: number) => (frontVisible ? -half.w + (t / W) * 2 * half.w : half.w - (t / W) * 2 * half.w);

  const outline = frontVisible ? frontRing : backRing;
  // Den bortre sidans kontur, svagt genom plasten — ger djup.
  ctx.save();
  path(ctx, frontVisible ? backRing : frontRing);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  const xA = project(uAt(0), 0, faceW).x;
  const xB = project(uAt(W), 0, faceW).x;
  if (Math.abs(xB - xA) > 1.5) {
    // Remsorna ritas i ett EGET lager kant mot kant — varken glapp eller överlapp —
    // och lagret läggs sedan på bilden. Med överlapp ritades den genomskinliga
    // plasten två gånger i varje skarv: lodräta streck över ytan.
    const strips = faceStrips({ cx, sin, cos, depthW: faceW, halfW: half.w, texW: W, front: frontVisible, xA, xB });
    const ss = strips.map((s) => s.s);
    const left = Math.floor(Math.min(xA, xB));
    const right = Math.ceil(Math.max(xA, xB));
    const maxH = H * k * Math.max(...ss);
    const top = Math.floor(cy - maxH / 2);
    const lw = right - left + 1;
    const lh = Math.ceil(maxH) + 2;
    const layer = faceLayer(lw, lh);
    const lctx = layer.getContext("2d");
    if (lctx) {
      lctx.clearRect(0, 0, lw, lh);
      lctx.imageSmoothingEnabled = true;
      lctx.imageSmoothingQuality = "high";
      for (const st of strips) {
        const dh = H * k * st.s;
        lctx.drawImage(face, st.t0, 0, st.t1 - st.t0, H, st.x0 - left, cy - dh / 2 - top, st.x1 - st.x0, dh);
      }
      ctx.drawImage(layer, 0, 0, lw, lh, left, top, lw, lh);
    }

    // Ljus: sidan mörknar när den vänds bort, och en reflex glider över glaset.
    ctx.save();
    path(ctx, outline);
    ctx.clip();
    const minX = Math.min(...outline.map((p) => p.x));
    const maxX = Math.max(...outline.map((p) => p.x));
    ctx.fillStyle = `rgba(0,0,0,${(0.5 * (1 - Math.abs(cos))).toFixed(3)})`;
    ctx.fillRect(minX, 0, maxX - minX, SHARE_CARD_HEIGHT);
    const pos = 0.5 + 0.9 * sin;
    const band = ctx.createLinearGradient(minX, 0, maxX, 0);
    const c = Math.min(0.95, Math.max(0.05, pos));
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(Math.max(0, c - 0.12), "rgba(255,255,255,0)");
    band.addColorStop(c, "rgba(255,255,255,0.16)");
    band.addColorStop(Math.min(1, c + 0.12), "rgba(255,255,255,0)");
    band.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = band;
    ctx.fillRect(minX, 0, maxX - minX, SHARE_CARD_HEIGHT);
    ctx.restore();

    ctx.save();
    path(ctx, outline);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/** Längsta upplösningen telefonen klarar att koda, eller null = ingen video här. */
export async function spinVideoSize(): Promise<{ width: number; height: number } | null> {
  if (typeof window === "undefined" || typeof (window as { VideoEncoder?: unknown }).VideoEncoder === "undefined") {
    return null;
  }
  try {
    const { canEncodeVideo, QUALITY_VERY_HIGH } = await import("mediabunny");
    for (const size of [
      { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
      { width: 720, height: 1280 },
    ]) {
      if (await canEncodeVideo("avc", { ...size, quality: QUALITY_VERY_HIGH, frameRate: SPIN_FPS })) return size;
    }
  } catch {
    /* ingen WebCodecs */
  }
  return null;
}

/** Koda ett helt varv som MP4. `onProgress` får 0..1. */
export async function encodeSpinVideo(
  layers: GradeSpinLayers,
  size: { width: number; height: number },
  onProgress?: (p: number) => void
): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_VERY_HIGH } = await import("mediabunny");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(size.width / SHARE_CARD_WIDTH, size.height / SHARE_CARD_HEIGHT);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", quality: QUALITY_VERY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: SPIN_FPS });
  await output.start();
  const frames = Math.round(SPIN_DURATION_SEC * SPIN_FPS);
  for (let i = 0; i < frames; i++) {
    const t = i / SPIN_FPS;
    drawSpinFrame(ctx, layers, spinAngleAt(t));
    await source.add(t, 1 / SPIN_FPS);
    onProgress?.((i + 1) / frames);
  }
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error("video");
  return new Blob([buf], { type: "video/mp4" });
}
