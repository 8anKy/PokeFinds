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
/** Ett riktigt korts hörnradie är ~3 mm på 63 mm bredd. */
const CARD_RADIUS = Math.round(CARD_W * 0.045);
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

/** Ladda kortkonsten: katalogbilden med CORS, annars reserven, annars null. */
async function loadArt(input: ShareCardInput): Promise<HTMLImageElement | null> {
  if (input.imageUrl) {
    try {
      return await loadImage(input.imageUrl, true);
    } catch {
      /* CORS-vägran eller död länk → reserven */
    }
  }
  if (input.fallbackImageUrl) {
    try {
      return await loadImage(input.fallbackImageUrl, !input.fallbackImageUrl.startsWith("data:"));
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

/** Bilden fyller rutan som `object-cover`. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
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
function drawAmbient(ctx: CanvasRenderingContext2D, art: HTMLImageElement | null) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  const cx = SHARE_CARD_WIDTH / 2;
  const cy = CARD_Y + CARD_H / 2;

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
  const floor = ctx.createLinearGradient(0, CARD_Y + CARD_H - 120, 0, SHARE_CARD_HEIGHT);
  floor.addColorStop(0, "rgba(0,0,0,0)");
  floor.addColorStop(0.35, "rgba(0,0,0,0.85)");
  floor.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, CARD_Y + CARD_H - 120, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
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

function drawCard(ctx: CanvasRenderingContext2D, art: HTMLImageElement | null, mark: HTMLImageElement | null) {
  // Skuggan: djup svart under, svag turkos glöd runt — appens `shadow-glow`.
  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 36;
  ctx.fillStyle = "#0b0b0d";
  ctx.fill();
  ctx.shadowColor = "rgba(45,212,191,0.28)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 0;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.clip();
  if (art) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, art, CARD_X, CARD_Y, CARD_W, CARD_H);
  } else {
    // Ingen konst gick att ladda: en tom yta med märket, aldrig en trasig bild.
    ctx.fillStyle = "#1d1d21";
    ctx.fillRect(CARD_X, CARD_Y, CARD_W, CARD_H);
    if (mark) {
      ctx.globalAlpha = 0.35;
      const h = 220;
      const w = (h * MARK_CROP.w) / MARK_CROP.h;
      drawMark(ctx, mark, CARD_X + (CARD_W - w) / 2, CARD_Y + CARD_H / 2, h);
      ctx.globalAlpha = 1;
    }
  }
  // Foliereflex: ett smalt diagonalt ljusband — namnet är "Foilio".
  const sheen = ctx.createLinearGradient(CARD_X, CARD_Y, CARD_X + CARD_W, CARD_Y + CARD_H);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.3, "rgba(255,255,255,0)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0.13)");
  sheen.addColorStop(0.47, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(CARD_X, CARD_Y, CARD_W, CARD_H);
  ctx.restore();

  // Hårlinje, som kortens ram i appen.
  ctx.save();
  roundedRect(ctx, CARD_X + 1, CARD_Y + 1, CARD_W - 2, CARD_H - 2, CARD_RADIUS - 1);
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
