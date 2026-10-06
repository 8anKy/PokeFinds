/**
 * DELA-KORTET (2026-10-01): en bild i berättelseformat (1080 × 1920) med kortets
 * konst, namn, set/nummer och värde — gjord för Instagram/TikTok-stories,
 * Snapchat och Discord. Varje delning är en riktig samlare som visar upp Foilio,
 * utan att ägaren behöver synas själv (tillväxtrapporten 2026-08-28).
 *
 * ⛔ RITAS I WEBBLÄSAREN, ALDRIG PÅ SERVERN. `next/og` i drift är bortvalt
 *    (minnet är kapat), och en server-renderad bild hade kostat en Railway-
 *    process per delning. Canvas på telefonen kostar noll.
 *
 * ⛔ KORTBILDEN MÅSTE LADDAS MED `crossOrigin = "anonymous"`. Utan den "smutsas"
 *    canvasen ner och `toBlob` kastar SecurityError. Mätt 2026-10-01: alla
 *    bildvärdar som bär > 99 % av katalogen (pokemontcg.io, tcggo, scrydex,
 *    tcgdex) svarar `Access-Control-Allow-Origin: *`; tcgplayer/cardtrader
 *    (~65 kort) gör det inte ⇒ reserv = användarens EGET foto (data-URL, samma
 *    ursprung), och utan det ett kort utan konst hellre än ingen bild alls.
 *
 * Säkra zoner: Instagram täcker ~topp 200 px (profilrad) och ~botten 180 px
 * (svarsfältet) av en story, TikTok har sin knappkolumn till höger. Allt som
 * bär information ligger därför mellan y ≈ 200 och 1750 och centrerat.
 */

import { convexHull, homography, makeProjector, projectBox, warpPerspective } from "@/lib/perspective";

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;

/** Varumärkets turkos — samma som `holo.cyan` i tailwind.config.ts. */
const CYAN = "#2dd4bf";
const INK = "#fafafa";
const INK_MUTED = "#a1a1aa";
const INK_FAINT = "#8a8a93";

/** Kortets geometri: 5:7, centrerat. */
const CARD_W = 660;
const CARD_H = Math.round((CARD_W * 7) / 5); // 924
const CARD_X = (SHARE_CARD_WIDTH - CARD_W) / 2;
const CARD_Y = 330;
const TEXT_MAX_W = 920;

export interface ShareCardInput {
  /** Katalogens kortbild (laddas med CORS). */
  imageUrl: string | null;
  /** Reserv när katalogbilden saknas eller vägrar CORS — användarens foto. */
  fallbackImageUrl?: string | null;
  name: string;
  /** "Set · #12 · Reverse Holo" — färdigformaterad av anroparen. */
  subtitle: string;
  /** null ⇒ inget värde visas (vi visar aldrig "0 kr" eller en gissning). */
  value: { label: string; text: string } | null;
  /** Sidfoten, i två delar så domänen kan stå i vitt: "Värdera dina kort gratis på " + "foilio.se". */
  footer: { lead: string; domain: string };
}

function loadImage(src: string, cors: boolean, timeoutMs = 8000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.decoding = "async";
    const timer = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("load"));
    };
    img.src = src;
  });
}

/**
 * ⛔ EGEN URL FÖR CORS-LADDNINGEN (ägarens fältrapport 2026-10-01: tom slab ur
 * historiken på en iPhone). Samma bild har redan visats som en vanlig <img> utan
 * CORS (historikraden, skannerns ark), och WebKit återanvänder den cachade kopian
 * för en `crossOrigin`-begäran — den saknar CORS-godkännandet och laddningen
 * fallerar, trots att värden svarar `Access-Control-Allow-Origin: *`. En egen
 * query-parameter ger en egen cachepost. Mätt: pokemontcg.io, tcggo, scrydex och
 * tcgdex (> 99 % av katalogen) svarar 200 + ACAO * även med parametern.
 */
function corsUrl(src: string): string {
  if (!/^https?:\/\//.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}fo=share`;
}

async function loadCorsImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(corsUrl(src), true);
  } catch {
    // En värd som vägrar okända parametrar: prova den rena adressen.
    return loadImage(src, true);
  }
}

/** Ladda kortkonsten: katalogbilden med CORS, annars reserven, annars null. */
async function loadArt(input: ShareCardInput): Promise<HTMLImageElement | null> {
  if (input.imageUrl) {
    try {
      return await (input.imageUrl.startsWith("data:")
        ? loadImage(input.imageUrl, false)
        : loadCorsImage(input.imageUrl));
    } catch {
      /* CORS-vägran eller död länk → reserven */
    }
  }
  if (input.fallbackImageUrl) {
    try {
      return await (input.fallbackImageUrl.startsWith("data:")
        ? loadImage(input.fallbackImageUrl, false)
        : loadCorsImage(input.fallbackImageUrl));
    } catch {
      /* ingen konst alls — kortet ritas utan */
    }
  }
  return null;
}

/**
 * Sidans typsnitt (Inter via next/font) under sitt GENERERADE familjenamn.
 * Canvas känner inte till CSS-variabler, men den beräknade `font-family` på
 * body är den färdiga listan ("__Inter_abc, __Inter_Fallback_abc, system-ui…").
 */
function pageFontFamily(): string {
  try {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) return family;
  } catch {
    /* utanför DOM */
  }
  return "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
}

async function ensureFonts(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.all(
      ["500 32px", "700 46px", "800 64px", "800 112px"].map((w) => document.fonts.load(`${w} ${family}`))
    );
  } catch {
    /* reservtypsnittet duger */
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** En bild att rita: laddad bild eller en färdig duk (t.ex. en frilagd låda). */
type Art = HTMLImageElement | HTMLCanvasElement;

function artSize(img: Art): { iw: number; ih: number } {
  return img instanceof HTMLImageElement
    ? { iw: img.naturalWidth || img.width, ih: img.naturalHeight || img.height }
    : { iw: img.width, ih: img.height };
}

/** Bilden fyller rutan som `object-cover`. */
function drawCover(ctx: CanvasRenderingContext2D, img: Art, x: number, y: number, w: number, h: number) {
  const { iw, ih } = artSize(img);
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** Kortar texten med "…" tills den ryms. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

/** Största storlek (≤ max, ≥ min) där texten ryms på en rad. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  family: string,
  max: number,
  min: number,
  maxW: number
): number {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxW) return size;
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return min;
}

function setTracking(ctx: CanvasRenderingContext2D, px: number) {
  // `letterSpacing` på canvas finns i Chrome 99+/Safari 17+; äldre ignorerar tyst.
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

/**
 * Bakgrunden: kortets egna färger som ett mjukt sken bakom det — varje delning
 * får sin egen ton men samma svarta Foilio-yta mot kanterna. Oskärpan görs
 * genom att skala ner konsten till några få pixlar och sedan upp igen, inte med
 * `ctx.filter` (saknas i äldre Safari).
 */
function drawAmbient(
  ctx: CanvasRenderingContext2D,
  art: Art | null,
  cy: number = CARD_Y + CARD_H / 2,
  floorFrom: number = CARD_Y + CARD_H - 120
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const cx = SHARE_CARD_WIDTH / 2;

  if (art) {
    const tiny = document.createElement("canvas");
    tiny.width = 5;
    tiny.height = 7;
    const tctx = tiny.getContext("2d");
    if (tctx) {
      drawCover(tctx, art, 0, 0, tiny.width, tiny.height);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 0.45;
      const w = 1500;
      const h = 2100;
      ctx.drawImage(tiny, cx - w / 2, cy - h / 2, w, h);
      ctx.restore();
    }
  }

  // Vinjett: skenet tonar mot svart, så kanterna alltid är appens yta.
  const vignette = ctx.createRadialGradient(cx, cy, 200, cx, cy, 1150);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.5, "rgba(0,0,0,0.6)");
  vignette.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // Texten nedtill står alltid på (nästan) svart, oavsett kortets färger.
  const floor = ctx.createLinearGradient(0, floorFrom, 0, SHARE_CARD_HEIGHT);
  floor.addColorStop(0, "rgba(0,0,0,0)");
  floor.addColorStop(0.35, "rgba(0,0,0,0.85)");
  floor.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorFrom, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
}

/**
 * Märkets synliga yta i `foilio-mark.png` (320 × 320 med luft runt löv-F:et).
 * Ritas UTSKURET så att märket och ordmärket får rätt inbördes storlek och
 * avstånd — med luften kvar blev F:et hälften så högt som "Foilio".
 */
const MARK_CROP = { x: 106, y: 70, w: 130, h: 165 };

function drawMark(ctx: CanvasRenderingContext2D, mark: HTMLImageElement, x: number, cy: number, h: number) {
  const w = (h * MARK_CROP.w) / MARK_CROP.h;
  ctx.drawImage(mark, MARK_CROP.x, MARK_CROP.y, MARK_CROP.w, MARK_CROP.h, x, cy - h / 2, w, h);
  return w;
}

function drawBrand(ctx: CanvasRenderingContext2D, mark: HTMLImageElement | null, family: string) {
  const markH = 50;
  const markW = (markH * MARK_CROP.w) / MARK_CROP.h;
  const gap = 14;
  ctx.font = `700 46px ${family}`;
  setTracking(ctx, -1);
  const wordW = ctx.measureText("Foilio").width;
  const totalW = (mark ? markW + gap : 0) + wordW;
  let x = (SHARE_CARD_WIDTH - totalW) / 2;
  const cy = 236;
  if (mark) {
    drawMark(ctx, mark, x, cy, markH);
    x += markW + gap;
  }
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Foilio", x, cy + 2);
  setTracking(ctx, 0);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_RECT: Rect = { x: CARD_X, y: CARD_Y, w: CARD_W, h: CARD_H };

function drawCard(
  ctx: CanvasRenderingContext2D,
  art: Art | null,
  mark: HTMLImageElement | null,
  r: Rect = CARD_RECT,
  glow = true
) {
  const { x: CX, y: CY, w: CW, h: CH } = r;
  const radius = Math.round(CW * 0.045);
  // Skuggan: djup svart under, svag turkos glöd runt — appens `shadow-glow`.
  ctx.save();
  roundedRect(ctx, CX, CY, CW, CH, radius);
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 36;
  ctx.fillStyle = "#0b0b0d";
  ctx.fill();
  if (glow) {
    ctx.shadowColor = "rgba(45,212,191,0.28)";
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 0;
    ctx.fill();
  }
  ctx.restore();
  drawCardFace(ctx, art, mark, r);
}

/** Själva kortet utan skugga: konsten, foliereflexen och hårlinjen. */
function drawCardFace(ctx: CanvasRenderingContext2D, art: Art | null, mark: HTMLImageElement | null, r: Rect) {
  const { x: CX, y: CY, w: CW, h: CH } = r;
  const radius = Math.round(CW * 0.045);
  ctx.save();
  roundedRect(ctx, CX, CY, CW, CH, radius);
  ctx.clip();
  if (art) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, art, CX, CY, CW, CH);
  } else {
    // Ingen konst gick att ladda: en tom yta med märket, aldrig en trasig bild.
    ctx.fillStyle = "#1d1d21";
    ctx.fillRect(CX, CY, CW, CH);
    if (mark) {
      ctx.globalAlpha = 0.35;
      const h = Math.min(220, CH * 0.4);
      const w = (h * MARK_CROP.w) / MARK_CROP.h;
      drawMark(ctx, mark, CX + (CW - w) / 2, CY + CH / 2, h);
      ctx.globalAlpha = 1;
    }
  }
  // Foliereflex: ett smalt diagonalt ljusband — namnet är "Foilio".
  const sheen = ctx.createLinearGradient(CX, CY, CX + CW, CY + CH);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.3, "rgba(255,255,255,0)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0.13)");
  sheen.addColorStop(0.47, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(CX, CY, CW, CH);
  ctx.restore();

  // Hårlinje, som kortens ram i appen.
  ctx.save();
  roundedRect(ctx, CX + 1, CY + 1, CW - 2, CH - 2, radius - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Den glödande turkosa linjen ur varumärkesbilden (foilio-og.png). */
function drawBrandLine(ctx: CanvasRenderingContext2D, y: number) {
  const w = 440;
  const x = (SHARE_CARD_WIDTH - w) / 2;
  const line = ctx.createLinearGradient(x, 0, x + w, 0);
  line.addColorStop(0, "rgba(45,212,191,0)");
  line.addColorStop(0.5, "rgba(45,212,191,1)");
  line.addColorStop(1, "rgba(45,212,191,0)");
  ctx.save();
  ctx.shadowColor = "rgba(45,212,191,0.9)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = line;
  ctx.fillRect(x, y - 1.5, w, 3);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, input: ShareCardInput, family: string) {
  const cx = SHARE_CARD_WIDTH / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let y = CARD_Y + CARD_H + 64;
  drawBrandLine(ctx, y);

  // Namn
  y += 92;
  fitFont(ctx, input.name, 800, family, 64, 46, TEXT_MAX_W);
  setTracking(ctx, -1);
  ctx.fillStyle = INK;
  ctx.fillText(ellipsize(ctx, input.name, TEXT_MAX_W), cx, y);
  setTracking(ctx, 0);

  // Set · nummer · tryckning
  y += 56;
  ctx.font = `500 32px ${family}`;
  ctx.fillStyle = INK_MUTED;
  ctx.fillText(ellipsize(ctx, input.subtitle, TEXT_MAX_W), cx, y);

  if (input.value) {
    y += 92;
    ctx.font = `700 24px ${family}`;
    setTracking(ctx, 5);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(input.value.label.toUpperCase(), cx, y);
    setTracking(ctx, 0);

    y += 112;
    fitFont(ctx, input.value.text, 800, family, 112, 72, TEXT_MAX_W);
    setTracking(ctx, -2);
    ctx.save();
    ctx.shadowColor = "rgba(45,212,191,0.35)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = CYAN;
    ctx.fillText(input.value.text, cx, y);
    ctx.restore();
    setTracking(ctx, 0);
  }

  // Sidfot: uppmaningen i grått, domänen i vitt.
  const footY = Math.max(y + 96, 1700);
  ctx.font = `500 30px ${family}`;
  const leadW = ctx.measureText(input.footer.lead).width;
  ctx.font = `700 30px ${family}`;
  const domainW = ctx.measureText(input.footer.domain).width;
  const startX = cx - (leadW + domainW) / 2;
  ctx.textAlign = "left";
  ctx.font = `500 30px ${family}`;
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(input.footer.lead, startX, footY);
  ctx.font = `700 30px ${family}`;
  ctx.fillStyle = INK;
  ctx.fillText(input.footer.domain, startX + leadW, footY);
}

/** Rita delningsbilden. Kastar bara om canvas saknas helt. */
export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const family = pageFontFamily();
  const [art, mark] = await Promise.all([
    loadArt(input),
    loadImage("/brand/foilio-mark.png", false).catch(() => null),
    ensureFonts(family),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  drawAmbient(ctx, art);
  drawBrand(ctx, mark, family);
  drawCard(ctx, art, mark);
  drawText(ctx, input, family);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.92);
  });
}

/* ===========================================================================
 * GRADERINGSKORTET (2026-10-01) — kortet i en "slab" med Foilios EGEN etikett.
 *
 * ⛔ Aldrig PSA:s röda etikett, typsnitt eller logga: det är deras varumärke, och
 *    en bild som ser ut som en riktig PSA-slab är ett påstående om en gradering
 *    som aldrig gjorts. Etiketten säger "AI-GRAD", och raden längst ned säger att
 *    det är en uppskattning — samma ärlighet som /gradera själv.
 * ======================================================================== */

export interface GradeShareInput {
  /** Kortets bild: användarens utskurna kort > katalogbilden > råfotot. */
  imageUrl: string | null;
  fallbackImageUrl?: string | null;
  name: string;
  subtitle: string;
  /** Helhetsgraden, 1–10 med en decimal. */
  overall: number;
  /** De fyra delpoängen i visningsordning, med färdiga etiketter. */
  subScores: { label: string; value: number }[];
  /** Etikettens överrad, t.ex. "FOILIO AI-GRAD". */
  labelEyebrow: string;
  /** "av 10" */
  outOf: string;
  /** Uppmätt centrering, t.ex. "Uppmätt centrering · fram 54/46 · 51/49". */
  centeringLine: string | null;
  disclaimer: string;
  footer: { lead: string; domain: string };
  /**
   * Kortbaksidan i videon: "jp" (japanska kort) eller "en" (den internationella,
   * alla andra språk). Bilderna ligger i public/card-backs/ (ägarens filer 2026-10-01).
   */
  cardBack?: "en" | "jp";
  /**
   * Användarens EGNA baksida (utskuren) när slabben visar "Mitt foto" — då snurrar
   * slabben med kortets riktiga baksida i stället för den generiska (2026-10-04).
   */
  backImageUrl?: string | null;
}

/**
 * SLABBEN I 3D (ägarens önskan 2026-10-01: "ser inte ut som en riktig slab").
 *
 * Ytan ritas PLATT i hög upplösning (texturen nedan): genomskinlig hållare med
 * fasad kant, en ljus pärlemoetikett i en egen kammare, en upphöjd ribba och kortet
 * i en nedsänkt brunn. Den lutas sedan in i bilden med en homografi
 * (lib/perspective.ts) och får synlig TJOCKLEK (bak- och sidoytor ur samma kamera)
 * och en skugga mot golvet — det är tjockleken och glaset som får den att läsas
 * som ett föremål i stället för en ram.
 *
 * ⛔ Etiketten är Foilios egen (pärlemo + turkos list + folie-remsa), aldrig PSA:s
 *    röda ram eller logga.
 */
const TEX_W = 760;
const TEX_H = 1214;
const TEX_RADIUS = 36;
const LABEL = { x: 34, y: 34, w: TEX_W - 68, h: 214, r: 14 };
const WELL = { x: 60, y: 296, w: 640, h: 876, r: 18 };
const TEX_CARD = { x: 80, y: 316, w: 600, h: 836 };
/** Slabbens tjocklek i texturens enheter (~7 % av bredden, som en riktig hållare). */
const SLAB_DEPTH = 52;
/** Lutningen: högerkanten bort från betraktaren, toppen lite bakåt. */
const TILT_X = 6;
const TILT_Y = 17;
const FOCAL = 2600;
/** Hur stor slabben blir i bilden. */
const SLAB_SCALE = 0.9;
const SLAB_CENTER = { x: SHARE_CARD_WIDTH / 2 + 6, y: 866 };

function roundedRectPoints(w: number, h: number, r: number, perCorner = 8): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const corners = [
    { cx: w / 2 - r, cy: -h / 2 + r, a0: -Math.PI / 2 },
    { cx: w / 2 - r, cy: h / 2 - r, a0: 0 },
    { cx: -w / 2 + r, cy: h / 2 - r, a0: Math.PI / 2 },
    { cx: -w / 2 + r, cy: -h / 2 + r, a0: Math.PI },
  ];
  for (const c of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = c.a0 + (i / perCorner) * (Math.PI / 2);
      pts.push({ x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) });
    }
  }
  return pts;
}

function formatGrade(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Etiketten: SVART med turkos kant (ägarens val 2026-10-01 — den ljusa pärlemo-
 * etiketten byttes tillbaka), en tunn folieremsa, märket, kortet och graden.
 */
function drawLabelTexture(
  ctx: CanvasRenderingContext2D,
  input: GradeShareInput,
  family: string,
  mark: HTMLImageElement | null
) {
  const { x, y, w, h, r } = LABEL;
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  const paper = ctx.createLinearGradient(x, y, x + w, y + h);
  paper.addColorStop(0, "#111a19");
  paper.addColorStop(0.6, "#0a0d0d");
  paper.addColorStop(1, "#060707");
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.clip();

  // Folieremsa längs vänsterkanten — skiftar som en hologramdekal.
  const foil = ctx.createLinearGradient(x, y, x + 14, y + h);
  foil.addColorStop(0, "#7dd3fc");
  foil.addColorStop(0.25, "#a78bfa");
  foil.addColorStop(0.5, "#f472b6");
  foil.addColorStop(0.75, "#fcd34d");
  foil.addColorStop(1, "#2dd4bf");
  ctx.fillStyle = foil;
  ctx.fillRect(x, y, 12, h);

  // Svag glans över etiketten.
  const gloss = ctx.createLinearGradient(x, y, x, y + h);
  gloss.addColorStop(0, "rgba(255,255,255,0.07)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.strokeStyle = "rgba(45,212,191,0.65)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  const left = x + 40;
  const gradeW = 200;
  const divX = x + w - gradeW;
  const textMax = divX - left - 24;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let eyebrowX = left;
  if (mark) {
    const mh = 30;
    const mw = (mh * MARK_CROP.w) / MARK_CROP.h;
    ctx.drawImage(mark, MARK_CROP.x, MARK_CROP.y, MARK_CROP.w, MARK_CROP.h, left, y + 30, mw, mh);
    eyebrowX = left + mw + 10;
  }
  ctx.font = `800 22px ${family}`;
  setTracking(ctx, 3);
  ctx.fillStyle = CYAN;
  ctx.fillText(input.labelEyebrow.toUpperCase(), eyebrowX, y + 54);
  setTracking(ctx, 0);

  fitFont(ctx, input.name, 800, family, 44, 30, textMax);
  setTracking(ctx, -0.5);
  ctx.fillStyle = INK;
  ctx.fillText(ellipsize(ctx, input.name, textMax), left, y + 118);
  setTracking(ctx, 0);

  ctx.font = `500 25px ${family}`;
  ctx.fillStyle = INK_MUTED;
  ctx.fillText(ellipsize(ctx, input.subtitle, textMax), left, y + 160);

  ctx.fillStyle = "rgba(45,212,191,0.35)";
  ctx.fillRect(divX, y + 28, 2, h - 56);
  const gx = divX + gradeW / 2;
  const gradeText = formatGrade(input.overall);
  ctx.textAlign = "center";
  fitFont(ctx, gradeText, 900, family, 104, 64, gradeW - 30);
  setTracking(ctx, -4);
  ctx.save();
  ctx.shadowColor = "rgba(45,212,191,0.5)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = CYAN;
  ctx.fillText(gradeText, gx, y + 128);
  ctx.restore();
  setTracking(ctx, 0);
  ctx.font = `800 20px ${family}`;
  setTracking(ctx, 4);
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(input.outOf.toUpperCase(), gx, y + 164);
  setTracking(ctx, 0);
}

/** Den platta slabbytan med kortet i. Genomskinlig utanför de rundade hörnen. */
function slabTexture(
  input: GradeShareInput,
  family: string,
  art: HTMLImageElement | null,
  mark: HTMLImageElement | null
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d")!;

  // Hållarens kropp: klar plast med en svag kall ton.
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  const body = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  body.addColorStop(0, "rgba(225,240,245,0.17)");
  body.addColorStop(0.5, "rgba(200,220,228,0.07)");
  body.addColorStop(1, "rgba(225,240,245,0.14)");
  ctx.fillStyle = body;
  ctx.fill();

  // Fasad kant: ljus ytterkant, mörk fas, ljus innerlinje.
  ctx.save();
  roundedRect(ctx, 1.5, 1.5, TEX_W - 3, TEX_H - 3, TEX_RADIUS - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRect(ctx, 9, 9, TEX_W - 18, TEX_H - 18, TEX_RADIUS - 8);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRect(ctx, 14, 14, TEX_W - 28, TEX_H - 28, TEX_RADIUS - 12);
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Etikettkammaren: en skugglinje runt etiketten (den ligger infälld).
  ctx.save();
  roundedRect(ctx, LABEL.x - 6, LABEL.y - 6, LABEL.w + 12, LABEL.h + 12, LABEL.r + 5);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundedRect(ctx, LABEL.x, LABEL.y, LABEL.w, LABEL.h, LABEL.r);
  ctx.fillStyle = "#0a0d0d";
  ctx.fill();
  ctx.restore();
  drawLabelTexture(ctx, input, family, mark);

  // Ribban mellan etikett och kort.
  const ridgeY = LABEL.y + LABEL.h + 22;
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(30, ridgeY, TEX_W - 60, 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(30, ridgeY + 2, TEX_W - 60, 2);

  // Brunnen: lite mörkare plast, ljus överkant och mörk underkant = nedsänkt.
  ctx.save();
  roundedRect(ctx, WELL.x, WELL.y, WELL.w, WELL.h, WELL.r);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  roundedRect(ctx, WELL.x + 5, WELL.y + 5, WELL.w - 10, WELL.h - 10, WELL.r - 4);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Kortet i brunnen, med en tunn skugga under.
  const radius = Math.round(TEX_CARD.w * 0.045);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundedRect(ctx, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h, radius);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h, radius);
  ctx.clip();
  if (art) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, art, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h);
  } else {
    // Ingen bild gick att få fram: en tom brunn såg trasig ut (ägarens skärmdump
    // 2026-10-01). Märket i stället — aldrig ett påhittat kort.
    ctx.fillStyle = "#15191a";
    ctx.fillRect(TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h);
    if (mark) {
      ctx.globalAlpha = 0.35;
      const mh = 240;
      const mw = (mh * MARK_CROP.w) / MARK_CROP.h;
      ctx.drawImage(
        mark,
        MARK_CROP.x,
        MARK_CROP.y,
        MARK_CROP.w,
        MARK_CROP.h,
        TEX_CARD.x + (TEX_CARD.w - mw) / 2,
        TEX_CARD.y + (TEX_CARD.h - mh) / 2,
        mw,
        mh
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // Glaset: en bred mjuk reflex + en skarp strimma, och ljus längs överkanten.
  ctx.save();
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  ctx.clip();
  const sweep = ctx.createLinearGradient(0, 0, TEX_W, TEX_H * 0.9);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.2, "rgba(255,255,255,0.16)");
  sweep.addColorStop(0.3, "rgba(255,255,255,0.02)");
  sweep.addColorStop(0.33, "rgba(255,255,255,0.10)");
  sweep.addColorStop(0.36, "rgba(255,255,255,0)");
  sweep.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  const top = ctx.createLinearGradient(0, 0, 0, 60);
  top.addColorStop(0, "rgba(255,255,255,0.22)");
  top.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, TEX_W, 60);
  ctx.restore();
  return c;
}

/**
 * Ritar slabben lutad i 3D. Returnerar dess nedersta y i bilden (för texten under).
 */
function drawSlab3D(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement): number {
  const project = makeProjector(TILT_X, TILT_Y, FOCAL, SLAB_CENTER);
  const sw = TEX_W * SLAB_SCALE;
  const sh = TEX_H * SLAB_SCALE;
  const depth = SLAB_DEPTH * SLAB_SCALE;
  const outline = roundedRectPoints(sw, sh, TEX_RADIUS * SLAB_SCALE);
  const front = outline.map((p) => project(p.x, p.y, 0));
  const back = outline.map((p) => project(p.x, p.y, depth));

  // Skugga mot "golvet": en mjuk oval under och till höger.
  const bottom = Math.max(...front.map((p) => p.y), ...back.map((p) => p.y));
  ctx.save();
  ctx.translate(SLAB_CENTER.x + 40, bottom + 6);
  ctx.scale(1, 0.12);
  const shadow = ctx.createRadialGradient(0, 0, 10, 0, 0, sw * 0.62);
  shadow.addColorStop(0, "rgba(0,0,0,0.75)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, sw * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tjockleken: silhuetten av fram + bak, fylld som klar plast i skugga.
  const hull = convexHull([...front, ...back]);
  ctx.save();
  ctx.beginPath();
  hull.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  const side = ctx.createLinearGradient(SLAB_CENTER.x - sw / 2, 0, SLAB_CENTER.x + sw / 2 + depth, 0);
  side.addColorStop(0, "rgba(190,215,222,0.22)");
  side.addColorStop(1, "rgba(120,150,160,0.38)");
  ctx.fillStyle = side;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.30)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Baksidans kontur — syns genom plasten och ger djup.
  ctx.save();
  ctx.beginPath();
  back.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Framsidan: texturen varpad in i det lutade fyrhörnet.
  const corners = projectBox(sw, sh, depth, TILT_X, TILT_Y, FOCAL, SLAB_CENTER).front;
  const minX = Math.floor(Math.min(...corners.map((p) => p.x))) - 2;
  const minY = Math.floor(Math.min(...corners.map((p) => p.y))) - 2;
  const maxX = Math.ceil(Math.max(...corners.map((p) => p.x))) + 2;
  const maxY = Math.ceil(Math.max(...corners.map((p) => p.y))) + 2;
  const outW = maxX - minX;
  const outH = maxY - minY;
  const dst = corners.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const H = homography(dst, [
    { x: 0, y: 0 },
    { x: TEX_W, y: 0 },
    { x: TEX_W, y: TEX_H },
    { x: 0, y: TEX_H },
  ]);
  const tctx = texture.getContext("2d", { willReadFrequently: true });
  if (H && tctx) {
    const src = tctx.getImageData(0, 0, TEX_W, TEX_H);
    const out = warpPerspective({ data: src.data, width: TEX_W, height: TEX_H }, H, outW, outH);
    const tmp = document.createElement("canvas");
    tmp.width = outW;
    tmp.height = outH;
    const t2 = tmp.getContext("2d")!;
    const id = t2.createImageData(outW, outH);
    id.data.set(out);
    t2.putImageData(id, 0, 0);
    ctx.drawImage(tmp, minX, minY);
  }

  // Ljus kant där framsidan möter tjockleken (vänster/över = mot ljuset).
  ctx.save();
  ctx.beginPath();
  front.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  return bottom;
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  footer: { lead: string; domain: string },
  family: string,
  y: number,
  left?: number
) {
  const cx = SHARE_CARD_WIDTH / 2;
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 30px ${family}`;
  const leadW = ctx.measureText(footer.lead).width;
  ctx.font = `700 30px ${family}`;
  const domainW = ctx.measureText(footer.domain).width;
  const startX = left ?? cx - (leadW + domainW) / 2;
  ctx.textAlign = "left";
  ctx.font = `500 30px ${family}`;
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(footer.lead, startX, y);
  ctx.font = `700 30px ${family}`;
  ctx.fillStyle = INK;
  ctx.fillText(footer.domain, startX + leadW, y);
}

function drawSubScores(ctx: CanvasRenderingContext2D, subs: GradeShareInput["subScores"], family: string, y: number) {
  const n = subs.length;
  if (n === 0) return;
  const total = 880;
  const colW = total / n;
  const x0 = (SHARE_CARD_WIDTH - total) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  subs.forEach((s, i) => {
    const cx = x0 + colW * i + colW / 2;
    ctx.font = `800 52px ${family}`;
    ctx.fillStyle = INK;
    ctx.fillText(formatGrade(s.value), cx, y);
    ctx.font = `600 22px ${family}`;
    setTracking(ctx, 3);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(s.label.toUpperCase(), cx, y + 40);
    setTracking(ctx, 0);
    if (i > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x0 + colW * i, y - 46, 2, 92);
    }
  });
}

/** Kortkonst, märke och typsnitt — en gång per delningsbild/video. */
async function loadGradeAssets(input: GradeShareInput) {
  const family = pageFontFamily();
  const [art, mark] = await Promise.all([
    loadArt({
      imageUrl: input.imageUrl,
      fallbackImageUrl: input.fallbackImageUrl,
      name: input.name,
      subtitle: input.subtitle,
      value: null,
      footer: input.footer,
    }),
    loadImage("/brand/foilio-mark.png", false).catch(() => null),
    ensureFonts(family),
  ]);
  return { art, mark, family };
}

/** Den lutade stillbildsslabbens nederkant — texten under räknas från den (också i videon). */
function staticSlabBottom(): number {
  const project = makeProjector(TILT_X, TILT_Y, FOCAL, SLAB_CENTER);
  const sw = TEX_W * SLAB_SCALE;
  const sh = TEX_H * SLAB_SCALE;
  const depth = SLAB_DEPTH * SLAB_SCALE;
  const outline = roundedRectPoints(sw, sh, TEX_RADIUS * SLAB_SCALE);
  return Math.max(...outline.map((p) => project(p.x, p.y, 0).y), ...outline.map((p) => project(p.x, p.y, depth).y));
}

/** Delpoäng, centreringsrad, ansvarsrad och sidfot under slabben. */
function drawGradeText(ctx: CanvasRenderingContext2D, input: GradeShareInput, family: string) {
  let y = Math.max(staticSlabBottom() + 110, 1500);
  drawSubScores(ctx, input.subScores, family, y);
  y += 108;
  ctx.textAlign = "center";
  if (input.centeringLine) {
    ctx.font = `600 27px ${family}`;
    ctx.fillStyle = CYAN;
    ctx.fillText(ellipsize(ctx, input.centeringLine, TEXT_MAX_W), SHARE_CARD_WIDTH / 2, y);
    y += 46;
  }
  ctx.font = `500 23px ${family}`;
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(ellipsize(ctx, input.disclaimer, TEXT_MAX_W), SHARE_CARD_WIDTH / 2, y);
  drawFooter(ctx, input.footer, family, Math.max(y + 70, 1740));
}

/** Rita graderingens delningsbild (1080 × 1920). */
export async function renderGradeShareCard(input: GradeShareInput): Promise<Blob> {
  const { art, mark, family } = await loadGradeAssets(input);

  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  drawAmbient(ctx, art, SLAB_CENTER.y + 60, SLAB_CENTER.y + 420);
  drawBrand(ctx, mark, family);
  drawSlab3D(ctx, slabTexture(input, family, art, mark));
  drawGradeText(ctx, input, family);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.92);
  });
}

/**
 * SLABBEN SOM SNURRAR (2026-10-01) — lagren videon och förhandsvisningen ritar på:
 * bakgrunden (allt utom slabben, en gång) och slabbens två platta sidor. Se
 * lib/slab-spin.ts för hur de vrids.
 */
export interface GradeSpinLayers {
  background: HTMLCanvasElement;
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  center: { x: number; y: number };
  /** Texturens radie och tjocklek, i texturens enheter. */
  radius: number;
  depth: number;
}

export async function prepareGradeSpinLayers(input: GradeShareInput): Promise<GradeSpinLayers> {
  const [{ art, mark, family }, backArt] = await Promise.all([
    loadGradeAssets(input),
    (input.backImageUrl
      ? loadImage(input.backImageUrl, false).catch(() => null)
      : Promise.resolve(null)
    ).then(
      (own) => own ?? loadImage(`/card-backs/${input.cardBack === "jp" ? "jp" : "en"}.jpg`, false).catch(() => null)
    ),
  ]);
  const background = document.createElement("canvas");
  background.width = SHARE_CARD_WIDTH;
  background.height = SHARE_CARD_HEIGHT;
  const ctx = background.getContext("2d");
  if (!ctx) throw new Error("canvas");
  drawAmbient(ctx, art, SLAB_CENTER.y + 60, SLAB_CENTER.y + 420);
  drawBrand(ctx, mark, family);
  drawGradeText(ctx, input, family);
  return {
    background,
    front: slabTexture(input, family, art, mark),
    back: slabBackTexture(input, family, mark, backArt),
    center: SLAB_CENTER,
    radius: TEX_RADIUS,
    depth: SLAB_DEPTH,
  };
}

/**
 * Slabbens BAKSIDA: samma klara plast, etikettens baksida med Foilios märke och en
 * hologramdekal, och KORTETS BAKSIDA i brunnen — den japanska för japanska kort,
 * annars den internationella (ägarens önskan och filer 2026-10-01). Går bilden inte
 * att ladda blir det en neutral mörk kortbaksida.
 * ⛔ Den gamla japanska baksidan (set före 2001-07-19) finns inte som fil än — de
 *    korten får den nuvarande japanska tills ägaren tillför en.
 */
function slabBackTexture(
  input: GradeShareInput,
  family: string,
  mark: HTMLImageElement | null,
  backArt: HTMLImageElement | null
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext("2d")!;

  roundedRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  const body = ctx.createLinearGradient(TEX_W, 0, 0, TEX_H);
  body.addColorStop(0, "rgba(225,240,245,0.17)");
  body.addColorStop(0.5, "rgba(200,220,228,0.07)");
  body.addColorStop(1, "rgba(225,240,245,0.14)");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  roundedRect(ctx, 1.5, 1.5, TEX_W - 3, TEX_H - 3, TEX_RADIUS - 1);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRect(ctx, 9, 9, TEX_W - 18, TEX_H - 18, TEX_RADIUS - 8);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // Etikettens baksida: svart, märket + ordmärket, en hologramdekal till höger.
  const { x, y, w, h, r } = LABEL;
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "#080a0a";
  ctx.fill();
  ctx.strokeStyle = "rgba(45,212,191,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  let tx = x + 40;
  if (mark) {
    const mh = 74;
    const mw = (mh * MARK_CROP.w) / MARK_CROP.h;
    ctx.drawImage(mark, MARK_CROP.x, MARK_CROP.y, MARK_CROP.w, MARK_CROP.h, tx, y + (h - mh) / 2 - 14, mw, mh);
    tx += mw + 18;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 52px ${family}`;
  ctx.fillStyle = INK;
  ctx.fillText("Foilio", tx, y + h / 2 + 4);
  ctx.font = `700 22px ${family}`;
  setTracking(ctx, 3);
  ctx.fillStyle = CYAN;
  ctx.fillText(input.labelEyebrow.toUpperCase(), tx, y + h / 2 + 44);
  setTracking(ctx, 0);
  const holo = ctx.createLinearGradient(x + w - 170, y + 40, x + w - 40, y + h - 40);
  holo.addColorStop(0, "#7dd3fc");
  holo.addColorStop(0.3, "#a78bfa");
  holo.addColorStop(0.6, "#f472b6");
  holo.addColorStop(1, "#2dd4bf");
  ctx.save();
  roundedRect(ctx, x + w - 160, y + 52, 110, 110, 18);
  ctx.fillStyle = holo;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.restore();

  // Brunnen med kortets baksida.
  ctx.save();
  roundedRect(ctx, WELL.x, WELL.y, WELL.w, WELL.h, WELL.r);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  ctx.restore();
  const radius = Math.round(TEX_CARD.w * 0.045);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundedRect(ctx, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h, radius);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h, radius);
  ctx.clip();
  if (backArt) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, backArt, TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h);
  } else {
    const card = ctx.createRadialGradient(
      TEX_CARD.x + TEX_CARD.w / 2,
      TEX_CARD.y + TEX_CARD.h / 2,
      40,
      TEX_CARD.x + TEX_CARD.w / 2,
      TEX_CARD.y + TEX_CARD.h / 2,
      TEX_CARD.h * 0.65
    );
    card.addColorStop(0, "#1e2b4a");
    card.addColorStop(1, "#0b1020");
    ctx.fillStyle = card;
    ctx.fillRect(TEX_CARD.x, TEX_CARD.y, TEX_CARD.w, TEX_CARD.h);
  }
  ctx.restore();

  // Samma glas som framsidan, spegelvänt.
  ctx.save();
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  ctx.clip();
  const sweep = ctx.createLinearGradient(TEX_W, 0, 0, TEX_H * 0.9);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.22, "rgba(255,255,255,0.14)");
  sweep.addColorStop(0.32, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.restore();
  return c;
}

/* ===========================================================================
 * PRODUKTKORTET + SAMLINGSKORTET (2026-10-06) — samma story-format och samma
 * yta som skanningens kort, med pris, förändring och en liten prisgraf.
 *
 * ⛔ Siffrorna är exakt de som står i appen när användaren trycker på Dela
 *    (rubrikpriset, grafens serie, samlingens totalvärde) — bilden räknar
 *    ingenting själv och utelämnar raden när värdet saknas, aldrig "0 kr".
 * ======================================================================== */

export interface ShareChartPoint {
  date: string;
  /** Öre. */
  price: number;
}

export interface ShareChange {
  /** "+4,2 %" — färdigformaterad av anroparen. */
  text: string;
  /** "senaste 30 dagarna" */
  period: string;
  up: boolean;
}

const RISE = "#34d399";
const FALL = "#f87171";

/** Grafens etiketter: hela kronor räcker, decimaler är brus på en story. */
function chartLabel(ore: number): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(Math.round(ore / 100))} kr`;
}

/**
 * Prisgrafen: en mjuk turkos yta under linjen, högsta/lägsta utsatt och en punkt
 * på dagens värde. Ritas bara med minst två punkter — en ensam punkt är ingen kurva.
 */
function drawSparkline(
  ctx: CanvasRenderingContext2D,
  points: ShareChartPoint[],
  family: string,
  box: Rect,
  periodLabel: string
) {
  if (points.length < 2 || box.h < 120) return;
  const prices = points.map((p) => p.price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const span = max - min || Math.max(1, max * 0.05);
  const padTop = 46;
  const padBottom = 46;
  const plotH = box.h - padTop - padBottom;
  const xAt = (i: number) => box.x + (box.w * i) / (points.length - 1);
  const yAt = (v: number) => box.y + padTop + plotH - ((v - min) / span) * plotH;

  // Panelen: svag yta och hårlinje, som korten i appen.
  ctx.save();
  roundedRect(ctx, box.x - 28, box.y - 8, box.w + 56, box.h + 16, 28);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const path = () => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(xAt(i), yAt(p.price)) : ctx.moveTo(xAt(i), yAt(p.price))));
  };

  ctx.save();
  path();
  ctx.lineTo(xAt(points.length - 1), box.y + padTop + plotH);
  ctx.lineTo(xAt(0), box.y + padTop + plotH);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, box.y + padTop, 0, box.y + padTop + plotH);
  fill.addColorStop(0, "rgba(45,212,191,0.28)");
  fill.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  ctx.save();
  path();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = CYAN;
  ctx.shadowColor = "rgba(45,212,191,0.6)";
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = CYAN;
  ctx.shadowColor = "rgba(45,212,191,0.9)";
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(xAt(points.length - 1), yAt(points[points.length - 1].price), 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.font = `600 24px ${family}`;
  ctx.fillStyle = INK_FAINT;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(chartLabel(max), box.x, box.y + 26);
  ctx.fillText(chartLabel(min), box.x, box.y + box.h - 6);
  ctx.textAlign = "right";
  ctx.fillText(periodLabel, box.x + box.w, box.y + box.h - 6);
}

/** Förändringsraden: "▲ +4,2 %  senaste 30 dagarna" — pilen och talet i rise/fall. */
function drawChange(ctx: CanvasRenderingContext2D, change: ShareChange, family: string, y: number, left?: number) {
  const head = `${change.up ? "▲" : "▼"} ${change.text}`;
  const tail = `  ${change.period}`;
  ctx.font = `700 36px ${family}`;
  const headW = ctx.measureText(head).width;
  ctx.font = `500 32px ${family}`;
  const tailW = ctx.measureText(tail).width;
  const x = left ?? SHARE_CARD_WIDTH / 2 - (headW + tailW) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 36px ${family}`;
  ctx.fillStyle = change.up ? RISE : FALL;
  ctx.fillText(head, x, y);
  ctx.font = `500 32px ${family}`;
  ctx.fillStyle = INK_MUTED;
  ctx.fillText(tail, x + headW, y);
}

/** Namn, underrad, värde och förändring — gemensamt för produkt- och samlingskortet. */
function drawValueBlock(
  ctx: CanvasRenderingContext2D,
  family: string,
  y0: number,
  name: string,
  subtitle: string,
  value: { label: string; text: string } | null,
  change: ShareChange | null
): number {
  const cx = SHARE_CARD_WIDTH / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let y = y0;
  drawBrandLine(ctx, y);

  y += 84;
  fitFont(ctx, name, 800, family, 60, 42, TEXT_MAX_W);
  setTracking(ctx, -1);
  ctx.fillStyle = INK;
  ctx.fillText(ellipsize(ctx, name, TEXT_MAX_W), cx, y);
  setTracking(ctx, 0);

  if (subtitle) {
    y += 52;
    ctx.font = `500 30px ${family}`;
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(ellipsize(ctx, subtitle, TEXT_MAX_W), cx, y);
  }

  if (value) {
    y += 78;
    ctx.textAlign = "center";
    ctx.font = `700 24px ${family}`;
    setTracking(ctx, 5);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(value.label.toUpperCase(), cx, y);
    setTracking(ctx, 0);

    y += 104;
    fitFont(ctx, value.text, 800, family, 104, 64, TEXT_MAX_W);
    setTracking(ctx, -2);
    ctx.save();
    ctx.shadowColor = "rgba(45,212,191,0.35)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = CYAN;
    ctx.fillText(value.text, cx, y);
    ctx.restore();
    setTracking(ctx, 0);
  }

  if (change) {
    y += 62;
    drawChange(ctx, change, family, y);
  }
  return y;
}

/**
 * FRILÄGG LÅDAN (2026-10-06): förseglade produktbilder kommer antingen som PNG med
 * genomskinlig bakgrund (de flesta) eller som JPEG på vit botten (Cardmarkets
 * bilder). Den vita botten blev en vit ruta på den svarta bilden. Här fylls den
 * vita bakgrunden från KANTERNA och görs genomskinlig — bara det som hänger ihop
 * med kanten, så en vit yta INNE i lådan aldrig rörs.
 *
 * ⛔ Körs bara när alla fyra hörn är ogenomskinligt nästan-vita. En bild som redan
 *    är frilagd, eller har en färgad bakgrund, ritas som den är.
 */
function knockoutBackground(img: HTMLImageElement): Art {
  const { iw, ih } = artSize(img);
  if (!iw || !ih) return img;
  const scale = Math.min(1, 1400 / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return img;
  x.drawImage(img, 0, 0, w, h);
  let data: ImageData;
  try {
    data = x.getImageData(0, 0, w, h);
  } catch {
    return img; // nedsmutsad duk — rita bilden som den är
  }
  const d = data.data;
  const light = (i: number) => {
    const lo = Math.min(d[i], d[i + 1], d[i + 2]);
    const hi = Math.max(d[i], d[i + 1], d[i + 2]);
    return d[i + 3] >= 250 && lo >= 232 && hi - lo <= 18;
  };
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  if (!corners.every(light)) return img;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => {
    if (!seen[p] && light(p * 4)) {
      seen[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let i = 0; i < w; i++) {
    push(i);
    push((h - 1) * w + i);
  }
  for (let j = 0; j < h; j++) {
    push(j * w);
    push(j * w + w - 1);
  }
  while (sp > 0) {
    const p = stack[--sp];
    const px = p % w;
    if (px > 0) push(p - 1);
    if (px < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  let removed = 0;
  for (let p = 0; p < w * h; p++) if (seen[p]) removed++;
  // Nästan inget att ta bort, eller nästan allt (en vit bild): rita originalet.
  if (removed < w * h * 0.02 || removed > w * h * 0.97) return img;
  for (let p = 0; p < w * h; p++) if (seen[p]) d[p * 4 + 3] = 0;
  // Mjuk kant: ljusa pixlar precis intill bakgrunden tonas, annars blir det en vit sömm.
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) continue;
    const px = p % w;
    const edge =
      (px > 0 && seen[p - 1]) || (px < w - 1 && seen[p + 1]) || (p >= w && seen[p - w]) || (p < w * (h - 1) && seen[p + w]);
    if (!edge) continue;
    const i = p * 4;
    const lo = Math.min(d[i], d[i + 1], d[i + 2]);
    if (lo > 180) d[i + 3] = Math.round(d[i + 3] * Math.max(0.15, (255 - lo) / 75));
  }
  x.putImageData(data, 0, 0);
  return c;
}

/** Produktbilden som den ska ritas: förseglat frilagt, kort som det är. */
function prepareArt(img: HTMLImageElement | null, shape: "card" | "box"): Art | null {
  if (!img) return null;
  return shape === "box" ? knockoutBackground(img) : img;
}

/** Förseglat: lådan som den är (contain) med en mjuk skugga — aldrig beskuren. */
function drawBoxImage(ctx: CanvasRenderingContext2D, img: Art | null, mark: HTMLImageElement | null, box: Rect) {
  if (!img) {
    if (mark) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      const h = 220;
      const w = (h * MARK_CROP.w) / MARK_CROP.h;
      drawMark(ctx, mark, box.x + (box.w - w) / 2, box.y + box.h / 2, h);
      ctx.restore();
    }
    return;
  }
  const { iw, ih } = artSize(img);
  if (!iw || !ih) return;
  const scale = Math.min(box.w / iw, box.h / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 30;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  ctx.restore();
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.92);
  });
}

function newCanvas(w = SHARE_CARD_WIDTH, h = SHARE_CARD_HEIGHT): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  return { canvas, ctx };
}

/** Grafen under värdet: börjar där texten slutar, men aldrig in i sidfotens zon. */
function drawChartBelow(
  ctx: CanvasRenderingContext2D,
  chart: ShareChartPoint[],
  family: string,
  textBottom: number,
  periodLabel: string
) {
  const top = textBottom + 60;
  drawSparkline(ctx, chart, family, { x: 128, y: top, w: 824, h: Math.min(220, 1670 - top) }, periodLabel);
}

export interface ProductShareInput {
  imageUrl: string | null;
  name: string;
  /** "30th Celebration · Elite Trainer Box" */
  subtitle: string;
  /** Singel (5:7, ritas som skanningsbildens kort) eller förseglat (frilagt, "contain"). */
  shape: "card" | "box";
  value: { label: string; text: string } | null;
  change: ShareChange | null;
  chart: ShareChartPoint[];
  chartPeriod: string;
  footer: { lead: string; domain: string };
}

async function loadProductAssets(input: ProductShareInput) {
  const family = pageFontFamily();
  const [img, mark] = await Promise.all([
    loadArt({ imageUrl: input.imageUrl, name: input.name, subtitle: "", value: null, footer: input.footer }),
    loadImage("/brand/foilio-mark.png", false).catch(() => null),
    ensureFonts(family),
  ]);
  return { art: prepareArt(img, input.shape), mark, family };
}

/** Rita produktens delningsbild (1080 × 1920): bild, namn, pris, förändring, graf. */
export async function renderProductShareCard(input: ProductShareInput): Promise<Blob> {
  const { art, mark, family } = await loadProductAssets(input);
  const { canvas, ctx } = newCanvas();

  const imageBox: Rect = { x: 160, y: 310, w: 760, h: 620 };
  drawAmbient(ctx, art, imageBox.y + imageBox.h / 2, imageBox.y + imageBox.h - 80);
  drawBrand(ctx, mark, family);
  if (input.shape === "card") {
    const w = Math.round((imageBox.h * 5) / 7);
    drawCard(ctx, art, mark, { x: (SHARE_CARD_WIDTH - w) / 2, y: imageBox.y, w, h: imageBox.h });
  } else {
    drawBoxImage(ctx, art, mark, imageBox);
  }

  const bottom = drawValueBlock(
    ctx,
    family,
    imageBox.y + imageBox.h + 56,
    input.name,
    input.subtitle,
    input.value,
    input.change
  );
  drawChartBelow(ctx, input.chart, family, bottom, input.chartPeriod);
  drawFooter(ctx, input.footer, family, 1740);
  return canvasToJpeg(canvas);
}

/* ---------------------------------------------------------------------------
 * LIGGANDE PRODUKTBILD (2026-10-06): 1920 × 1080 — bilden till vänster, namn,
 * pris, förändring och graf i en spalt till höger. För Discord, X och chattar,
 * där en story-bild blir en smal remsa.
 * ------------------------------------------------------------------------- */

export const SHARE_WIDE_WIDTH = 1920;
export const SHARE_WIDE_HEIGHT = 1080;

/** Bryter texten på ord till högst `maxLines` rader; sista raden får "…" vid behov. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      line = words.slice(i).join(" ");
      break;
    }
  }
  if (line) lines.push(ellipsize(ctx, line, maxW));
  return lines;
}

export async function renderProductWideShareCard(input: ProductShareInput): Promise<Blob> {
  const { art, mark, family } = await loadProductAssets(input);
  const W = SHARE_WIDE_WIDTH;
  const H = SHARE_WIDE_HEIGHT;
  const { canvas, ctx } = newCanvas(W, H);

  // Bakgrunden: produktens färger som sken bakom bilden, svart under texten.
  const cx = 540;
  const cy = H / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (art) {
    const tiny = document.createElement("canvas");
    tiny.width = 5;
    tiny.height = 7;
    const tctx = tiny.getContext("2d");
    if (tctx) {
      drawCover(tctx, art, 0, 0, 5, 7);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 0.5;
      ctx.drawImage(tiny, cx - 750, cy - 1000, 1500, 2000);
      ctx.restore();
    }
  }
  const vignette = ctx.createRadialGradient(cx, cy, 160, cx, cy, 900);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.55, "rgba(0,0,0,0.6)");
  vignette.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  const column = ctx.createLinearGradient(880, 0, 1160, 0);
  column.addColorStop(0, "rgba(0,0,0,0)");
  column.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = column;
  ctx.fillRect(880, 0, W - 880, H);

  // Produkten.
  const imageBox: Rect = { x: 140, y: 140, w: 800, h: 800 };
  if (input.shape === "card") {
    const h = 780;
    const w = Math.round((h * 5) / 7);
    drawCard(ctx, art, mark, { x: imageBox.x + (imageBox.w - w) / 2, y: (H - h) / 2, w, h });
  } else {
    drawBoxImage(ctx, art, mark, imageBox);
  }

  // Högerspalten.
  const x0 = 1060;
  const colW = 740;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Märket + ordmärket.
  if (mark) drawMark(ctx, mark, x0, 150, 46);
  ctx.font = `700 42px ${family}`;
  setTracking(ctx, -1);
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText("Foilio", x0 + (mark ? (46 * MARK_CROP.w) / MARK_CROP.h + 12 : 0), 152);
  setTracking(ctx, 0);
  ctx.textBaseline = "alphabetic";

  let y = 280;
  ctx.font = `800 60px ${family}`;
  setTracking(ctx, -1);
  ctx.fillStyle = INK;
  const nameLines = wrapLines(ctx, input.name, colW, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, x0, y + i * 70));
  setTracking(ctx, 0);
  y += (nameLines.length - 1) * 70;

  if (input.subtitle) {
    y += 54;
    ctx.font = `500 30px ${family}`;
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(ellipsize(ctx, input.subtitle, colW), x0, y);
  }

  if (input.value) {
    y += 84;
    ctx.font = `700 24px ${family}`;
    setTracking(ctx, 5);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(input.value.label.toUpperCase(), x0, y);
    setTracking(ctx, 0);
    y += 112;
    fitFont(ctx, input.value.text, 800, family, 116, 72, colW);
    setTracking(ctx, -2);
    ctx.save();
    ctx.shadowColor = "rgba(45,212,191,0.35)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = CYAN;
    ctx.fillText(input.value.text, x0, y);
    ctx.restore();
    setTracking(ctx, 0);
  }

  if (input.change) {
    y += 62;
    drawChange(ctx, input.change, family, y, x0);
  }

  const chartTop = y + 56;
  drawSparkline(
    ctx,
    input.chart,
    family,
    { x: x0 + 28, y: chartTop, w: colW - 56, h: Math.min(260, 950 - chartTop) },
    input.chartPeriod
  );
  drawFooter(ctx, input.footer, family, 1010, x0);
  return canvasToJpeg(canvas);
}

/* ---------------------------------------------------------------------------
 * SAMLINGSKORTET — de tre mest värdefulla posterna står på ett blankt golv med
 * spegling, den dyraste i mitten. Kort ritas som kort, förseglat som lådor
 * (frilagda) — ägarens skärmdump 2026-10-06 visade lådor beskurna till kortformat.
 * ------------------------------------------------------------------------- */

export interface CollectionShareInput {
  /** "Min samling" eller pärmens namn. */
  title: string;
  /** "312 objekt" */
  subtitle: string;
  value: { label: string; text: string };
  change: ShareChange | null;
  chart: ShareChartPoint[];
  chartPeriod: string;
  /** De mest värdefulla posterna, dyrast först (max 3). Katalogbild först, eget foto som reserv. */
  top: { imageUrl: string | null; fallbackImageUrl?: string | null; shape: "card" | "box" }[];
  footer: { lead: string; domain: string };
}

/** En post som egen duk i rätt form och storlek — utan skugga, så den kan speglas. */
function showcaseItem(
  art: Art | null,
  shape: "card" | "box",
  mark: HTMLImageElement | null,
  maxW: number,
  maxH: number,
  dim: number
): HTMLCanvasElement {
  const asCard = shape === "card" || !art;
  let w: number;
  let h: number;
  if (asCard) {
    h = maxH;
    w = Math.round((h * 5) / 7);
    if (w > maxW) {
      w = maxW;
      h = Math.round((w * 7) / 5);
    }
  } else {
    const { iw, ih } = artSize(art!);
    const sc = Math.min(maxW / iw, maxH / ih);
    w = Math.max(1, Math.round(iw * sc));
    h = Math.max(1, Math.round(ih * sc));
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  if (asCard) {
    drawCardFace(x, art, mark, { x: 0, y: 0, w, h });
  } else {
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(art!, 0, 0, w, h);
  }
  if (dim > 0) {
    // Sidoposterna står ett steg bakom: lite mörkare, bara där posten finns.
    x.globalCompositeOperation = "source-atop";
    x.fillStyle = `rgba(0,0,0,${dim})`;
    x.fillRect(0, 0, w, h);
  }
  return c;
}

/** Ställ en post på golvet: kontaktskugga, spegling och posten med sin skugga. */
function drawOnFloor(ctx: CanvasRenderingContext2D, item: HTMLCanvasElement, cx: number, floorY: number) {
  const w = item.width;
  const h = item.height;
  const x = cx - w / 2;

  // Spegling: posten upp och ned, tonad mot svart.
  const rh = Math.min(180, Math.round(h * 0.4));
  const r = document.createElement("canvas");
  r.width = w;
  r.height = rh;
  const rc = r.getContext("2d");
  if (rc) {
    rc.setTransform(1, 0, 0, -1, 0, h);
    rc.drawImage(item, 0, 0);
    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.globalCompositeOperation = "destination-in";
    const fade = rc.createLinearGradient(0, 0, 0, rh);
    fade.addColorStop(0, "rgba(0,0,0,0.32)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    rc.fillStyle = fade;
    rc.fillRect(0, 0, w, rh);
    ctx.drawImage(r, x, floorY + 3);
  }

  // Kontaktskugga där posten möter golvet.
  ctx.save();
  ctx.translate(cx, floorY);
  ctx.scale(1, 0.07);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0.9)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.drawImage(item, x, floorY - h);
  ctx.restore();
}

/** Rita samlingens delningsbild: de tre dyraste på ett golv + värdet + grafen. */
export async function renderCollectionShareCard(input: CollectionShareInput): Promise<Blob> {
  const family = pageFontFamily();
  const top = input.top.slice(0, 3);
  const [imgs, mark] = await Promise.all([
    Promise.all(
      top.map((t) =>
        loadArt({
          imageUrl: t.imageUrl,
          fallbackImageUrl: t.fallbackImageUrl,
          name: "",
          subtitle: "",
          value: null,
          footer: input.footer,
        })
      )
    ),
    loadImage("/brand/foilio-mark.png", false).catch(() => null),
    ensureFonts(family),
  ]);
  const arts = imgs.map((img, i) => prepareArt(img, top[i].shape));
  const { canvas, ctx } = newCanvas();

  const floorY = 900;
  drawAmbient(ctx, arts[0] ?? null, floorY - 280, floorY + 140);
  drawBrand(ctx, mark, family);

  // Golvet: ett svagt turkost ljus där posterna står.
  ctx.save();
  ctx.translate(SHARE_CARD_WIDTH / 2, floorY);
  ctx.scale(1, 0.1);
  const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, 520);
  floor.addColorStop(0, "rgba(45,212,191,0.22)");
  floor.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.arc(0, 0, 520, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sidoposterna först (bakom), den dyraste sist och störst.
  const sides = top.length >= 3 ? [1, 2] : top.length === 2 ? [1] : [];
  // Lådor är ofta bredare än höga: de får mer BREDD än kortens 5:7, annars blir en
  // ETB en liten remsa på golvet.
  const sideX = top.length >= 3 ? [SHARE_CARD_WIDTH / 2 - 320, SHARE_CARD_WIDTH / 2 + 320] : [SHARE_CARD_WIDTH / 2 + 270];
  sides.forEach((idx, k) => {
    const item = showcaseItem(arts[idx] ?? null, top[idx].shape, mark, 400, 440, 0.28);
    drawOnFloor(ctx, item, sideX[k], floorY);
  });
  if (top.length > 0) {
    const cx = top.length === 2 ? SHARE_CARD_WIDTH / 2 - 110 : SHARE_CARD_WIDTH / 2;
    drawOnFloor(ctx, showcaseItem(arts[0] ?? null, top[0].shape, mark, 640, 580, 0), cx, floorY);
  }

  const bottom = drawValueBlock(ctx, family, floorY + 120, input.title, input.subtitle, input.value, input.change);
  drawChartBelow(ctx, input.chart, family, bottom, input.chartPeriod);
  drawFooter(ctx, input.footer, family, 1740);
  return canvasToJpeg(canvas);
}
