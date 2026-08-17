/**
 * Bygger sajtens delningsbild: `public/brand/foilio-og.png` (1200×630).
 *
 * ⛔ KÖRS FÖR HAND, ALDRIG I BYGGET. Resultatet är en incheckad statisk fil — att
 * generera om den vid varje deploy hade lagt sharp i byggkedjan och gett en ny
 * binär i diffen varje gång utan att något ändrats. Kör bara om märket byts:
 *   node scripts/build-og-card.mjs
 *
 * ⛔ VARFÖR 1200×630 OCH INTE MÄRKET RAKT AV. Delningsbilden var
 * `foilio-mark.png`, en KVADRAT. Discord, Slack och iMessage visar den hel, men
 * X beskär ett stort kort till 2:1 och hade kapat loggans över- och underkant —
 * därför stod `twitter:card` på `summary` (liten kvadratisk miniatyr) i stället
 * för `summary_large_image`. Med rätt bildförhållande i själva filen behöver
 * ingen yta beskära något, och kortet kan visas stort överallt.
 *
 * ⛔ INGEN TEXT I BILDEN, MED FLIT. Två skäl: (1) varje yta som visar kortet
 * renderar redan `og:title` och `og:site_name` som riktig text bredvid bilden —
 * en inbränd titel hade blivit en andra, dubblerad rubrik som dessutom inte kan
 * översättas till /en; (2) sajtens typsnitt är Inter, som inte finns installerat
 * på maskinen som bygger kortet, så texten hade renderats i ett fallback-typsnitt
 * och sett off-brand ut i en fil ingen tittar på förrän den ligger i ett
 * Discord-inlägg. Märke + accentlinje bär varumärket utan den risken.
 *
 * Kompositionen återanvänder två befintliga varumärkeselement: den svarta ytan
 * (`surface` = #000000, samma som sidan) och `.foil-line` ur globals.css
 * (gradient transparent → holo.cyan → brand.dark).
 */
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const SOURCE = "public/brand/foilio-logo.png";
const OUT = "public/brand/foilio-og.png";

/** Tokens ur tailwind.config.ts — håll dem i synk om paletten ändras. */
const HOLO_CYAN = "#2dd4bf";
const BRAND_DARK = "#0f766e";
const SURFACE = "#000000";

const LINE_WIDTH = 460;
const LINE_HEIGHT = 4;

const foilLine = Buffer.from(
  `<svg width="${LINE_WIDTH}" height="${LINE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
       <stop offset="0%" stop-color="${HOLO_CYAN}" stop-opacity="0"/>
       <stop offset="50%" stop-color="${HOLO_CYAN}" stop-opacity="0.95"/>
       <stop offset="100%" stop-color="${BRAND_DARK}" stop-opacity="0"/>
     </linearGradient></defs>
     <rect width="${LINE_WIDTH}" height="${LINE_HEIGHT}" rx="2" fill="url(#g)"/>
   </svg>`
);

// `trim()` först: källfilen är 5016×5016 med bred genomskinlig marginal, så en
// centrering på filens mått hade lagt märket optiskt fel. Vi centrerar på det
// som faktiskt syns.
const mark = await sharp(SOURCE)
  .trim({ threshold: 1 })
  .resize({ height: 348, fit: "inside" })
  .png()
  .toBuffer({ resolveWithObject: true });

// -30 px: märket lyfts något över mitten så att accentlinjen under det får luft
// utan att kompositionen blir bottentung.
const markTop = Math.round((HEIGHT - mark.info.height) / 2) - 30;

await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: SURFACE } })
  .composite([
    { input: mark.data, left: Math.round((WIDTH - mark.info.width) / 2), top: markTop },
    {
      input: foilLine,
      left: Math.round((WIDTH - LINE_WIDTH) / 2),
      top: markTop + mark.info.height + 44,
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`${OUT} — ${WIDTH}×${HEIGHT}`);
