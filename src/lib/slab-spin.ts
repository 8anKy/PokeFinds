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

  // Tjockleken: båda kantytorna, den bortre först (målarens algoritm).
  const sideH = half.h - layers.radius * k;
  const sides = [half.w, -half.w].map((u) => {
    const pts = [project(u, -sideH, -half.d), project(u, -sideH, half.d), project(u, sideH, half.d), project(u, sideH, -half.d)];
    return { pts, z: (pts[0].z + pts[1].z) / 2 };
  });
  sides.sort((a, b) => b.z - a.z);
  for (const side of sides) {
    ctx.save();
    path(ctx, side.pts);
    ctx.fillStyle = "rgba(150,185,195,0.42)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Vilken sida vänder sig mot oss? Framsidans projektion avgör (perspektivrätt).
  const frontVisible = project(half.w, 0, -half.d).x > project(-half.w, 0, -half.d).x;
  const faceW = frontVisible ? -half.d : half.d;
  const face = frontVisible ? layers.front : layers.back;
  // Baksidan spegelvänds så att den läses rätt bakifrån.
  const uAt = (t: number) => (frontVisible ? -half.w + (t / W) * 2 * half.w : half.w - (t / W) * 2 * half.w);

  const outline = roundedOutline(half.w * 2, half.h * 2, layers.radius * k).map((p) => project(p.u, p.v, faceW));
  const faceSpan = Math.abs(project(half.w, 0, faceW).x - project(-half.w, 0, faceW).x);
  if (faceSpan > 1.5) {
    // Remsorna ritas i ett EGET lager på HELA pixlar — kant mot kant, varken glapp
    // eller överlapp — och lagret läggs sedan på bilden. Med överlapp ritades den
    // genomskinliga plasten två gånger i varje skarv: lodräta streck över ytan.
    const xs: number[] = [];
    const ss: number[] = [];
    const step = W / STRIPS;
    for (let i = 0; i <= STRIPS; i++) {
      const pt = project(uAt(i * step), 0, faceW);
      xs.push(pt.x);
      ss.push(pt.s);
    }
    const left = Math.floor(Math.min(...xs));
    const right = Math.ceil(Math.max(...xs));
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
      for (let i = 0; i < STRIPS; i++) {
        const x0 = Math.round(Math.min(xs[i], xs[i + 1]));
        const x1 = Math.round(Math.max(xs[i], xs[i + 1]));
        if (x1 <= x0) continue;
        const dh = H * k * ((ss[i] + ss[i + 1]) / 2);
        lctx.drawImage(face, i * step, 0, step, H, x0 - left, cy - dh / 2 - top, x1 - x0, dh);
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
    const { canEncodeVideo, QUALITY_HIGH } = await import("mediabunny");
    for (const size of [
      { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
      { width: 720, height: 1280 },
    ]) {
      if (await canEncodeVideo("avc", { ...size, quality: QUALITY_HIGH, frameRate: SPIN_FPS })) return size;
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
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } = await import("mediabunny");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(size.width / SHARE_CARD_WIDTH, size.height / SHARE_CARD_HEIGHT);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", quality: QUALITY_HIGH, keyFrameInterval: 1 });
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
