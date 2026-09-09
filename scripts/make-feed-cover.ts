/**
 * OMSLAG TILL EN NYHET — ett Foilio-kort med stor rubrik, i stället för ingen bild.
 *
 * VARFÖR DET HÄR FINNS: våra egna nyheter (appuppdateringar) har ingen bild att
 * hämta någonstans, och en artikel hos någon annan har inte alltid en heller
 * (pokemon.com renderar sin og:image med JS, psacard.com fäller vår bot). En rad
 * utan omslag bredvid rader som har ett läser som ett fel — så vi RITAR ett.
 *
 * ⛔ BILDEN GENERERAS EN GÅNG, HÄR, OCH CHECKAS IN. Den renderas medvetet INTE i
 *    drift: `next/og` hade dragit in satori + en wasm-renderare i processen, och
 *    Railway-minnet är redan kapat (heap 384 MB, självåtervinning vid 550 MB —
 *    se kostnadsdoktrinen i CLAUDE.md). En PNG i `public/` kostar noll minne,
 *    noll CPU och cachas av webbläsaren.
 * ⛔ TEXTEN RENDERAS MED SYSTEMETS TYPSNITT (Arial/Helvetica via librsvg). Det är
 *    därför bilden görs på en utvecklarmaskin och inte i GitHub-jobbet — en
 *    ubuntu-runner har inget Arial och skulle tyst byta typsnitt.
 *
 * Kör:
 *   npx tsx scripts/make-feed-cover.ts --title "Rubriken" --category APP \
 *     --out public/news/min-nyhet.png [--art assets/play/screenshots/03-portfolj.png]
 */
import sharp from "sharp";

const W = 1200;
const H = 630;
const PAD = 72;

/** Samma betydelse som pillren i UI:t (src/components/features/feed/feed-chrome.tsx). */
const ACCENT: Record<string, { hex: string; label: string }> = {
  // ⛔ Vår EGEN nyhet bär märkesfärgen. Setsläpp flyttades till violett just för
  //    att de två annars var samma färg i samma lista.
  APP: { hex: "#2dd4bf", label: "APPEN" },
  RELEASE: { hex: "#a78bfa", label: "SLÄPP" },
  MARKET: { hex: "#f59e0b", label: "MARKNAD" },
  STORE: { hex: "#f472b6", label: "BUTIKSNYTT" },
  EXPO: { hex: "#a78bfa", label: "MÄSSA" },
  PRERELEASE: { hex: "#2dd4bf", label: "PRERELEASE" },
  TOURNAMENT: { hex: "#f59e0b", label: "TURNERING" },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Radbrytning på uppskattad bredd. Arial Bold ligger runt 0,56 av teckenstorleken
 * per tecken; marginalen nedan är tilltagen med flit — en rubrik som spiller över
 * kanten är värre än en som är en aning för liten.
 */
function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  const perChar = fontSize * 0.56;
  const maxChars = Math.floor(maxWidth / perChar);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Största storlek där rubriken får plats på högst tre rader. */
function fitHeadline(text: string, maxWidth: number): { size: number; lines: string[] } {
  for (const size of [82, 72, 64, 56, 48, 42]) {
    const lines = wrap(text, size, maxWidth);
    if (lines.length <= 3) return { size, lines };
  }
  return { size: 42, lines: wrap(text, 42, maxWidth).slice(0, 3) };
}

async function main() {
  const title = arg("title");
  const category = (arg("category") ?? "APP").toUpperCase();
  const out = arg("out");
  const art = arg("art");
  if (!title || !out) throw new Error("Ange --title och --out (och gärna --category, --art).");

  const accent = ACCENT[category] ?? ACCENT.APP;
  const textWidth = art ? 600 : W - PAD * 2;
  const { size, lines } = fitHeadline(title, textWidth);

  // Rubriken bottenankras: kortet ska läsa nedifrån och upp oavsett radantal.
  const lineHeight = Math.round(size * 1.1);
  const baseline = 470;
  const startY = baseline - (lines.length - 1) * lineHeight;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="18%" cy="12%" r="85%">
      <stop offset="0%" stop-color="${accent.hex}" stop-opacity="0.34"/>
      <stop offset="55%" stop-color="${accent.hex}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="88%" cy="86%" r="70%">
      <stop offset="0%" stop-color="${accent.hex}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#000000"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <!-- Hårlinje längs kanten, samma som korten i appen. -->
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>

  <rect x="${PAD}" y="${PAD}" width="${accent.label.length * 15 + 44}" height="46" rx="23"
        fill="${accent.hex}" fill-opacity="0.14" stroke="${accent.hex}" stroke-opacity="0.4"/>
  <text x="${PAD + 22}" y="${PAD + 31}" font-family="Arial, Helvetica, sans-serif" font-size="20"
        font-weight="700" letter-spacing="2.4" fill="${accent.hex}">${escapeXml(accent.label)}</text>

  ${lines
    .map(
      (line, i) =>
        `<text x="${PAD}" y="${startY + i * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" letter-spacing="-1.5" fill="#fafafa">${escapeXml(line)}</text>`
    )
    .join("\n  ")}

  <text x="${PAD + 48}" y="${H - PAD}" font-family="Arial, Helvetica, sans-serif" font-size="26"
        font-weight="700" letter-spacing="-0.5" fill="#a1a1aa">Foilio</text>
</svg>`;

  let image = sharp(Buffer.from(svg)).png();

  // Riktiga märket, inte en ritad platta — kortet ska bära samma logotyp som appen.
  const mark = await sharp("public/brand/foilio-mark.png").resize(34, 34, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  image = sharp(await image.toBuffer())
    .composite([{ input: mark, left: PAD, top: H - PAD - 26 }])
    .png();

  if (art) {
    // Skärmbilden ligger till höger, med rundade hörn och en hårlinje — samma
    // form som korten i appen, så bilden känns som en del av gränssnittet.
    const artW = 320;
    const artH = 520;
    const resized = await sharp(art).resize({ width: artW, height: artH, fit: "cover", position: "top" }).toBuffer();
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${artW}" height="${artH}"><rect width="${artW}" height="${artH}" rx="22" fill="#fff"/></svg>`
    );
    const rounded = await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    image = sharp(await image.toBuffer())
      .composite([{ input: rounded, left: W - PAD - artW, top: Math.round((H - artH) / 2) }])
      .png();
  }

  await image.toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${out} — ${meta.width}×${meta.height}, rubrik ${size}px på ${lines.length} rad(er).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
