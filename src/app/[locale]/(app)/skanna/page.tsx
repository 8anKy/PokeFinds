"use client";

/**
 * Kortskanner (capture-baserad) — rikta kameran mot ett kort och TRYCK på
 * slutarknappen för att fånga EN ruta. Bilden stannar i appen (canvas → JPEG i
 * minnet, sparas ALDRIG i kamerarullen) och skickas till /api/scanner/identify.
 * Träffar samlas i en lista; granska och lägg till hela batchen i samlingen.
 * (Live-loopen är borttagen — användaren bestämmer när en bild tas.) Skick bedöms
 * separat under /gradera.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import {
  FINGERPRINT_INSETS,
  fingerprintFromRgb,
  structFingerprintFromRgb,
} from "@/lib/art-fingerprint";
import {
  detectCardQuad,
  detectCardRegions,
  type RegionDiag,
  warpPerspective,
  RECTIFIED_H,
  RECTIFIED_W,
} from "@/lib/card-quad";
import { useIsAdmin } from "@/components/admin-only";
import { Button, LinkButton } from "@/components/ui/button";
import { PriceChange } from "@/components/ui/price-change";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { hasAuthHint } from "@/lib/auth-hint";
import { registerFullscreenHost } from "@/lib/product-overlay-open";
import { useCameraControls } from "@/hooks/use-camera-controls";
import {
  withDeviceId,
  type ZoomPreset,
  type ZoomPresetOption,
} from "@/lib/camera-controls";
import {
  barcodeSupported,
  createBarcodeScanner,
  type BarcodeScanner,
} from "@/services/scanner/barcode";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCamera,
  IconCards,
  IconCheck,
  IconChevronLeft,
  IconFlashlight,
  IconLock,
  IconScan,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUpload,
  IconX,
} from "@/components/ui/icons";

/**
 * Hur många "kan det vara det här i stället?"-rader detaljvyn visar.
 *
 * Listan var OAVKORTAD. 92 % av katalogens kort delar namn med minst ett annat
 * (18 938 av 20 563), så en vanlig skanning radade upp tio kort och sköt ner
 * prisutvecklingen långt under vikningen — den syntes aldrig. Tre rader räcker
 * för det alternativen faktiskt är till för: att rätta en förväxling.
 */
const MAX_ALTERNATIVES = 3;
/**
 * Ett alternativ är bara värt att visa om det ligger NÄRA träffen.
 *
 * Poängen är en proxy för "såg likadant ut": ett kort som ligger långt under
 * träffen delade oftast bara ett namn-token ("Iron Valiant ex" drog in varje
 * Iron Hands) och är ingen förväxlingsrisk. Att visa det ändå är värre än att
 * utelämna det — det får en användare att tvivla på en träff som var rätt.
 * ⛔ Fönstret gallrar VISNINGEN, aldrig matchningen: kandidaterna räknas fram
 * precis som förut, och `onChoose` kan fortfarande välja vilken som helst.
 */
const ALT_SCORE_WINDOW = 0.2;

interface Candidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  slug: string | null;
  /** Vald tryckning, när kandidaten pekar på en specifik produkt. */
  productId: string | null;
  /** "Unlimited" / "Shadowless" / "1st Edition" — null när kortet bara har en. */
  variantLabel: string | null;
  score: number;
  estimatedValue: number | null;
}

interface IdentifyResponse {
  provider: string;
  guessedName: string | null;
  guessedNumber: string | null;
  /** Modellens ramgenerations-klassning ("wotc" … "sv"), null när osäker. */
  guessedEra: string | null;
  /** Modellens HP-läsning (kortets största tal), null när oläst. */
  guessedHp: number | null;
  confidence: number;
  candidates: Candidate[];
  /** Bildmatchningens bästa likhet 0..1, null när inget avtryck kunde användas. */
  artTop: number | null;
  /** Bildmatchningens tre bästa kort som text (admin-diagnostik). */
  artTopLabel: string | null;
  /** Flera OLIKA kort ligger praktiskt taget lika — ingen träff går att påstå. */
  ambiguous: boolean;
  remaining?: number;
  /** Admin: skanningens jobb-id — gör användarens korrigering till facit. */
  jobId?: string | null;
}

interface ScanQuota {
  remaining: number;
  limit: number;
  isPremium: boolean;
}

type ScanStatus = "identifying" | "matched" | "nomatch" | "error";

interface ScanItem {
  id: string;
  status: ScanStatus;
  captured: string; // data-URL, endast i minnet
  match: Candidate | null;
  candidates: Candidate[];
  confidence: number;
  /** Flera OLIKA kort låg praktiskt taget lika — träffen är en GISSNING.
   *  Visas ändå (en gissning är mer användbar än "ingen träff"), men märkt. */
  uncertain: boolean;
  quantity: number;
  condition: string;
  language: string;
  errorMessage?: string;
  /** Admin: skanningens jobb-id — användarens korrigering rapporteras som facit. */
  jobId?: string | null;
}

/**
 * Användarens eget val ÄR facit — rapportera det (eld-och-glöm, admin-only).
 * En korrigering i kandidatlistan betyder att användaren tittat på det fysiska
 * kortet och pekat ut rätt rad; en oförändrad tillägg-till-samlingen är en
 * bekräftelse. Bägge landar i admin-diagnostiken och läses av scoreboardet —
 * utan detta försvann rättelsen i klienten och facit fick skrivas för hand.
 */
function reportScanFeedback(
  jobId: string | null | undefined,
  cardId: string,
  kind: "corrected" | "confirmed"
) {
  if (!jobId) return;
  fetch("/api/scanner/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, cardId, kind }),
  }).catch(() => {
    // Facit är trevligt att ha, aldrig värt ett felmeddelande i skannerflödet.
  });
}

const CONDITIONS = [
  { value: "MINT", label: "Mint" },
  { value: "NEAR_MINT", label: "Near Mint" },
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "PLAYED", label: "Played" },
  { value: "POOR", label: "Poor" },
] as const;

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(
  CONDITIONS.map((c) => [c.value, c.label])
);

const CAPTURE_MAX = 1280; // px bredd på fångad ruta — högre = tydligare korttext för OCR
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MIN_MATCH_CONF = 0.2;

type CameraState = "starting" | "live" | "error" | "unsupported";
type View = "capture" | "review";
/** Skanningslägen. Se `mode`-state i Scanner för varför det är ETT fält. */
type ScanMode = "single" | "bulk" | "barcode";

let scanCounter = 0;
const nextId = () => `scan-${Date.now()}-${scanCounter++}`;

/** Skalar ner en uppladdad bild till samma storlek som kamerarutorna (längsta sida
 *  ≤ CAPTURE_MAX). Råa mobilfoton (8 MB → ~11 MB base64) sprängde API-routens
 *  storleksgräns OCH kostade onödigt många vision-tokens per skanning. */
function downscaleDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, CAPTURE_MAX / longest);
      if (scale === 1 && dataUrl.startsWith("data:image/jpeg")) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Marginal runt kortramen vid beskärning — hellre lite bakgrund än ett kapat hörn. */
const CROP_PAD = 0.06;

/** Andel av kortets höjd som skickas som närbild på nederkanten (numret bor där). */
const STRIP_FRACTION = 0.22;

/** Längsta sida på den yta konstavtrycket räknas ur. Boxmedelvärdet är i praktiken
 *  upplösningsokänsligt (testat: 0,99+ mellan 245×342 och 914×1280), så det här
 *  behöver bara vara rikligt över rutnätet — inte fullt fångstformat, eftersom
 *  `getImageData` på 4,7 MP kostar tid på telefonen utan att ändra svaret. */
const FINGERPRINT_SOURCE_MAX = 640;

/** Antal videorutor per slutartryck som konstavtrycket räknas på. Fyra (höjt
 *  från tre 2026-07-31, servern tar max fyra): per-ruta-brus (moiré, oskärpa)
 *  flippade valet mellan namntvillingar när bilden bara ibland såg rätt kort —
 *  en ruta till ger den mest AVGÖRANDE rutan (störst marginal) fler chanser. */
const CAPTURE_FRAMES = 4;

/**
 * Fångar en nedskalad JPEG-ruta ur videoflödet (i minnet, ej i kamerarullen),
 * BESKUREN till kortramen användaren siktat med.
 *
 * VARFÖR BESKÄRNINGEN FINNS (2026-07-29): funktionen skickade hela videorutan,
 * trots att overlayen ber användaren lägga kortet i en ram som täcker ungefär en
 * tredjedel av ytan. Två tredjedelar av de vision-tokens vi betalade för var
 * alltså skrivbord, hand och bakgrund — och kortet självt fick bara ~0,4 MP av
 * bildbudgeten. Det spelar roll för att det ENDA som avgör vilket kort det är
 * (samlarnumret) trycks i ~10 px hög text: 92 % av katalogens kort delar namn med
 * ett annat kort, så läses inte numret finns ingen identitet kvar att matcha på.
 *
 * Beskärningen ger kortet i stort sett hela bildbudgeten — ca 2,7× fler pixlar på
 * kortet till EXAKT samma token-kostnad, eftersom utsnittet skalas till samma
 * längsta sida som förut.
 *
 * Geometrin MÄTS (`getBoundingClientRect`) i stället för att räkna på overlayens
 * `w-[68%]`/`mb-[14vh]`: hårdkodade tal här hade tyst börjat beskära fel dagen
 * någon rör ramens storlek, och ett fel utsnitt kapar numret — värre än ingen
 * beskärning alls. Saknas ramen faller vi tillbaka på hela rutan.
 */
function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameEl?: HTMLElement | null,
  /** Live-pollen behöver BARA avtrycken — JPEG-kodningen (toDataURL ×2, det
   *  dyra steget, ~30–60 ms) hoppas över helt. dataUrl blir då "". */
  fpOnly = false
): {
  dataUrl: string;
  fingerprints: string[];
  /** Strukturavtryck, positionsparade med fingerprints (samma inset-ordning). */
  structFingerprints: string[];
  stripDataUrl?: string;
  crop: string;
} | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const vW = video.videoWidth;
  const vH = video.videoHeight;

  // Utsnitt i KÄLLPIXLAR. Utgångsläge = hela rutan.
  let sx = 0;
  let sy = 0;
  let sw = vW;
  let sh = vH;
  // Kortramen UTAN marginal — bara för konstavtrycket.
  let fx = 0;
  let fy = 0;
  let fw = vW;
  let fh = vH;

  const box = video.getBoundingClientRect();
  const frame = frameEl?.getBoundingClientRect();
  if (frame && frame.width > 0 && frame.height > 0 && box.width > 0 && box.height > 0) {
    // `object-cover`: videon skalas så den TÄCKER elementet och centrumbeskärs.
    // Samma matte måste göras baklänges för att hitta ramen i källpixlar.
    const cover = Math.max(box.width / vW, box.height / vH);
    const offX = (vW * cover - box.width) / 2;
    const offY = (vH * cover - box.height) / 2;
    const padX = frame.width * CROP_PAD;
    const padY = frame.height * CROP_PAD;
    const left = (frame.left - box.left - padX + offX) / cover;
    const top = (frame.top - box.top - padY + offY) / cover;
    const width = (frame.width + padX * 2) / cover;
    const height = (frame.height + padY * 2) / cover;
    // Klamra innanför källbilden — ramen kan sticka utanför på extrema format.
    sx = Math.max(0, Math.min(left, vW - 1));
    sy = Math.max(0, Math.min(top, vH - 1));
    sw = Math.max(1, Math.min(width, vW - sx));
    sh = Math.max(1, Math.min(height, vH - sy));
    // Ramen UTAN marginal = kortet självt. Konstavtrycket måste räknas på DEN
    // ytan, inte på den marginalförsedda — se kommentaren vid fingerprint nedan.
    fx = Math.max(0, Math.min((frame.left - box.left + offX) / cover, vW - 1));
    fy = Math.max(0, Math.min((frame.top - box.top + offY) / cover, vH - 1));
    fw = Math.max(1, Math.min(frame.width / cover, vW - fx));
    fh = Math.max(1, Math.min(frame.height / cover, vH - fy));
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // KONSTAVTRYCK: 264 byte som identifierar kortet på utseende. Servern söker det
  // mot hela katalogen i minnet — klienten laddar aldrig ner något index, den
  // skickar 264 byte uppåt.
  //
  // ⛔ RÄKNAS PÅ RAMEN UTAN MARGINAL (fx/fy/fw/fh), ALDRIG på det marginal-
  // försedda utsnittet. Indexet är byggt på katalogbilder som är EXAKT kortet;
  // fångsten har `CROP_PAD` bakgrund runt om, och vid ett 8×11-rutnät smittar den
  // ytterringen 34 av 88 celler. MÄTT på Falinks TG07 (hård försämring):
  //   utan marginal   plats 1, likhet 0,989
  //   + 6 % marginal  UTANFÖR topp-15, bästa träff 0,547
  //   inre 88 %       plats 1, likhet 0,989
  // Marginalen ensam gjorde alltså kortet omöjligt att hitta. Revisionen missade
  // det för att dess simulerade felbeskärning skär IN i kortet i stället för att
  // lägga till bakgrund runt om — den försämringen finns nu med i profilerna.
  // INSET-SVEP: samma yta beskuren flera gånger, så träffsäkerheten inte hänger
  // på att kortet ligger exakt i ramen. Ett enda avtryck ger topp-15 9 % vid 6 %
  // marginal; svepet ger 97 %. Se FINGERPRINT_INSETS.
  const fpScale = Math.min(1, FINGERPRINT_SOURCE_MAX / Math.max(fw, fh));
  const fpW = Math.max(1, Math.round(fw * fpScale));
  const fpH = Math.max(1, Math.round(fh * fpScale));
  canvas.width = fpW;
  canvas.height = fpH;
  ctx.drawImage(video, fx, fy, fw, fh, 0, 0, fpW, fpH);
  // EN läsning av pixlarna, sedan billiga loopar per inset — getImageData är det
  // dyra steget, inte boxmedelvärdet.
  const fpPixels = ctx.getImageData(0, 0, fpW, fpH).data;
  const toB64 = (fp: Int8Array) => {
    let bin = "";
    for (let i = 0; i < fp.length; i++) bin += String.fromCharCode(fp[i] & 0xff);
    return btoa(bin);
  };
  // FÄRG + STRUKTUR ur samma pixelläsning, positionsparade per inset — servern
  // parar dem på index, så ett inset tas bara med när BÅDA gick att räkna.
  // Strukturavtrycket är det som räddar SKÄRMFOTO-fallet (belysningsimmuna
  // särdrag; topp-15 38,5 % → 97,1 %, se src/lib/art-fingerprint.ts).
  const fingerprints: string[] = [];
  const structFingerprints: string[] = [];
  for (const inset of FINGERPRINT_INSETS) {
    const fp = fingerprintFromRgb(fpPixels, fpW, fpH, 4, inset);
    const sfp = structFingerprintFromRgb(fpPixels, fpW, fpH, 4, inset);
    if (!fp || !sfp) continue;
    fingerprints.push(toB64(fp));
    structFingerprints.push(toB64(sfp));
  }
  // OUTSET-SVEP — spegelbilden av inset-svepet (mätt fall 2026-07-30): när
  // kortet är STÖRRE än ramen är utsnittet en DEL av kortet, och referenserna
  // är hela kort — då kan ingen deskriptor matcha, och inseten beskär bara
  // ännu längre IN. Två UTVIDGADE regioner (ram × 1,2 / 1,45, klamrade mot
  // videokanten) täcker överflödesfallet; servern tar ändå bästa varianten
  // per kort. 4 inset + 2 outset = 6 ≤ API-taket 8 per ruta.
  // Bredaste utsnittet sparas som källa för quad-rätningen nedan: kortet kan
  // ligga snett ÖVER ramkanten, och då måste detekteringen se utanför ramen.
  let rectSource: { px: Uint8ClampedArray; w: number; h: number } | null = null;
  for (const grow of [0.2, 0.45]) {
    const ox = Math.max(0, fx - (fw * grow) / 2);
    const oy = Math.max(0, fy - (fh * grow) / 2);
    const ow = Math.min(vW - ox, fw * (1 + grow));
    const oh = Math.min(vH - oy, fh * (1 + grow));
    if (ow <= fw || oh <= fh) continue; // ramen täcker redan videon — inget att utvidga
    const oScale = Math.min(1, FINGERPRINT_SOURCE_MAX / Math.max(ow, oh));
    const oW = Math.max(1, Math.round(ow * oScale));
    const oH = Math.max(1, Math.round(oh * oScale));
    canvas.width = oW;
    canvas.height = oH;
    ctx.drawImage(video, ox, oy, ow, oh, 0, 0, oW, oH);
    const oPixels = ctx.getImageData(0, 0, oW, oH).data;
    rectSource = { px: oPixels, w: oW, h: oH };
    const fp = fingerprintFromRgb(oPixels, oW, oH, 4);
    const sfp = structFingerprintFromRgb(oPixels, oW, oH, 4);
    if (!fp || !sfp) continue;
    fingerprints.push(toB64(fp));
    structFingerprints.push(toB64(sfp));
  }

  // QUAD-RÄTNING (Fas 1, 2026-07-31): hitta kortets fyra hörn och perspektiv-
  // räta till kortets kanoniska 63:88 — samma geometri som referensbilderna.
  // MÄTT i harnesset (rectify-eval.ts) innan ship; varianten LÄGGS TILL svepet
  // (7:e avtrycket, ≤ API-taket 8), ersätter det inte: servern tar ändå bästa
  // varianten per kort, så en felaktig varp kan aldrig göra resultatet sämre —
  // och misslyckad detektering (null) lämnar fångsten exakt som förut.
  const rs = rectSource ?? { px: fpPixels, w: fpW, h: fpH };
  const quad = detectCardQuad(rs.px, rs.w, rs.h, 4);
  if (quad) {
    const warped = warpPerspective(rs.px, rs.w, rs.h, 4, quad.corners);
    if (warped) {
      const fp = fingerprintFromRgb(warped, RECTIFIED_W, RECTIFIED_H, 4);
      const sfp = structFingerprintFromRgb(warped, RECTIFIED_W, RECTIFIED_H, 4);
      if (fp && sfp) {
        fingerprints.push(toB64(fp));
        structFingerprints.push(toB64(sfp));
      }
    }
  }

  if (fpOnly) {
    return { dataUrl: "", fingerprints, structFingerprints, crop: "" };
  }

  // Bilden till modellen: MED marginal, så ett snett kort inte tappar numret.
  const scale = Math.min(1, CAPTURE_MAX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

  // NÄRBILD PÅ NEDERKANTEN. Mätt 2026-07-29 på en Trainer Gallery-Falinks med
  // gott om upplösning (ström 2160×3840, utsnitt 1349×1889): modellen svarade
  // "110" — kortets HP, tryckt STORT uppe till höger — i stället för TG05/TG30
  // nere till vänster. Felet var alltså inte att texten var oläslig utan att
  // modellen letade på fel ställe: på ett full-art-kort är samlarnumret det
  // minsta och minst kontrastrika talet av flera konkurrerande tal (HP,
  // attackskada, årtal). En egen bild av bara nederkanten tar bort valet —
  // HP finns inte i den, så det går inte att förväxla.
  // Hela bredden med flit: moderna kort har numret nere till VÄNSTER, äldre
  // nere till HÖGER. Utsnittet tas ur videon i NATIV upplösning, inte ur den
  // redan nedskalade canvasen, annars vore närbilden bara en uppförstoring.
  const stripSh = sh * STRIP_FRACTION;
  const stripSy = sy + sh - stripSh;
  const stripScale = Math.min(1, CAPTURE_MAX / sw);
  const stripW = Math.max(1, Math.round(sw * stripScale));
  const stripH = Math.max(1, Math.round(stripSh * stripScale));
  canvas.width = stripW;
  canvas.height = stripH;
  const stripCtx = canvas.getContext("2d");
  stripCtx?.drawImage(video, sx, stripSy, sw, stripSh, 0, 0, stripW, stripH);
  const stripDataUrl = stripCtx ? canvas.toDataURL("image/jpeg", 0.85) : undefined;

  return {
    dataUrl,
    fingerprints,
    structFingerprints,
    stripDataUrl,
    // Utsnitt i KÄLLpixlar → skickad storlek. Står källan under den skickade
    // storleken skalar vi UPP, dvs modellen får interpolerade pixlar och ingen
    // ny information — då är kameran flaskhalsen, inte modellen.
    crop: `${Math.round(sw)}×${Math.round(sh)}→${w}×${h}+${stripW}×${stripH}`,
  };
}

// ---- BULK-FÅNGST (2026-08-01, FRILAGD v2 samma dag): en bild, många kort ----
//
// v1 använde en 3×3-rutnätsguide; ägarens bordstest visade att fasta celler
// beskär fel när korten inte ligger exakt i rutorna. v2 DETEKTERAR korten i
// stället (detectCardRegions: bakgrundssegmentering + sammanhängande
// komponenter — bordet skattas ur bildens kantring) och kör varje funnen
// region genom exakt samma maskineri som enkelskanningen: kvad-rätning,
// inset-svep, färg+struktur-avtryck. Ingen guide, inga fasta celler — bara
// "sprid ut korten med lite mellanrum".
//
// ⛔ INGA OUTSETS i bulk: utvidgas en region kan GRANNKORTET blöda in i
// utsnittet och avtrycket matchar en blandning av två kort. Kvad-rätningen
// per region tar snedlagda kanter i stället (padding 5 %).
/** Kvad-källans marginal runt regionen — liten med flit (grannkort!). */
const BULK_CELL_PAD = 0.05;
/** Färre inset än enkelskanningen: regionerna är tajta och outsets förbjudna. */
const BULK_INSETS = [0, 0.04, 0.08] as const;
/** Detekteringsbildens långsida. Regionerna behöver bara vara ungefärliga —
 *  detectCardRegions skalar ändå ner till sin egen maskbredd — MEN det är den
 *  här bilden som sparas som felsökningsbild för admin, och den är det ENDA vi
 *  kan mäta på i efterhand.
 *  ⛔ 480 var för lågt för att ens KUNNA mäta: två kort med ~4,5 px springa här
 *  hamnar på 1–2 maskpixlar, springan smetas ihop med kortens kanter och de två
 *  korten blir EN region (fältrunda 5, 2026-08-01: 5 av 6 kort). Om den fixen
 *  är att höja maskupplösningen måste den valideras mot en fångst som fortfarande
 *  BÄR detaljen — vid 480 är informationen redan kastad, och ett offline-försök
 *  med högre mask mätte bara brus (7 regioner, falska).
 *  Höjningen ändrar INTE detekteringen i sig (masken är fortfarande 240, bara
 *  bättre medelvärdesbildad); den gör nästa fältrunda mätbar. */
const BULK_DETECT_MAX = 960;
const BULK_MAX_CARDS = 12;

interface BulkCell {
  /** Cellens utsnitt (med liten marginal) — vision-bild + miniatyr. */
  dataUrl: string;
  /** Nederkanten av cellen — samlarnumret, samma idé som enkelskanningens strip. */
  stripDataUrl?: string;
  fingerprints: string[];
  structFingerprints: string[];
}

function captureBulkCells(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): { cells: BulkCell[]; debugImage: string; video: string; busySurface: boolean } | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const vW = video.videoWidth;
  const vH = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // 1. DETEKTERA korten i hela rutan (nedskalad analysbild — regionerna
  //    behöver bara vara ungefärliga; precisionen kommer ur kvad-rätningen).
  const dScale = Math.min(1, BULK_DETECT_MAX / Math.max(vW, vH));
  const dW = Math.max(64, Math.round(vW * dScale));
  const dH = Math.max(64, Math.round(vH * dScale));
  canvas.width = dW;
  canvas.height = dH;
  ctx.drawImage(video, 0, 0, vW, vH, 0, 0, dW, dH);
  const detectPixels = ctx.getImageData(0, 0, dW, dH).data;
  // Diagnostiken bär domen om UNDERLAGET: på ett mönstrat underlag stoppas
  // bakgrundsfyllningen av mönstret, underlaget blir självt förgrund och korten
  // hamnar inuti den massan. Då är varje "region" en bit av underlaget, och att
  // skicka dem vidare kostar vision-anrop och kvot på rena gissningar.
  const regionDiag: RegionDiag = {};
  const regions = detectCardRegions(detectPixels, dW, dH, 4, BULK_MAX_CARDS, regionDiag);
  const busySurface = regionDiag.busySurface === true;
  // Detekteringsbilden följer med även när INGET hittas — det är just
  // misslyckandena som ska gå att felsöka mot verkligheten (admin-only,
  // se /api/scanner/identify-bulk).
  const debugImage = canvas.toDataURL("image/jpeg", 0.7);
  // Kamerans FAKTISKA upplösning: cellernas bild till vision och avtrycken tas
  // ur videorutan, inte ur felsökningsbilden, så det är HÄR pixelbudgeten per
  // kort avgörs. Utan den här raden går det inte att veta om en dålig cell är
  // pixelsvält eller något annat (getUserMedia BEGÄR 4K men får vad den får).
  const videoSize = `${vW}x${vH}`;
  if (regions.length === 0) return { cells: [], debugImage, video: videoSize, busySurface };
  const rInv = 1 / dScale;

  const toB64 = (fp: Int8Array) => {
    let bin = "";
    for (let i = 0; i < fp.length; i++) bin += String.fromCharCode(fp[i] & 0xff);
    return btoa(bin);
  };

  // 2. Varje region genom SAMMA per-kort-maskineri som enkelskanningen.
  const cells: BulkCell[] = [];
  for (const region of regions) {
    {
      // Regionen UTAN marginal — avtryckets yta (samma regel som enkelramen).
      const fx = Math.max(0, Math.min(region.x * rInv, vW - 1));
      const fy = Math.max(0, Math.min(region.y * rInv, vH - 1));
      const fw = Math.max(1, Math.min(region.w * rInv, vW - fx));
      const fh = Math.max(1, Math.min(region.h * rInv, vH - fy));

      const fpScale = Math.min(1, FINGERPRINT_SOURCE_MAX / Math.max(fw, fh));
      const fpW = Math.max(1, Math.round(fw * fpScale));
      const fpH = Math.max(1, Math.round(fh * fpScale));
      canvas.width = fpW;
      canvas.height = fpH;
      ctx.drawImage(video, fx, fy, fw, fh, 0, 0, fpW, fpH);
      const fpPixels = ctx.getImageData(0, 0, fpW, fpH).data;

      const fingerprints: string[] = [];
      const structFingerprints: string[] = [];
      for (const inset of BULK_INSETS) {
        const fp = fingerprintFromRgb(fpPixels, fpW, fpH, 4, inset);
        const sfp = structFingerprintFromRgb(fpPixels, fpW, fpH, 4, inset);
        if (!fp || !sfp) continue;
        fingerprints.push(toB64(fp));
        structFingerprints.push(toB64(sfp));
      }

      // Cellen MED liten marginal: kvad-källa + vision-bild + miniatyr.
      const px = Math.max(0, fx - fw * BULK_CELL_PAD);
      const py = Math.max(0, fy - fh * BULK_CELL_PAD);
      const pw = Math.min(vW - px, fw * (1 + BULK_CELL_PAD * 2));
      const ph = Math.min(vH - py, fh * (1 + BULK_CELL_PAD * 2));
      const pScale = Math.min(1, FINGERPRINT_SOURCE_MAX / Math.max(pw, ph));
      const pW = Math.max(1, Math.round(pw * pScale));
      const pH = Math.max(1, Math.round(ph * pScale));
      canvas.width = pW;
      canvas.height = pH;
      ctx.drawImage(video, px, py, pw, ph, 0, 0, pW, pH);
      const padPixels = ctx.getImageData(0, 0, pW, pH).data;
      const quad = detectCardQuad(padPixels, pW, pH, 4);
      if (quad) {
        const warped = warpPerspective(padPixels, pW, pH, 4, quad.corners);
        if (warped) {
          const fp = fingerprintFromRgb(warped, RECTIFIED_W, RECTIFIED_H, 4);
          const sfp = structFingerprintFromRgb(warped, RECTIFIED_W, RECTIFIED_H, 4);
          if (fp && sfp) {
            fingerprints.push(toB64(fp));
            structFingerprints.push(toB64(sfp));
          }
        }
      }

      // Vision-bilden i cellens NATIVA upplösning (≤ CAPTURE_MAX) — vid 4K-ström
      // är en cell ~1200 px bred, gott om pixlar för namnet. Strip = nederkanten.
      const vScale = Math.min(1, CAPTURE_MAX / Math.max(pw, ph));
      const cW = Math.max(1, Math.round(pw * vScale));
      const cH = Math.max(1, Math.round(ph * vScale));
      canvas.width = cW;
      canvas.height = cH;
      ctx.drawImage(video, px, py, pw, ph, 0, 0, cW, cH);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const stripSh = ph * STRIP_FRACTION;
      const stripSy = py + ph - stripSh;
      const stripW = cW;
      const stripH = Math.max(1, Math.round(stripSh * vScale));
      canvas.width = stripW;
      canvas.height = stripH;
      ctx.drawImage(video, px, stripSy, pw, stripSh, 0, 0, stripW, stripH);
      const stripDataUrl = canvas.toDataURL("image/jpeg", 0.85);

      cells.push({ dataUrl, stripDataUrl, fingerprints, structFingerprints });
    }
  }
  return { cells, debugImage, video: videoSize, busySurface };
}

// Klient-gate: utloggad → redirecta till login I APPEN (router.replace = SPA-nav,
// ingen hård navigering som Capacitor kastar till Safari). Scanner monteras (och
// kameran startar) först när inloggning bekräftats, så ingen kamera-flash.
export default function SkannaPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Kör EN gång ([] deps). Med [router] kunde detta re-köras när kamera-permission
  // beviljas (→ re-render → instabil router-ref) och router.replace loopa = flimmer.
  useEffect(() => {
    if (hasAuthHint()) setAuthed(true);
    else router.replace("/logga-in?callbackUrl=/skanna");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!authed) return null;
  return <Scanner />;
}

function Scanner() {
  const t = useTranslations("Scanner");
  const { toast } = useToast();
  const router = useRouter();

  // Skannern är `fixed inset-0 z-[60]` och lägger sig över HELA appen. Produkt-
  // overlayn ligger på z-40, så "Visa produkt" härifrån öppnade den UNDER
  // kameravyn — den monterades och hämtade sitt data, men användaren såg
  // ingenting hända. Anmälan lyfter overlayn över oss så länge skannern lever;
  // scan-listan ligger kvar i state bakom den och svep-tillbaka avtäcker den.
  useEffect(() => registerFullscreenHost(), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Kortramen i kameravyn — captureFrame mäter den för att beskära utsnittet.
  const frameRef = useRef<HTMLDivElement>(null);
  /**
   * SKANNINGSLÄGE — ETT state, inte tre flaggor.
   *
   * "single"  = enkelram + live-lås + auto-fångst (kort).
   * "bulk"    = frilagd flerkortsdetektering på bordsyta (kort, PRO).
   * "barcode" = streckkodsläsning för FÖRSEGLADE produkter (askar har ingen
   *             konstbild att matcha mot, men de bär tillverkarens GTIN).
   *
   * ⛔ Ett enda `mode` i stället för `bulkMode`/`barcodeMode` som separata
   * booleaner: två booleaner har fyra tillstånd varav ett ("båda på") är
   * meningslöst men fullt möjligt att hamna i. Lägena UTESLUTER varandra —
   * de tävlar om samma videoruta, samma slutare och samma poll-loop.
   */
  const [mode, setMode] = useState<ScanMode>("single");
  // Härledda alias: läsbarheten i JSX:en nedan bygger på dem, och de gör att
  // varje läges avstängningsvillkor står i klartext i sina effekter.
  const bulkMode = mode === "bulk";
  const barcodeMode = mode === "barcode";

  // FICKLAMPA + ZOOM-FÖRVAL. Hooken rör ALDRIG strömmens livscykel — den läser
  // kapabiliteter ur spåret och applicerar constraints. Kräver ett förval en
  // annan kamera (0,5× = ultravidvinkeln, en egen enhet på de flesta telefoner)
  // svarar den `needs-stream-restart` och VI öppnar om strömmen, se onZoom.
  const camera = useCameraControls();

  // Streckkodsläget döljs helt där plattformen inte kan läsa koder (iOS/WebKit
  // har ingen BarcodeDetector). En knapp som bevisligen inte fungerar är sämre
  // än ingen knapp — samma regel som zoom-förvalen följer.
  const [canScanBarcodes, setCanScanBarcodes] = useState(false);
  useEffect(() => setCanScanBarcodes(barcodeSupported()), []);
  // Admin: bulk-fångstens detekteringsbild sparas för felsökning mot verkliga foton.
  const isAdmin = useIsAdmin();
  // DIAGNOSTIK (bara admin, se ScanDebug): kamerans verkliga upplösning, senaste
  // utsnitt och vad modellen faktiskt svarade. Utan det här är "skannern gissar
  // fel" ett påstående ingen kan felsöka — vi ser varken vad kameran gav oss
  // eller vad modellen läste, så varje åtgärd blir en gissning.
  const [streamInfo, setStreamInfo] = useState<string | null>(null);
  const [cropInfo, setCropInfo] = useState<string | null>(null);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [view, setView] = useState<View>("capture");
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState("");
  const [provider, setProvider] = useState<string | null>(null);

  const [scans, setScans] = useState<ScanItem[]>([]);
  // LIVE-LÅSET: bildmatchningens bästa gissning medan användaren siktar,
  // uppdaterad ~2×/s via /identify-art (inga vision-anrop, ingen kvot).
  // "locked" = tre på varandra följande rutor pekar på SAMMA kort och den
  // senaste klarade trust-regeln — det är konkurrenternas "millisekundkänsla".
  const [liveHint, setLiveHint] = useState<{
    name: string;
    number: string;
    locked: boolean;
  } | null>(null);
  const liveStreak = useRef<{ id: string; n: number }>({ id: "", n: 0 });
  const livePollBusy = useRef(false);
  // AUTO-FÅNGST: låset (100 % uppmätt precision) som hållit i ≥2 extra pollar
  // (~1,2 s stadigt sikte) trycker av åt användaren — pärmflödet blir
  // "håll kort → grönt → klick av sig självt → nästa". EN fångst per kort:
  // autoFired spärrar tills ett ANNAT kort ses i ramen. Manuell slutare orörd.
  const lockedPolls = useRef(0);
  const autoFired = useRef<string | null>(null);
  // Färska referenser — poll-effekten ska inte binda om sig varje gång
  // capture-callbacken eller kvot-staten byter identitet.
  const captureRef = useRef<(() => void) | null>(null);
  const quotaRef = useRef<ScanQuota | null>(null);
  const [flash, setFlash] = useState(false);
  const [shutterCooling, setShutterCooling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultCondition, setDefaultCondition] = useState("NEAR_MINT");
  // Skannern är endast engelska — inget språkval.
  const defaultLanguage = "EN";
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const [addingAll, setAddingAll] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [quota, setQuota] = useState<ScanQuota | null>(null);

  // Hämta kvoten när skannern öppnas (badge: "X skanningar kvar").
  useEffect(() => {
    let active = true;
    fetch("/api/scanner/quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.remaining === "number") setQuota(d as ScanQuota);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const isMock = provider === "mock";

  const matched = useMemo(
    () => scans.filter((s) => s.status === "matched" && s.match),
    [scans]
  );
  const noMatchCount = useMemo(
    () => scans.filter((s) => s.status === "nomatch" || s.status === "error").length,
    [scans]
  );
  const total = useMemo(
    () =>
      matched.reduce(
        (sum, s) => sum + (s.match?.estimatedValue ?? 0) * s.quantity,
        0
      ),
    [matched]
  );

  // ---- Identifiering -------------------------------------------------------

  const runIdentify = useCallback(
    async (
      dataUrl: string,
      strip?: string,
      fingerprintFrames?: string[][],
      structFrames?: string[][]
    ): Promise<IdentifyResponse | { error: string; httpStatus?: number }> => {
      try {
        // Standard = billiga Haiku-modellen (ingen `precise`) — håller scan-kostnaden
        // mot Pro-priset. Sonnet körs bara på uttryckligt "försök igen, skarpare".
        const res = await fetch("/api/scanner/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `detail` = närbild på kortets nederkant. Saknas den (galleriuppladdning,
          // där vi inte vet var kortet sitter i bilden) körs det som förut.
          body: JSON.stringify({
            image: dataUrl,
            detail: strip,
            fingerprintFrames,
            structFrames,
          }),
        });
        const data = (await res.json()) as IdentifyResponse & { error?: string };
        if (!res.ok) {
          // Statuskoden följer med: 429 (slut på kvoten) ska INTE se ut som
          // "ingen träff" — det var mätbart förvirrande när gränsen slog till.
          return { error: data.error ?? t("genericError"), httpStatus: res.status };
        }
        setProvider(data.provider);
        // Rådata från modellen, INTE den matchade kandidaten: det är skillnaden
        // mellan "modellen läste fel" och "modellen läste rätt men slagningen
        // valde fel kort", och de två har helt olika åtgärder.
        setOcrInfo(
          // `era` = modellens ramgenerations-klassning — utan den i raden går
          // det inte att se om ett epokfel kom från modellen eller poängen.
          `${data.provider} · "${data.guessedName ?? ""}" / "${data.guessedNumber ?? ""}" · era ${data.guessedEra ?? "—"} · hp ${data.guessedHp ?? "—"} · konf ${data.confidence.toFixed(2)}` +
            // `bild` skiljer "avtrycket skickades inte / indexet är tomt" (—) från
            // "det matchade svagt" (lågt tal). Utan det går de två inte att skilja.
            // Bildens EGNA toppträffar, inte bara poängen: annars går det inte
            // att skilja "bilden hittade rätt kort men namnet överröstade det"
            // från "bilden hittade också fel".
            ` · bild ${data.artTop == null ? "—" : data.artTopLabel ?? data.artTop.toFixed(3)}`
        );
        return data;
      } catch {
        return { error: t("genericError") };
      }
    },
    [t]
  );

  const identifyInto = useCallback(
    async (
      id: string,
      dataUrl: string,
      strip?: string,
      fingerprintFrames?: string[][],
      structFrames?: string[][]
    ) => {
      const data = await runIdentify(dataUrl, strip, fingerprintFrames, structFrames);
      if (!("error" in data) && typeof data.remaining === "number") {
        const r = data.remaining;
        setQuota((q) => (q ? { ...q, remaining: r } : q));
      }
      // Slut på kvoten = ett tydligt besked, inte ett tyst "ingen träff" per
      // skanning. Toasten syns i kameravyn där användaren faktiskt står.
      if ("error" in data && data.httpStatus === 429) {
        toast({ title: data.error, variant: "error" });
      }
      setScans((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          if ("error" in data) return { ...s, status: "error", errorMessage: data.error };
          const top = data.candidates[0];
          // Oavgjort mellan olika KORT betyder INTE "ingen träff" — förslaget är
          // fortfarande det bästa vi har och mer användbart än ingenting. Det
          // MÄRKS i stället (uncertain), så användaren vet att den ska kollas.
          // (Första versionen gjorde tvärtom och de flesta kort blev "ingen
          // träff", vilket är sämre än en märkt gissning.)
          if (top && data.confidence >= MIN_MATCH_CONF) {
            return {
              ...s,
              status: "matched",
              match: top,
              candidates: data.candidates,
              confidence: data.confidence,
              uncertain: data.ambiguous,
              jobId: data.jobId ?? null,
            };
          }
          return { ...s, status: "nomatch", candidates: data.candidates, jobId: data.jobId ?? null };
        })
      );
    },
    [runIdentify, toast]
  );

  // ---- Kamera --------------------------------------------------------------

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    camera.attach(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [camera]);

  /**
   * @param deviceId Öppna en SPECIFIK kamera i stället för den bakre standarden.
   *   Används av 0,5×-förvalet: ultravidvinkeln är på de flesta telefoner en EGEN
   *   enhet, inte ett zoom-värde, så förvalet kräver att strömmen öppnas om.
   *   `withDeviceId` släpper `facingMode` när ett exakt id sätts — de två kan
   *   motsäga varandra och ge OverconstrainedError.
   */
  const startCamera = useCallback(async (deviceId?: string) => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("starting");
    setCameraError("");
    try {
      // UPPLÖSNINGEN MÅSTE BEGÄRAS. Utan width/height väljer webbläsaren själv,
      // och standarden är typiskt 640×480. Räkna på vad det betyder: videon
      // visas `object-cover` i en portrait-vy, kortramen tar ~44 % av höjden →
      // kortet får ~0,44 × 480 = 211 källpixlar på höjden, och samlarnumret
      // (~2 mm på ett 88 mm kort) blir ~5 px högt. Ingen modell läser det, och
      // beskärningen kan inte rädda det — den skalar UPP en bild som aldrig
      // innehöll detaljen. Vid 2160p blir samma siffra ~22 px.
      // `ideal` (inte `exact`) → enheter som inte klarar 4K faller tillbaka
      // själva i stället för att kastas ut med OverconstrainedError.
      const baseVideo: MediaTrackConstraints = {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? withDeviceId(baseVideo, deviceId) : baseVideo,
        audio: false,
      });
      streamRef.current = stream;
      // Kamerakontrollerna (ficklampa/zoom) läser kapabiliteter ur SPÅRET, och
      // spåret byts vid varje omstart — attach är därför obligatorisk här, inte
      // en engångsuppkoppling. Hooken applicerar också ett väntande zoom-förval
      // när den nya strömmen kommer in (0,5×-omstarten).
      camera.attach(stream);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      // Vad vi FAKTISKT fick — begäran är ett önskemål, inte ett löfte.
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setStreamInfo(
        settings?.width && settings?.height ? `${settings.width}×${settings.height}` : "okänd"
      );
      setCameraState("live");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? t("cameraDenied")
          : name === "NotFoundError"
            ? t("cameraNotFound")
            : t("cameraFailed")
      );
      setCameraState("error");
    }
  }, [t, camera]);

  /**
   * Zoom-förval. De flesta byten är ett rent `applyConstraints` på spåret, men
   * 0,5× är oftast ETT ANNAT OBJEKTIV — en egen enhet i `enumerateDevices()`,
   * inte ett zoom-värde. Då svarar hooken `needs-stream-restart` med enhetens
   * id och strömmen öppnas om här. Hooken applicerar sitt väntande förval själv
   * när den nya strömmen attachas.
   *
   * ⛔ Omstarten görs BARA på den signalen. Att öppna om kameran vid varje
   * zoom-byte hade svartat bilden i en halv sekund på telefoner som klarar
   * bytet med en constraint — och det är de flesta.
   */
  const onZoom = useCallback(
    async (preset: ZoomPreset) => {
      const res = await camera.applyZoom(preset);
      if (res.ok || res.reason !== "needs-stream-restart") return;
      stopCamera();
      await startCamera(res.deviceId);
    },
    [camera, stopCamera, startCamera]
  );

  // Returnerar false om stängningen avbröts (osparade träffar) → svep-gesten
  // fjädrar tillbaka i stället för att lämna skannern osynlig utanför skärmen.
  const closeScanner = useCallback((): boolean => {
    if (scans.length > 0 && addedCount === null) {
      const ok = window.confirm(t("unsavedConfirm", { count: scans.length }));
      if (!ok) return false;
    }
    stopCamera();
    // Skannern ÄR fliken nu → stäng = lämna fliken (router, ej hård nav i Capacitor).
    router.back();
    return true;
  }, [scans.length, addedCount, stopCamera, router, t]);

  // Stoppa kameran när komponenten lämnas helt.
  useEffect(() => () => stopCamera(), [stopCamera]);

  // Öppna kameran när capture-vyn visas OCH återanslut strömmen om videon
  // monterats om (review→capture monterar ett nytt <video> → annars svart bild).
  useEffect(() => {
    if (view !== "capture") return;
    const v = videoRef.current;
    if (streamRef.current) {
      if (v && v.srcObject !== streamRef.current) {
        v.srcObject = streamRef.current;
        void v.play().catch(() => undefined);
      }
    } else {
      void startCamera();
    }
  }, [view, startCamera]);

  // LIVE-POLLEN: fingeravtryck ur aktuell videoruta ~var 600:e ms medan
  // kameravyn är aktiv. Varje poll är ~1 kB upp och ~40 ms server-CPU mot
  // indexet i minnet — ingen bild, ingen modell, ingen kvot. En poll i taget
  // (busy-ref) så en seg lina inte staplar förfrågningar.
  useEffect(() => {
    // Bulk-läget pollar inte: låset/chippen är enkortsbegrepp, och 9 celler
    // × 2 poll/s hade varit CPU utan mottagare. Streckkodsläget pollar sin egen
    // detektor (se nedan) och har ingen konstbild att matcha mot.
    if (cameraState !== "live" || view !== "capture" || mode !== "single") {
      setLiveHint(null);
      liveStreak.current = { id: "", n: 0 };
      return;
    }
    const iv = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || livePollBusy.current || document.hidden) return;
      const shot = captureFrame(video, canvas, frameRef.current, true);
      if (!shot || shot.fingerprints.length === 0) return;
      livePollBusy.current = true;
      fetch("/api/scanner/identify-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprints: shot.fingerprints,
          structFingerprints: shot.structFingerprints,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { candidates?: Array<{ cardId: string; name: string; number: string }>; confident?: boolean } | null) => {
          const top = d?.candidates?.[0];
          if (!top) {
            liveStreak.current = { id: "", n: 0 };
            lockedPolls.current = 0;
            autoFired.current = null;
            setLiveHint(null);
            return;
          }
          const s = liveStreak.current;
          // Nytt kort i ramen → auto-fångsten laddas om.
          if (s.id !== top.cardId) autoFired.current = null;
          liveStreak.current =
            s.id === top.cardId ? { id: s.id, n: s.n + 1 } : { id: top.cardId, n: 1 };
          const locked = liveStreak.current.n >= 3 && d?.confident === true;
          lockedPolls.current = locked ? lockedPolls.current + 1 : 0;
          setLiveHint({ name: top.name, number: top.number, locked });
          // AUTO-FÅNGST: låset har hållit ≥2 pollar efter att det tändes, och
          // det här kortet har inte redan auto-fångats. Kvot-slut auto-trycker
          // inte (bara toast-spam annars); manuellt tryck funkar som vanligt.
          if (
            locked &&
            lockedPolls.current >= 3 &&
            autoFired.current !== top.cardId &&
            (quotaRef.current == null || quotaRef.current.remaining > 0)
          ) {
            autoFired.current = top.cardId;
            navigator.vibrate?.(60);
            captureRef.current?.();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          livePollBusy.current = false;
        });
    }, 600);
    return () => window.clearInterval(iv);
  }, [cameraState, view, mode]);


  // Lås body-scroll + Escape-stäng medan skannern är öppen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // INGEN auto-fokus på stäng-knappen: effekten re-körs vid varje delete
    // (closeScanner-dep byter identitet) → programmatisk focus tände en cyan
    // :focus-visible-ring på X/tillbaka-knappen. Escape lyssnar på window ändå.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (detailsId) setDetailsId(null);
        else if (settingsOpen) setSettingsOpen(false);
        else if (view === "review") setView("capture");
        else closeScanner();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [detailsId, settingsOpen, view, closeScanner]);

  // Svep åt HÖGER för att stänga skannern — fingret följer och skannern glider
  // ut, sedan closeScanner() (med osparade-träffar-vakten). Samma touch-event-
  // teknik som produkt-overlayn (WKWebView kapar annars gesten). BARA högersvep
  // engagerar → vänster-svep (kort-radering i granskningsvyn) + vertikal scroll
  // släpps igenom orörda.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Skanningsremsan scrollar horisontellt → svep där ska INTE stänga skannern.
      if ((e.target as HTMLElement)?.closest?.("[data-no-swipe]")) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      el.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (axis === null) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        // Bara höger-svep stänger; vänster (radera-svep) + vertikalt → släpp igenom.
        if (mx <= 0 || Math.abs(mx) <= Math.abs(my)) {
          dragging = false;
          return;
        }
        axis = "x";
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      el.style.transition = "transform 0.25s ease";
      if (dx > el.offsetWidth / 3) {
        el.style.transform = "translateX(110%)";
        window.setTimeout(() => {
          // Avbrutet (osparade träffar) → fjädra tillbaka in.
          if (!closeScanner()) el.style.transform = "";
        }, 230);
      } else {
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [closeScanner]);

  // ---- Fånga / ladda upp ---------------------------------------------------

  const addScan = useCallback(
    // `strip` följer med den fångade rutan. Skickas den INTE med som argument
    // utan läses ur en ref vid anropstillfället, ärver en galleriuppladdning
    // närbilden från förra kamerarutan — dvs nederkanten på ett HELT ANNAT kort.
    (
      dataUrl: string,
      strip?: string,
      fingerprintFrames?: string[][],
      structFrames?: string[][]
    ) => {
      const id = nextId();
      setScans((prev) => [
        ...prev,
        {
          id,
          status: "identifying",
          captured: dataUrl,
          match: null,
          candidates: [],
          confidence: 0,
          uncertain: false,
          quantity: 1,
          condition: defaultCondition,
          language: defaultLanguage,
        },
      ]);
      void identifyInto(id, dataUrl, strip, fingerprintFrames, structFrames);
    },
    [defaultCondition, defaultLanguage, identifyInto]
  );

  /**
   * STRECKKODSTRÄFF → katalogprodukt. Ingen vision, ingen bildmatchning: koden
   * ÄR identiteten. En träff är därför exakt, inte en gissning — `uncertain` är
   * alltid false och `candidates` bär bara den enda produkten.
   *
   * Skicket sätts till SEALED: en förseglad ask har inget kortskick att bedöma,
   * och NEAR_MINT (kortens standard) hade varit ett påstående om något vi inte
   * kan se.
   */
  const addBarcodeScan = useCallback(
    (gtin: string, dataUrl: string) => {
      const id = nextId();
      setScans((prev) => [
        ...prev,
        {
          id,
          status: "identifying",
          captured: dataUrl,
          match: null,
          candidates: [],
          confidence: 0,
          uncertain: false,
          quantity: 1,
          condition: "SEALED",
          language: defaultLanguage,
        },
      ]);
      void fetch("/api/scanner/identify-gtin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtin }),
      })
        .then((r) => r.json())
        .then((d: { found?: boolean; match?: Candidate | null; remaining?: number }) => {
          if (typeof d.remaining === "number") {
            const r = d.remaining;
            setQuota((q) => (q ? { ...q, remaining: r } : q));
          }
          setScans((prev) =>
            prev.map((s) =>
              s.id !== id
                ? s
                : d.found && d.match
                  ? {
                      ...s,
                      status: "matched",
                      match: d.match,
                      candidates: [d.match],
                      confidence: 1,
                    }
                  : // Koden lästes RÄTT men finns inte i katalogen — det är inte
                    // ett fel i skanningen, och felmeddelandet ska säga just det.
                    { ...s, status: "nomatch", errorMessage: t("barcodeNotFound") }
            )
          );
        })
        .catch(() => {
          setScans((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, status: "error", errorMessage: t("genericError") } : s
            )
          );
        });
    },
    [defaultLanguage, t]
  );

  /**
   * STRECKKODSPOLLEN — kontinuerlig avläsning utan slutare.
   *
   * En streckkod är antingen läsbar eller inte; det finns inget "nästan rätt"
   * att lägga fram för användaren, så läget behöver ingen slutarknapp och inget
   * lås. Detektorn skapas EN gång per lägesbyte: på Android initierar
   * konstruktorn Play Services-modellen, och en ny per ruta hade betalat den
   * kostnaden två gånger i sekunden.
   *
   * ⛔ `lastGtin` hindrar att SAMMA ask läses om och om igen medan den ligger
   * kvar framför linsen (2,5 avläsningar/s = en rad per ruta, och varje rad
   * drar kvot). Den nollställs när läget lämnas, så att skanna samma ask igen
   * med flit fungerar.
   */
  useEffect(() => {
    if (mode !== "barcode" || cameraState !== "live" || view !== "capture") return;
    let cancelled = false;
    let detector: BarcodeScanner | null = null;
    let iv = 0;
    let busy = false;
    const seen = new Set<string>();

    void createBarcodeScanner().then((s) => {
      if (cancelled || !s) return;
      detector = s;
      iv = window.setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !detector || busy || document.hidden) return;
        busy = true;
        detector
          .detect(video)
          .then((hits) => {
            const hit = hits.find((h) => !seen.has(h.gtin));
            if (!hit) return;
            seen.add(hit.gtin);
            navigator.vibrate?.(60);
            setFlash(true);
            window.setTimeout(() => setFlash(false), 180);
            // Bilden användaren såg sparas som fångst — samma ruta som koden
            // lästes ur, så granskningslistan visar rätt ask.
            const shot = captureFrame(video, canvas, frameRef.current);
            addBarcodeScan(hit.gtin, shot?.dataUrl ?? "");
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, 400);
    });

    return () => {
      cancelled = true;
      if (iv) window.clearInterval(iv);
    };
  }, [mode, cameraState, view, addBarcodeScan]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || cameraState !== "live" || shutterCooling) return;
    const shot = captureFrame(video, canvas, frameRef.current);
    if (!shot) return;
    setCropInfo(shot.crop);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    setShutterCooling(true);
    window.setTimeout(() => setShutterCooling(false), 450);

    // FLERA RUTOR, ett vision-anrop. Moiré, rörelseoskärpa och autofokus-sökning
    // är fel som varierar PER RUTA — och avtrycket är gratis (ingen API-kostnad,
    // bara några ms lokalt), så det finns ingen anledning att döma på en enda
    // ruta. Servern väljer sedan den ruta som var mest AVGÖRANDE (störst marginal
    // till tvåan), vilket är samma mått som visat sig skilja rätt från fel.
    //
    // Bilden och närbilden tas från FÖRSTA rutan: det är den användaren såg när
    // hen tryckte av, och extra rutor skulle bara kosta uppladdning utan att
    // hjälpa modellen (den läser text, inte färglayout).
    const frames: string[][] = shot.fingerprints.length ? [shot.fingerprints] : [];
    const structFrames: string[][] = shot.fingerprints.length
      ? [shot.structFingerprints]
      : [];
    let taken = 1;
    const grabNext = () => {
      if (taken >= CAPTURE_FRAMES) {
        addScan(shot.dataUrl, shot.stripDataUrl, frames, structFrames);
        return;
      }
      taken++;
      // requestAnimationFrame: nästa videoruta, inte en kopia av samma. Två
      // avtryck av EXAKT samma pixlar tillför ingenting.
      requestAnimationFrame(() => {
        const extra = captureFrame(video, canvas, frameRef.current);
        // Ruta-listorna hålls parallella: färg- och strukturrutor med samma index.
        if (extra?.fingerprints.length) {
          frames.push(extra.fingerprints);
          structFrames.push(extra.structFingerprints);
        }
        grabNext();
      });
    };
    grabNext();
  }, [cameraState, shutterCooling, addScan]);

  /**
   * BULK-FÅNGST: en bild → upp till 9 celler → EN art-only-förfrågan ($0,
   * ingen kvot). Säkra celler blir träffar direkt; osäkra körs vidare genom
   * VANLIGA /identify (en i taget, med cellens utsnitt + nederkantsremsa) och
   * får därmed vision, kvotbokföring, diagnostik och feedback-loopen — exakt
   * som en enkelskanning. Kvoten dras alltså PER VISION-ANROP (ägarbeslut
   * 2026-08-01): en sida med bara säkra bildträffar kostar 0.
   */
  const captureBulk = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || cameraState !== "live" || shutterCooling) return;
    const shot = captureBulkCells(video, canvas);
    if (!shot) return;
    const { cells, debugImage, video: videoSize, busySurface } = shot;
    // Admin: detekteringsbilden + funna regioner sparas server-sida så en
    // dålig bordsfångst går att felsöka mot VERKLIGHETEN (scripts/bulk-debug.ts)
    // i stället för mot syntetiska gissningar. Bara ägarens egna skanningar.
    const debug = isAdmin
      ? { image: debugImage, found: cells.length, video: videoSize }
      : undefined;
    if (busySurface || cells.length === 0) {
      // Detekteringen hittade inga kort — säg VARFÖR i stället för att tyst
      // göra ingenting (kort kant-i-kant smälter ihop och förkastas), och
      // skicka ändå debugbilden så haveriet går att analysera.
      // MÄTT skillnad: på ett mönstrat underlag är största FÖRKASTADE blobben
      // 17–55 % av bilden (fungerande fångster: 3–11 %), dvs underlaget har
      // smält ihop med korten. Då är "sprid ut korten" fel råd — underlaget är
      // problemet, och regionerna som hittas är bitar av det.
      toast({ title: t(busySurface ? "bulkBusySurface" : "bulkNoCards"), variant: "error" });
      if (debug) {
        void fetch("/api/scanner/identify-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: [], debug }),
        }).catch(() => undefined);
      }
      return;
    }
    // Direkt återkoppling: "hittade N kort" — skiljer detekteringsfel (fel N)
    // från identifieringsfel (rätt N, fel kort) redan i kameravyn.
    toast({ title: t("bulkFound", { count: cells.length }) });
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    setShutterCooling(true);
    window.setTimeout(() => setShutterCooling(false), 800);

    // Tomma fickor/rutor ger inga avtryck (jämn yta → null) och hoppas över —
    // cellindex → scan-id-mappningen bevaras för svaret.
    const sendable = cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell.fingerprints.length > 0);
    if (sendable.length === 0) return;

    const idByCell = new Map<number, string>();
    setScans((prev) => {
      const next = [...prev];
      for (const { cell, index } of sendable) {
        const id = nextId();
        idByCell.set(index, id);
        next.push({
          id,
          status: "identifying",
          captured: cell.dataUrl,
          match: null,
          candidates: [],
          confidence: 0,
          uncertain: false,
          quantity: 1,
          condition: defaultCondition,
          language: defaultLanguage,
        });
      }
      return next;
    });

    // Lokal patch-hjälpare (setScans är stabil) — undviker beroende på
    // patchScan som deklareras senare i komponenten.
    const patch = (id: string, p: Partial<ScanItem>) =>
      setScans((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

    void (async () => {
      try {
        const res = await fetch("/api/scanner/identify-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cells: sendable.map(({ cell }) => ({
              fingerprints: cell.fingerprints,
              structFingerprints: cell.structFingerprints,
            })),
            debug,
          }),
        });
        const data = (await res.json()) as {
          cells?: Array<{
            cell: number;
            candidates: Candidate[];
            confident: boolean;
            /** ScannerJob-id för den bokförda träffen — bär korrigeringen vidare. */
            scanId?: string;
          }>;
          error?: string;
        };
        // 403 = bulk kräver Pro. Kvoten kan ha varit oladdad när knappen
        // trycktes (då står låset öppet med flit), så det här är inte ett fel
        // att rapportera nio gånger — det är ett säljtillfälle. Cellerna städas
        // bort och användaren landar på prissidan.
        if (res.status === 403) {
          const dropped = new Set(idByCell.values());
          setScans((prev) => prev.filter((s) => !dropped.has(s.id)));
          setMode("single");
          router.push("/priser");
          return;
        }
        if (!res.ok || !data.cells) {
          const msg = data.error ?? t("genericError");
          for (const id of idByCell.values()) {
            patch(id, { status: "error", errorMessage: msg });
          }
          return;
        }
        // Osäkra celler samlas och körs SEKVENTIELLT genom /identify — en burst
        // på upp till 9 vision-anrop hade slagit i rate-limiten och kostat i
        // onödan när användaren ändå granskar resultaten ett i taget.
        const uncertain: Array<{ id: string; cell: BulkCell }> = [];
        for (const result of data.cells) {
          const sent = sendable[result.cell];
          const id = sent ? idByCell.get(sent.index) : undefined;
          if (!id || !sent) continue;
          const top = result.candidates[0];
          if (result.confident && top) {
            // Bevisad bildträff — samma villkor som auto-fångstens $0-väg.
            patch(id, {
              status: "matched",
              match: top,
              candidates: result.candidates,
              confidence: 0.95,
              uncertain: false,
              // ⛔ UTAN jobId FÖRSVINNER RÄTTELSEN. En bildavgjord bulk-cell
              // bokförs server-sida (identifyCellsArt) och får ett jobb-id —
              // läses det inte här har reportScanFeedback inget att fästa
              // korrigeringen vid, och den tystnar. Mätt 2026-08-02: ägarens
              // rättelse i en niokortsfångst gick förlorad precis så.
              jobId: result.scanId ?? null,
            });
          } else if (top) {
            uncertain.push({ id, cell: sent.cell });
          } else {
            patch(id, { status: "nomatch", candidates: [] });
          }
        }
        for (const u of uncertain) {
          // eslint-disable-next-line no-await-in-loop -- sekventiellt med flit, se ovan
          await identifyInto(
            u.id,
            u.cell.dataUrl,
            u.cell.stripDataUrl,
            [u.cell.fingerprints],
            [u.cell.structFingerprints]
          );
        }
      } catch {
        for (const id of idByCell.values()) {
          patch(id, { status: "error", errorMessage: t("genericError") });
        }
      }
    })();
  }, [cameraState, shutterCooling, defaultCondition, defaultLanguage, identifyInto, isAdmin, t, toast]);
  // Auto-fångsten läser via refs (se lockedPolls/autoFired) — färska varje render.
  captureRef.current = capture;
  quotaRef.current = quota;

  function handleFile(file: File): boolean {
    if (!file.type.startsWith("image/")) {
      toast({ title: t("wrongFileType"), description: t("chooseImageFile"), variant: "error" });
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: t("tooLarge"), description: t("tooLargeDesc"), variant: "error" });
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        // Nedskalning i klienten — samma pixelbudget som kamerarutorna.
        void downscaleDataUrl(reader.result).then(addScan);
      }
    };
    reader.readAsDataURL(file);
    return true;
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  // ---- Granska / lägg till -------------------------------------------------

  const patchScan = useCallback((id: string, patch: Partial<ScanItem>) => {
    setScans((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeScan = useCallback((id: string) => {
    setScans((prev) => prev.filter((s) => s.id !== id));
    setDetailsId((d) => (d === id ? null : d));
  }, []);

  const chooseCandidate = useCallback((id: string, cand: Candidate) => {
    setScans((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        // ANVÄNDARENS VAL ÄR FACIT: valde hen ett ANNAT kort än skannerns är
        // det en korrigering (hen tittar på det fysiska kortet); samma kort =
        // bekräftelse. (Sidoeffekt i updatern: kan dubbelköras i dev-StrictMode
        // — servern skriver samma värde idempotent, så det är ofarligt.)
        reportScanFeedback(
          s.jobId,
          cand.cardId,
          cand.cardId === s.match?.cardId ? "confirmed" : "corrected"
        );
        // Användaren valde själv ur listan → inte längre en gissning.
        return { ...s, status: "matched", match: cand, uncertain: false };
      })
    );
    setDetailsId(null);
  }, []);

  async function addAll() {
    if (matched.length === 0) return;
    setAddingAll(true);
    let ok = 0;
    for (const s of matched) {
      try {
        const res = await fetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: s.match!.cardId,
            // Den VALDA tryckningen följer med — annars sparas ett Base-kort
            // utan produkt och värderas på den billigaste tryckningen, dvs en
            // 1st Edition hamnar tyst i samlingen som Unlimited.
            ...(s.match!.productId ? { productId: s.match!.productId } : {}),
            quantity: s.quantity,
            condition: s.condition,
            language: s.language,
            ...(s.match!.estimatedValue != null
              ? { estimatedValue: s.match!.estimatedValue }
              : {}),
          }),
        });
        if (res.ok) {
          ok += 1;
          // Oförändrad i samlingen = bekräftat facit (servern vaktar så att en
          // tidigare KORRIGERING aldrig degraderas till bekräftelse).
          reportScanFeedback(s.jobId, s.match!.cardId, "confirmed");
        }
      } catch {
        /* fortsätt med nästa */
      }
    }
    setAddingAll(false);
    setAddedCount(ok);
    toast({
      title: ok === matched.length ? t("addedAllTitle") : t("addedPartialTitle"),
      description:
        ok === matched.length
          ? t("addedAllDesc", { count: ok })
          : t("addedPartialDesc", { ok, total: matched.length }),
      variant: ok === matched.length ? "success" : "error",
    });
  }

  const detailsItem = detailsId ? scans.find((s) => s.id === detailsId) ?? null : null;

  // =========================================================================
  // Skanner-overlay (capture + review) — fullskärm, immersivt
  // =========================================================================
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogAria")}
      className="fixed inset-0 z-[60] flex flex-col bg-black text-ink"
    >
      {/* Topbar */}
      <div className="relative z-20 flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={
            view === "review"
              ? () => (streamRef.current ? setView("capture") : closeScanner())
              : closeScanner
          }
          aria-label={view === "review" ? t("backToCamera") : t("closeScanner")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
        >
          {view === "review" ? <IconChevronLeft size={20} /> : <IconX size={20} />}
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink">
            {view === "review" ? t("reviewTitle") : t("captureTitle")}
          </p>
        </div>
        <div className="h-10 w-10" aria-hidden="true" />
      </div>

      {view === "capture" ? (
        <CaptureView
          videoRef={videoRef}
          canvasRef={canvasRef}
          frameRef={frameRef}
          liveHint={liveHint}
          streamInfo={streamInfo}
          cropInfo={cropInfo}
          ocrInfo={ocrInfo}
          cameraState={cameraState}
          cameraError={cameraError}
          flash={flash}
          scans={scans}
          total={total}
          matchedCount={matched.length}
          isMock={isMock}
          shutterCooling={shutterCooling}
          quota={quota}
          mode={mode}
          onSetMode={setMode}
          // Låset sätts först när kvoten LADDATS: `quota === null` betyder
          // "vet inte än", och att gissa låst där hade blinkat ett Pro-lås för
          // en betalande kund varje gång skannern öppnas. Gissar vi fel åt
          // andra hållet stoppar servergrinden ändå anropet (403 → prissidan).
          bulkLocked={quota != null && !quota.isPremium}
          barcodeAvailable={canScanBarcodes}
          torchSupported={camera.torchSupported}
          torchOn={camera.torchOn}
          onToggleTorch={() => void camera.toggleTorch()}
          zoomPresets={camera.zoomPresets}
          zoom={camera.zoom}
          onZoom={(p) => void onZoom(p)}
          onUpgrade={() => router.push("/priser")}
          onRetryCamera={() => void startCamera()}
          onCapture={bulkMode ? captureBulk : capture}
          onGallery={() => fileInputRef.current?.click()}
          onSettings={() => setSettingsOpen(true)}
          onReview={() => setView("review")}
          onOpenDetails={setDetailsId}
        />
      ) : (
        <ReviewView
          scans={scans}
          matchedCount={matched.length}
          noMatchCount={noMatchCount}
          total={total}
          addingAll={addingAll}
          addedCount={addedCount}
          onPatch={patchScan}
          onRemove={removeScan}
          onOpenDetails={setDetailsId}
          onAddAll={() => void addAll()}
          onScanMore={() => {
            setScans([]);
            setAddedCount(null);
            setView("capture");
          }}
          onClose={closeScanner}
        />
      )}

      {/* Settings-sheet */}
      {settingsOpen && (
        <SettingsSheet
          condition={defaultCondition}
          onCondition={setDefaultCondition}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Scan-details-sheet */}
      {detailsItem && (
        <ScanDetailsSheet
          item={detailsItem}
          onClose={() => setDetailsId(null)}
          onChoose={(c) => chooseCandidate(detailsItem.id, c)}
          onRemove={() => removeScan(detailsItem.id)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}

/* ===========================================================================
 * Capture-vy
 * ======================================================================== */
/** Liten kvot-badge i kameravyn. Free = tappbar → /priser; Pro = bara info. */
function QuotaBadge({ quota, onUpgrade }: { quota: ScanQuota; onUpgrade: () => void }) {
  const t = useTranslations("Scanner");
  const { remaining, isPremium } = quota;
  const pill = (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-1 text-xs font-bold tracking-wide",
        isPremium
          ? "bg-holo-cyan text-black"
          : "bg-holo-cyan/20 text-holo-cyan ring-1 ring-holo-cyan/40"
      )}
    >
      {isPremium ? t("pro") : t("free")}
    </span>
  );
  const body = (
    <span className="min-w-0 text-left">
      <span
        className={cn(
          "block font-semibold text-ink",
          // Pro-raden är BARA oändlighetstecknet (ägarbeslut 2026-08-02). Ett
          // ensamt "∞" i brödtextstorlek läser som ett renderingsfel — det ska
          // bära raden, alltså sätts det i display-grad med samma optiska tyngd
          // som "3 skanningar kvar" har på gratisraden.
          isPremium ? "text-2xl leading-none" : "text-sm"
        )}
      >
        {/* Pro säljs som OBEGRÄNSAT — då ska ingen nedräkning visas. Taket i
            koden är ett skydd mot skenande loopar, inte en produktgräns, och en
            siffra här hade läst som "du har X kvar" av en kund som betalat för
            obegränsat. Träffas taket säger felmeddelandet det då det händer. */}
        {isPremium ? t("scansUnlimited") : t("scansLeft", { count: remaining })}
      </span>
      <span className="block text-xs text-ink-muted">
        {isPremium ? t("renewsNextMonth") : t("tapForMore")}
      </span>
    </span>
  );
  // Lika bred som kortramen i kameravyn (w-[68%] max-w-[20rem] av helskärm).
  const cls =
    "mx-auto flex w-[min(68vw,20rem)] items-center gap-3 rounded-2xl bg-black/70 px-4 py-3 ring-1 ring-white/10 backdrop-blur";
  if (isPremium) {
    return (
      <div className={cls}>
        {pill}
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onUpgrade}
      className={cn(
        cls,
        "transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
      )}
    >
      {pill}
      {body}
      <IconArrowRight size={18} className="ml-auto shrink-0 text-ink-muted" />
    </button>
  );
}

/** Lägesväxlare i kameravyn. Låst variant bär hänglås + PRO-märke i stället för
 *  att döljas — se kommentaren vid anropsstället. */
function ModeChip(props: {
  active: boolean;
  locked: boolean;
  icon: ReactNode;
  label: string;
  proLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.locked ? undefined : props.active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-medium backdrop-blur transition-colors",
        props.active
          ? "border-holo-cyan/60 bg-holo-cyan/15 text-holo-cyan"
          : "border-white/15 bg-white/10 text-ink hover:bg-white/15"
      )}
    >
      {props.locked ? <IconLock size={15} /> : props.icon}
      {props.label}
      {props.locked && (
        <span className="rounded bg-holo-cyan/20 px-1.5 py-px text-[10px] font-bold tracking-wide text-holo-cyan">
          {props.proLabel}
        </span>
      )}
    </button>
  );
}

/**
 * Ficklampa + zoom-förval, staplade längs kamerans högerkant.
 *
 * ⛔ BÅDA renderas villkorat på vad enheten FAKTISKT kan: torch saknas på hela
 * iOS, på desktop och på framkameror, och zoom-förvalen filtreras av
 * `use-camera-controls` till dem som går att nå. En kontroll som inte gör något
 * är sämre än ingen kontroll — samma regel som gäller resten av appen.
 *
 * Korttalen (`maxCards`) är UPPSKATTNINGAR från geometrin, inte mätningar —
 * därför "ca" i copyn. Se ZOOM_PRESET_MAX_CARDS i lib/camera-controls.ts.
 */
function CameraControls(props: {
  torchSupported: boolean;
  torchOn: boolean;
  onToggleTorch: () => void;
  zoomPresets: ZoomPresetOption[];
  zoom: ZoomPreset;
  onZoom: (p: ZoomPreset) => void;
  /** Korttalet är bara meningsfullt i bulk — ett kort i taget är ett kort. */
  showCardHint: boolean;
}) {
  const t = useTranslations("Scanner");
  const zoomLabel = (p: ZoomPreset) =>
    p === 0.5 ? t("zoomHalf") : p === 2 ? t("zoomTwo") : t("zoomOne");
  if (!props.torchSupported && props.zoomPresets.length <= 1) return null;
  return (
    <div className="pointer-events-none absolute inset-y-0 right-3 z-20 flex flex-col items-end justify-center gap-2">
      {props.torchSupported && (
        <button
          type="button"
          onClick={props.onToggleTorch}
          aria-pressed={props.torchOn}
          aria-label={props.torchOn ? t("torchTurnOff") : t("torchTurnOn")}
          className={cn(
            "pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition-colors",
            props.torchOn ? "bg-holo-cyan text-black" : "bg-black/50 text-ink hover:bg-black/70"
          )}
        >
          <IconFlashlight size={18} />
        </button>
      )}
      {props.zoomPresets.length > 1 && (
        <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur">
          {props.zoomPresets.map((o) => (
            <button
              key={o.preset}
              type="button"
              onClick={() => props.onZoom(o.preset)}
              aria-label={t("zoomAria", { label: zoomLabel(o.preset) })}
              aria-pressed={props.zoom === o.preset}
              title={props.showCardHint ? t("zoomCardHint", { count: o.maxCards }) : undefined}
              className={cn(
                "flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums transition-colors",
                props.zoom === o.preset
                  ? "bg-holo-cyan text-black"
                  : "text-ink hover:bg-white/10"
              )}
            >
              {zoomLabel(o.preset)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CaptureView(props: {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Kortramen — captureFrame mäter den för att beskära utsnittet till kortet. */
  frameRef: RefObject<HTMLDivElement>;
  /** Aktivt läge: enkelram, frilagd bulk-detektering eller streckkodsläsning. */
  mode: ScanMode;
  onSetMode: (m: ScanMode) => void;
  /** Bulk är Pro. Låst = knappen visas ändå, men leder till prissidan. */
  bulkLocked: boolean;
  /** Streckkodsläget döljs helt där plattformen inte kan läsa koder (iOS). */
  barcodeAvailable: boolean;
  /** Ficklampa — saknas på desktop, framkameror och hela iOS. Dölj då knappen. */
  torchSupported: boolean;
  torchOn: boolean;
  onToggleTorch: () => void;
  /** Bara de zoom-förval enheten FAKTISKT når. Tom/ensam lista → ingen rad. */
  zoomPresets: ZoomPresetOption[];
  zoom: ZoomPreset;
  onZoom: (p: ZoomPreset) => void;
  /** Live-bildmatchningens bästa gissning (chippen under ramen). Ren data —
   *  kortnamn + nummer — så ingen ny copy/översättning behövs. */
  liveHint: { name: string; number: string; locked: boolean } | null;
  /** Diagnostik, visas bara för admin. Se ScanDebug. */
  streamInfo: string | null;
  cropInfo: string | null;
  ocrInfo: string | null;
  cameraState: CameraState;
  cameraError: string;
  flash: boolean;
  scans: ScanItem[];
  total: number;
  matchedCount: number;
  isMock: boolean;
  shutterCooling: boolean;
  quota: ScanQuota | null;
  onUpgrade: () => void;
  onRetryCamera: () => void;
  onCapture: () => void;
  onGallery: () => void;
  onSettings: () => void;
  onReview: () => void;
  onOpenDetails: (id: string) => void;
}) {
  const t = useTranslations("Scanner");
  const {
    videoRef,
    canvasRef,
    frameRef,
    cameraState,
    cameraError,
    flash,
    scans,
    total,
    matchedCount,
    isMock,
    shutterCooling,
    quota,
  } = props;

  return (
    <>
      {/* Kameralager (fyller bakom) */}
      <div className="absolute inset-0 z-0 bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t("cameraFeed")}
          className={cn(
            "h-full w-full object-cover",
            cameraState === "live" ? "block" : "hidden"
          )}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Vinjett upptill/nedtill för läsbarhet */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 to-transparent"
        />

        {cameraState !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {cameraState === "starting" ? (
              <>
                <span className="animate-pulse-soft text-holo-cyan">
                  <IconCamera size={40} />
                </span>
                <p className="text-sm text-ink-muted">{t("startingCamera")}</p>
              </>
            ) : cameraState === "unsupported" ? (
              <>
                <IconCamera size={40} className="text-ink-faint" />
                <p className="text-sm font-medium text-ink">{t("cameraUnsupported")}</p>
                <p className="max-w-xs text-xs text-ink-faint">
                  {t("cameraUnsupportedHint")}
                </p>
              </>
            ) : (
              <>
                <IconAlertTriangle size={36} className="text-fall" />
                <p className="max-w-xs text-sm text-ink-muted">{cameraError}</p>
                <Button variant="outline" onClick={props.onRetryCamera}>
                  {t("retryCamera")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Kortram-overlay (enkel) ELLER rutnätsoverlay (bulk) ELLER
          streckkodsgejd (sealed). Kortramen är 5/7 med flit — den mäts av
          captureFrame och styr beskärningen, så den får inte visas i ett läge
          där utsnittet inte är ett kort. */}
      {cameraState === "live" && props.mode === "single" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <div ref={frameRef} className="relative mb-[14vh] aspect-[5/7] w-[68%] max-w-[20rem]">
            <CornerFrame />
            {/* LIVE-LÅSET: grönt chip = bildmatchningen är säker INNAN slutaren
                trycks (trust-regeln + tre rutor i rad). Neutralt = bästa
                gissning. Ren data (namn + nummer) — ingen ny copy behövs. */}
            {props.liveHint && (
              <div
                className={cn(
                  "absolute -bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold backdrop-blur transition-colors",
                  props.liveHint.locked
                    ? "bg-holo-cyan text-black"
                    : "bg-black/60 text-ink ring-1 ring-white/15"
                )}
              >
                {props.liveHint.locked && <IconCheck size={13} />}
                {props.liveHint.name} #{props.liveHint.number}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Bulk-läget har INGEN ram: detectCardRegions hittar korten själv —
          hela rutan är fångstytan, hinten säger "lite mellanrum". */}

      {/* Streckkodsgejd: en LIGGANDE remsa, inte en kortram. Koden sitter på
          askens kant och är bred och låg — en 5/7-ram hade fått användaren att
          rikta mot mitten av asken, där ingen kod finns. Ren guide: detektorn
          läser hela videorutan, så en kod utanför remsan hittas ändå. */}
      {cameraState === "live" && props.mode === "barcode" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <div className="mb-[14vh] h-[22vh] w-[78%] max-w-[24rem] rounded-2xl ring-2 ring-holo-cyan/70">
            <div className="h-full w-full rounded-2xl ring-1 ring-inset ring-black/40" />
          </div>
        </div>
      )}

      {/* Ficklampa + zoom — bara medan kameran faktiskt visar bild. */}
      {cameraState === "live" && (
        <CameraControls
          torchSupported={props.torchSupported}
          torchOn={props.torchOn}
          onToggleTorch={props.onToggleTorch}
          zoomPresets={props.zoomPresets}
          zoom={props.zoom}
          onZoom={props.onZoom}
          showCardHint={props.mode === "bulk"}
        />
      )}

      {/* Capture-flash */}
      {flash && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 bg-white/80 animate-fade-in"
        />
      )}

      {/* Botten: kvot-badge, hint, strip, kontroller */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Kvot-badgen göms när remsan visas — annars trycks den upp i kortramen
            (remsan visar ändå antalet skanningar). Syns före första skanningen. */}
        {quota && scans.length === 0 && <QuotaBadge quota={quota} onUpgrade={props.onUpgrade} />}

        {isMock && (
          <p className="mx-auto rounded-full bg-black/70 px-3 py-1 text-center text-[11px] font-medium text-holo-gold ring-1 ring-holo-gold/30 backdrop-blur">
            {t("demoMode")}
          </p>
        )}

        <ScanDebug stream={props.streamInfo} crop={props.cropInfo} ocr={props.ocrInfo} />

        {scans.length > 0 && <ScanStrip scans={scans} total={total} onOpen={props.onOpenDetails} />}

        {scans.length === 0 && cameraState === "live" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-center text-sm text-ink-muted">
              {props.mode === "bulk"
                ? t("bulkHint")
                : props.mode === "barcode"
                  ? t("barcodeHint")
                  : t("holdCard")}
            </p>
            {/* LÄGESVÄXLARNA. Bulk ersatte "Manuell inmatning" (ägarbeslut
                2026-08-01) — sökningen finns ändå i produktkatalogen.
                BULK ÄR PRO (2026-08-02): knappen visas för ALLA med flit och
                bär ett lås i stället för att döljas — en funktion man inte kan
                se säljer ingenting. Tryck utan Pro → prissidan, aldrig ett
                felmeddelande. Den riktiga grinden sitter i API:t.
                STRECKKOD döljs däremot HELT där den inte fungerar (iOS saknar
                BarcodeDetector): skillnaden är att bulk är låst av OSS och går
                att låsa upp, medan streckkod är omöjlig på enheten. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ModeChip
                active={props.mode === "bulk"}
                locked={props.bulkLocked}
                icon={<IconCards size={16} />}
                label={t("bulkMode")}
                proLabel={t("pro")}
                onClick={
                  props.bulkLocked
                    ? props.onUpgrade
                    : () => props.onSetMode(props.mode === "bulk" ? "single" : "bulk")
                }
              />
              {props.barcodeAvailable && (
                <ModeChip
                  active={props.mode === "barcode"}
                  locked={false}
                  icon={<IconScan size={16} />}
                  label={t("barcodeMode")}
                  proLabel={t("pro")}
                  onClick={() =>
                    props.onSetMode(props.mode === "barcode" ? "single" : "barcode")
                  }
                />
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Galleri */}
          <button
            type="button"
            onClick={props.onGallery}
            aria-label={t("chooseFromDevice")}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-ink backdrop-blur transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconUpload size={20} />
          </button>

          {/* Inställningar */}
          <button
            type="button"
            onClick={props.onSettings}
            aria-label={t("scannerSettings")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <IconSettings size={20} />
          </button>

          {/* Slutare */}
          <button
            type="button"
            onClick={props.onCapture}
            disabled={cameraState !== "live"}
            aria-label={t("takePhoto")}
            className={cn(
              "flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full ring-4 ring-white/30 transition-transform",
              "disabled:opacity-40",
              shutterCooling ? "scale-90" : "active:scale-90"
            )}
          >
            <span className="h-[3.6rem] w-[3.6rem] rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.4)]" />
          </button>

          {/* Bekräfta/granska */}
          <button
            type="button"
            onClick={props.onReview}
            disabled={scans.length === 0}
            aria-label={t("reviewMatches")}
            className={cn(
              "relative flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan",
              scans.length > 0
                ? "bg-holo-cyan text-black hover:bg-holo-cyan/90"
                : "bg-white/10 text-ink-faint"
            )}
          >
            <IconCheck size={22} />
            {matchedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rise px-1 text-[11px] font-semibold tabular-nums text-black">
                {matchedCount}
              </span>
            )}
          </button>

          {/* Symmetri-spacer mot galleriknappen */}
          <span className="h-12 w-12" aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

/**
 * ADMIN-ONLY diagnostikrad i kameravyn.
 *
 * Skannern var en svart låda: `/api/scanner/identify` sparar ingen OCR-utdata
 * (bara en kvot-rad), bilden persisteras aldrig, och kamerans upplästa
 * upplösning kollades aldrig. "Den gissar fel kort" gick alltså inte att
 * felsöka — tre helt olika orsaker (mock-adaptern, en 640×480-ström, modellen
 * som faktiskt läser fel) ger exakt samma symtom, och var och en har en egen
 * åtgärd. Raden visar de tre måtten som skiljer dem åt:
 *
 *   ström 640×480 · utsnitt 151×211→914×1280 · claude · "Gardevoir" / "" · konf 0,35
 *           │                │                    │          │        │
 *           │                │                    │          │        └ modellens säkerhet
 *           │                │                    │          └ tomt nummer = kunde inte läsa det
 *           │                │                    └ "mock" här = vi anropar inte modellen alls
 *           │                └ källa < skickad storlek = uppskalning, kameran är flaskhalsen
 *           └ det kameran FAKTISKT gav oss, inte det vi bad om
 *
 * Text på svenska men avsiktligt teknisk och kompakt — det här är driftdata,
 * inte produktcopy, och den ska aldrig nå en vanlig användare.
 */
function ScanDebug({
  stream,
  crop,
  ocr,
}: {
  stream: string | null;
  crop: string | null;
  ocr: string | null;
}) {
  const isAdmin = useIsAdmin();
  if (!isAdmin || (!stream && !crop && !ocr)) return null;
  return (
    <p className="mx-auto max-w-full rounded-lg bg-black/80 px-2.5 py-1 text-center font-mono text-[10px] leading-relaxed text-holo-cyan ring-1 ring-holo-cyan/25 backdrop-blur">
      {[stream && `ström ${stream}`, crop && `utsnitt ${crop}`, ocr]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

function CornerFrame() {
  return (
    <div className="absolute inset-0">
      {/* mjuk ram */}
      <div className="absolute inset-0 rounded-2xl border border-white/25" />
      {/* hörn-parenteser i accentfärg */}
      {(
        [
          "left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl",
          "right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl",
          "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-2xl",
          "right-0 bottom-0 border-r-2 border-b-2 rounded-br-2xl",
        ] as const
      ).map((c) => (
        <span
          key={c}
          className={cn("absolute h-8 w-8 border-holo-cyan", c)}
        />
      ))}
    </div>
  );
}

function ScanStrip({
  scans,
  total,
  onOpen,
}: {
  scans: ScanItem[];
  total: number;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Scanner");
  return (
    <div data-no-swipe className="rounded-2xl bg-black/55 p-2.5 backdrop-blur">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {scans.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s.id)}
            className="flex w-40 shrink-0 animate-scale-in items-center gap-2 rounded-xl bg-white/8 p-2 text-left transition-colors hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
          >
            <ScanThumb item={s} />
            <span className="min-w-0 flex-1">
              {s.status === "identifying" ? (
                <span className="block text-xs text-ink-muted">{t("identifying")}</span>
              ) : s.status === "matched" && s.match ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-xs font-medium text-ink">
                      {s.match.name}
                    </span>
                    {/* En gissning ska SE ut som en gissning. Utan märket lades
                        ett likvärdigt-men-fel kort till som om det var säkert. */}
                    {s.uncertain && (
                      <span
                        aria-hidden="true"
                        className="shrink-0 rounded bg-holo-gold/15 px-1 text-[10px] font-bold leading-tight text-holo-gold ring-1 ring-holo-gold/40"
                      >
                        ?
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    #{s.match.number}
                  </span>
                  <span className="block text-xs font-semibold tabular-nums text-holo-cyan">
                    {s.match.estimatedValue != null ? formatPrice(s.match.estimatedValue) : "–"}
                  </span>
                </>
              ) : (
                <span className="block text-[11px] font-medium leading-tight text-fall">
                  {/* Ett FEL (t.ex. slut på kvoten) är inte en "ingen träff" —
                      visa serverns besked så orsaken syns direkt i remsan. */}
                  {s.status === "error" && s.errorMessage ? s.errorMessage : t("noMatch")}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between px-1 pt-1.5">
        <span className="text-[11px] text-ink-faint">
          {t("scansCount", { count: scans.length })}
        </span>
        <span className="text-sm font-semibold text-ink">
          {t("total")} <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
        </span>
      </div>
    </div>
  );
}

function ScanThumb({ item, size = "sm" }: { item: ScanItem; size?: "sm" | "lg" }) {
  const t = useTranslations("Scanner");
  const dim = size === "lg" ? "h-24 w-[4.3rem]" : "h-14 w-10";
  if (item.status === "identifying") {
    return (
      <span
        className={cn(
          "flex shrink-0 animate-pulse-soft items-center justify-center rounded-md bg-white/10",
          dim
        )}
      >
        <IconCards size={16} className="text-ink-faint" />
      </span>
    );
  }
  const src = item.match?.imageUrl ?? item.captured;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={item.match?.name ?? t("scannedCardAlt")}
      className={cn("shrink-0 rounded-md object-cover", dim)}
    />
  );
}

/* ===========================================================================
 * Review-vy
 * ======================================================================== */
function ReviewView(props: {
  scans: ScanItem[];
  matchedCount: number;
  noMatchCount: number;
  total: number;
  addingAll: boolean;
  addedCount: number | null;
  onPatch: (id: string, patch: Partial<ScanItem>) => void;
  onRemove: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onAddAll: () => void;
  onScanMore: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
  const {
    scans,
    matchedCount,
    noMatchCount,
    total,
    addingAll,
    addedCount,
    onPatch,
    onRemove,
    onOpenDetails,
  } = props;

  const done = addedCount !== null;

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex-1 overflow-y-auto px-4 pb-40">
        <p className="py-3 text-sm text-ink-muted">
          {t("addingTo")}{" "}
          <span className="font-semibold text-holo-cyan">{t("myCollection")}</span>
        </p>

        {scans.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <IconCards size={32} className="text-ink-faint" />
            <p className="text-sm text-ink-muted">{t("noScansYet")}</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {scans.map((s) => (
            <li key={s.id}>
             <SwipeToDelete onDelete={() => onRemove(s.id)}>
              {s.status === "matched" && s.match ? (
                <div className="flex gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => onOpenDetails(s.id)}
                    className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
                    aria-label={t("showScanDetails")}
                  >
                    <ScanThumb item={s} size="lg" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{s.match.name}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {s.match.setName} · #{s.match.number}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-holo-cyan">
                        {s.match.estimatedValue != null ? formatPrice(s.match.estimatedValue) : "–"}
                      </p>
                    </div>

                    <div className="mt-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-ink-faint">{t("condition")}</span>
                        <Select
                          value={s.condition}
                          onChange={(e) => onPatch(s.id, { condition: e.target.value })}
                          className="h-9 text-sm"
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c.value} value={c.value}>{tCond(c.value)}</option>
                          ))}
                        </Select>
                      </label>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <Stepper
                        value={s.quantity}
                        onChange={(q) => onPatch(s.id, { quantity: q })}
                      />
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="text-xs text-ink-faint underline-offset-2 hover:text-fall hover:underline"
                      >
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : s.status === "identifying" ? (
                <div className="flex items-center gap-3 p-3">
                  <ScanThumb item={s} size="lg" />
                  <p className="text-sm text-ink-muted">{t("identifying")}</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.captured}
                    alt={t("noMatchCardAlt")}
                    className="h-24 w-[4.3rem] shrink-0 rounded-md object-cover opacity-80"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {s.status === "error" && s.errorMessage ? t("scanStopped") : t("noMatch")}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {s.errorMessage ?? t("couldntMatch")}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(s.id)}
                        className="text-xs font-medium text-holo-cyan hover:underline"
                      >
                        {t("searchManually")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        className="text-xs text-ink-faint hover:text-fall"
                      >
                        {t("remove")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
             </SwipeToDelete>
            </li>
          ))}
        </ul>
      </div>

      {/* Sticky botten-CTA */}
      <div className="absolute inset-x-0 bottom-0 border-t border-surface-border bg-surface/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-ink-muted">
              {t("matchedCount", { count: matchedCount })}
              {noMatchCount > 0 && (
                <span className="text-fall"> · {t("noMatchSuffix", { count: noMatchCount })}</span>
              )}
            </p>
            <p className="text-lg font-semibold text-ink">
              {t("total")} <span className="tabular-nums text-holo-cyan">{formatPrice(total)}</span>
            </p>
          </div>
          {done ? (
            <div className="flex items-center gap-2">
              <LinkButton href="/samling" variant="outline">
                {t("showCollection")}
              </LinkButton>
              <Button onClick={props.onScanMore}>{t("scanMore")}</Button>
            </div>
          ) : (
            <Button
              onClick={props.onAddAll}
              loading={addingAll}
              disabled={matchedCount === 0}
              // Disabled = solid dämpad yta i FULL opacitet (ej dimmad teal). Den
              // gamla disabled:opacity-50 på teal-knappen lämnade en ljus cyan
              // "spök"-remsa i WebKit:s compositing-lager när sista kortet togs bort.
              className="px-5 disabled:bg-surface-overlay disabled:text-ink-faint disabled:opacity-100"
            >
              {matchedCount > 0 ? t("addToCollectionN", { count: matchedCount }) : t("addToCollection")}
            </Button>
          )}
        </div>
        {done && (
          <p className="mt-2 text-center text-xs text-rise">
            <IconCheck size={13} className="mr-1 inline" />
            {t("cardsAdded", { count: addedCount })}
          </p>
        )}
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useTranslations("Scanner");
  return (
    <div className="inline-flex items-center rounded-lg border border-surface-border">
      <button
        type="button"
        aria-label={t("decreaseQty")}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40"
        disabled={value <= 1}
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums text-ink">{value}</span>
      <button
        type="button"
        aria-label={t("increaseQty")}
        onClick={() => onChange(Math.min(9999, value + 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink"
      >
        +
      </button>
    </div>
  );
}

/* ===========================================================================
 * Settings-sheet
 * ======================================================================== */
function SettingsSheet(props: {
  condition: string;
  onCondition: (v: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
  return (
    <Sheet title={t("settingsTitle")} onClose={props.onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="def-condition">{t("condition")}</Label>
          <Select
            id="def-condition"
            value={props.condition}
            onChange={(e) => props.onCondition(e.target.value)}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{tCond(c.value)}</option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-ink-faint">
          {t("settingsHint")}
        </p>
        <Button onClick={props.onClose}>{t("done")}</Button>
      </div>
    </Sheet>
  );
}

/* ===========================================================================
 * Scan-details-sheet (Din bild vs Din träff)
 * ======================================================================== */
function ScanDetailsSheet(props: {
  item: ScanItem;
  onClose: () => void;
  onChoose: (c: Candidate) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Scanner");
  const tCond = useTranslations("Condition");
  const { item } = props;
  const alternatives = useMemo(() => {
    // Jämför på TRYCKNINGEN, inte bara kortet: de tre Base-produkterna delar
    // cardId, så ett `cardId !==`-filter hade slängt ut precis de alternativ
    // användaren behöver ("min är 1st Edition, inte Unlimited").
    const others = item.candidates.filter((c) =>
      item.match ? c.productId !== item.match.productId || c.cardId !== item.match.cardId : true
    );
    // Referensen är TRÄFFENS poäng när det finns en träff — inte listans topp.
    // Frågan alternativen svarar på är "kan skannern ha tagit fel på just DET
    // här kortet?", och det avgörs av avståndet till träffen.
    const reference = item.match?.score ?? others[0]?.score ?? 0;
    return others
      .filter((c) => reference - c.score <= ALT_SCORE_WINDOW)
      .slice(0, MAX_ALTERNATIVES);
  }, [item.candidates, item.match]);

  return (
    <Sheet title={t("scanDetails")} onClose={props.onClose}>
      <div className="flex flex-col gap-5">
        {/* Din bild vs din träff */}
        <div className="grid grid-cols-2 gap-3">
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.captured}
              alt={t("yourImage")}
              className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-surface-border"
            />
            <figcaption className="text-xs text-ink-faint">{t("yourImage")}</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            {item.match?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.match.imageUrl}
                alt={t("yourMatch")}
                className="aspect-[5/7] w-full rounded-xl object-cover ring-1 ring-holo-cyan/40"
              />
            ) : (
              <span className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border">
                <IconSearch size={24} />
              </span>
            )}
            <figcaption className="text-xs text-ink-faint">
              {item.match ? t("yourMatch") : t("noMatch")}
            </figcaption>
          </figure>
        </div>

        {/* Träff-meta */}
        {item.match && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-ink">{item.match.name}</p>
                <p className="truncate text-sm text-ink-muted">
                  {item.match.setName} · #{item.match.number}
                  {/* Tryckningen är en del av identiteten, inte en detalj: en
                      1st Edition Base Charizard är värd tiofalt en Unlimited. */}
                  {item.match.variantLabel ? ` · ${item.match.variantLabel}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-lg font-semibold tabular-nums text-holo-cyan">
                {item.match.estimatedValue != null ? formatPrice(item.match.estimatedValue) : "–"}
              </p>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {t("conditionMeta", {
                condition: item.condition in CONDITION_LABEL ? tCond(item.condition) : item.condition,
              })}
            </p>
          </div>
        )}

        {/* Alternativ */}
        {/* Varför gissningen är en gissning — sagt rakt ut, inte antytt. Flera
            OLIKA kort låg praktiskt taget lika, så listan nedan är inte
            "alternativ om jag har fel" utan "kort som var precis lika troliga". */}
        {item.uncertain && item.match && (
          <p className="rounded-xl bg-holo-gold/10 px-3 py-2 text-xs leading-relaxed text-holo-gold ring-1 ring-holo-gold/25">
            {t("uncertainMatch")}
          </p>
        )}

        {alternatives.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">
              {item.match ? t("notRight") : t("possibleMatches")}
            </p>
            <div className="flex flex-col gap-1.5">
              {alternatives.map((c) => (
                <button
                  // Nyckeln måste bära TRYCKNINGEN: tre Base-produkter delar
                  // cardId, så cardId ensamt gav dubblettnycklar och React
                  // återanvände fel rad.
                  key={c.productId ?? c.cardId}
                  type="button"
                  onClick={() => props.onChoose(c)}
                  className="flex items-center gap-3 rounded-xl border border-surface-border p-2 text-left transition-colors hover:border-holo-cyan/50 hover:bg-surface-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint">
                      <IconCards size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                      {/* Utan etiketten ser de tre Base-tryckningarna identiska ut
                          i listan — samma namn, samma set, samma nummer. */}
                      {c.variantLabel && (
                        <span className="shrink-0 rounded bg-surface-overlay px-1.5 py-px text-[10px] font-medium text-holo-cyan ring-1 ring-holo-cyan/25">
                          {c.variantLabel}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">
                      {c.setName} · #{c.number}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                    {c.estimatedValue != null ? formatPrice(c.estimatedValue) : "–"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Prisutveckling för träffen — "hur har det här kortet gått?" utan att
            lämna kameran. Ligger EFTER alternativen med flit: rättar man träffen
            byts kortet, och då vore en graf över fel kort det första man såg. */}
        {item.match?.slug && <ScanPriceHistory slug={item.match.slug} />}

        {/* Åtgärder */}
        <div className="flex flex-wrap gap-2">
          {item.match?.slug ? (
            <LinkButton href={`/produkter/${item.match.slug}`} variant="outline">
              {t("showProduct")} <IconArrowRight size={15} />
            </LinkButton>
          ) : (
            <LinkButton
              href={`/produkter?q=${encodeURIComponent(item.match?.name ?? "")}`}
              variant="outline"
            >
              <IconSearch size={15} /> {t("searchManually")}
            </LinkButton>
          )}
          <Button variant="ghost" onClick={props.onRemove}>
            {t("removeScan")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Prisutveckling för det skannade kortet — "har det här gått upp eller ner?"
 * utan att lämna kameravyn.
 *
 * Datat kommer från /api/products/{slug}/detail, SAMMA endpoint som produkt-
 * overlayn: CDN-cachad och backad av `loadProductDetail`s cache, så den kostar i
 * praktiken ingen ny Neon-fråga. Hämtningen sker när DETALJVYN ÖPPNAS, aldrig
 * vid skanningen — en bulk-fångst med nio kort hade annars dragit nio
 * detaljhämtningar som ingen tittar på.
 *
 * ⛔ Grafen ritas bara med minst två punkter. En ensam punkt är ingen utveckling,
 * och en linje mellan ett värde och sig självt påstår en stabilitet vi inte mätt.
 */
function ScanPriceHistory({ slug }: { slug: string }) {
  const t = useTranslations("Scanner");
  const [series, setSeries] = useState<{ date: string; price: number }[] | null>(null);
  const [changes, setChanges] = useState<{ d7: number | null; d30: number | null }>({
    d7: null,
    d30: null,
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSeries(null);
    setFailed(false);
    fetch(`/api/products/${encodeURIComponent(slug)}/detail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("detail"))))
      .then((d: unknown) => {
        if (!alive) return;
        const data = d as {
          chartData?: { date: string; price: number }[];
          change7?: number | null;
          change30?: number | null;
        };
        setSeries(Array.isArray(data.chartData) ? data.chartData : []);
        setChanges({
          d7: typeof data.change7 === "number" ? data.change7 : null,
          d30: typeof data.change30 === "number" ? data.change30 : null,
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Ett tyst fel är rätt här: prisutvecklingen är en bonus i skanningsvyn, och
  // en röd ruta över en misslyckad extrahämtning hade läst som att SKANNINGEN
  // gick fel. Kortet och priset ovanför står kvar oavsett.
  if (failed) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-ink-muted">{t("priceHistory")}</p>
        {series !== null && (changes.d7 !== null || changes.d30 !== null) && (
          <span className="flex shrink-0 items-center gap-2.5">
            {changes.d7 !== null && (
              <span className="flex items-baseline gap-1 text-[11px] text-ink-faint">
                {t("change7d")}
                <PriceChange percent={changes.d7} className="text-xs" hideIcon />
              </span>
            )}
            {changes.d30 !== null && (
              <span className="flex items-baseline gap-1 text-[11px] text-ink-faint">
                {t("change30d")}
                <PriceChange percent={changes.d30} className="text-xs" hideIcon />
              </span>
            )}
          </span>
        )}
      </div>
      {series === null ? (
        // Samma 300px som PriceChart ritar på — annars hoppar arket när datat
        // landar och användaren tappar sin plats mitt i en scroll.
        <div className="h-[300px] w-full animate-pulse rounded-xl bg-surface-overlay" aria-hidden />
      ) : series.length < 2 ? (
        <p className="rounded-xl border border-surface-border px-3 py-6 text-center text-xs text-ink-faint">
          {t("priceHistoryEmpty")}
        </p>
      ) : (
        // data-swipe-ignore: vågrätt drag på grafen är tooltip-scrubbing, inte
        // svep-tillbaka — samma undantag som produktsidans graf har.
        <div data-swipe-ignore className="-mx-1">
          <PriceChartLazy data={series} minimal />
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
 * Svep-för-att-radera — vänstersvep avslöjar röd raderingsyta; släpp förbi
 * halva kortet → radera (samma glid + 0.25s ease som sheet-svepet). Native
 * pointer-events + pan-y så vertikal listscroll förblir webbläsarens.
 * ======================================================================== */
function SwipeToDelete({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const fgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = e.clientX;
      startY = e.clientY;
      fg.style.transition = "none";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      // Vänta tills riktningen är tydlig; vertikalt → släpp till native scroll.
      if (axis === null) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (axis === "y") {
          dragging = false;
          return;
        }
        fg.setPointerCapture(e.pointerId);
      }
      dx = Math.min(0, mx); // bara vänster
      fg.style.transform = `translateX(${dx}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        fg.style.transform = "";
        return;
      }
      fg.style.transition = "transform 0.25s ease";
      if (-dx > fg.offsetWidth / 2) {
        fg.style.transform = "translateX(-110%)";
        window.setTimeout(() => {
          onDelete();
          // Blur:a EFTER att React flyttat fokus (nästa frame) annars hinner
          // CTA:n fånga fokus och visa en cyan ring när listan tömts.
          requestAnimationFrame(() =>
            (document.activeElement as HTMLElement | null)?.blur?.()
          );
        }, 230);
      } else {
        fg.style.transform = "";
      }
    };

    fg.addEventListener("pointerdown", onDown);
    fg.addEventListener("pointermove", onMove);
    fg.addEventListener("pointerup", onUp);
    fg.addEventListener("pointercancel", onUp);
    return () => {
      fg.removeEventListener("pointerdown", onDown);
      fg.removeEventListener("pointermove", onMove);
      fg.removeEventListener("pointerup", onUp);
      fg.removeEventListener("pointercancel", onUp);
    };
  }, [onDelete]);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end bg-fall px-6 text-white"
      >
        <IconTrash size={22} />
      </div>
      <div
        ref={fgRef}
        style={{ touchAction: "pan-y" }}
        className="relative rounded-2xl border border-surface-border bg-surface-raised"
      >
        {children}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Bottom-sheet-primitiv
 * ======================================================================== */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("Scanner");
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // Svep nedåt på handtaget/rubriken för att stänga. Pointer-capture gör att
  // ALLA move-events går hit när fingret väl tagit i handtaget — webbläsarens
  // egen scroll/bounce kan inte stjäla gesten. touch-action:none på handtaget
  // stoppar native scroll från att ens starta där. Transformen skrivs direkt
  // på panelen (mjukare än React-state per ruta). Panelens kropp scrollar som
  // vanligt — draget och scrollen krockar inte eftersom de bor på olika ytor.
  useEffect(() => {
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!panel || !handle) return;
    let startY = 0;
    let dy = 0;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      dy = 0;
      // animate-fade-in-up (fill-mode: both) pinnar transform och överröstar
      // vår inline-transform → måste rensas, annars syns ingen följning/glid.
      panel.style.animation = "none";
      panel.style.transition = "none";
      handle.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      panel.style.transform = `translateY(${dy}px)`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = "transform 0.25s ease";
      if (dy > 100) {
        panel.style.transform = "translateY(110%)";
        window.setTimeout(onClose, 230);
      } else {
        panel.style.transform = "";
      }
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
      />
      <div
        ref={panelRef}
        className="relative max-h-[85%] overflow-y-auto rounded-t-3xl border-t border-surface-border bg-surface-raised p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card animate-fade-in-up"
      >
        {/* Dragyta: handtag + rubrik. touch-action:none → ingen native scroll här. */}
        <div
          ref={handleRef}
          style={{ touchAction: "none" }}
          className="-mx-5 -mt-5 cursor-grab px-5 pb-4 pt-5 active:cursor-grabbing"
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-surface-border" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <IconX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
