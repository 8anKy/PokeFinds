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
import { foilProbeFromRgb, type FoilSample } from "@/lib/foil-probe";
import { frameSharpness, SHARP_AUTO_MIN } from "@/lib/frame-sharpness";
import { readNumberStripNative, warmUpLocalNumberReader } from "@/lib/on-device-number";
import { classifyDrag, shouldCloseSheet } from "@/lib/sheet-drag";
import { useEventCallback } from "@/hooks/use-event-callback";
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
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { hasAuthHint } from "@/lib/auth-hint";
import { deviceHeaders } from "@/lib/device-id";
import { openProductOverlay, registerFullscreenHost } from "@/lib/product-overlay-open";
import { hapticImpact } from "@/lib/haptics";
import { pickAlternatives, pickSameArtRail } from "@/lib/scan-alternatives";
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
  IconChart,
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

/** En variant av samma kort — se ScanVariant i services/scanner/types.ts. */
interface Variant {
  productId: string;
  /** `null` = den ordinarie varianten. */
  label: string | null;
  slug: string;
  estimatedValue: number | null;
}

interface Candidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  slug: string | null;
  /** Vald variant, när kandidaten pekar på en specifik produkt. */
  productId: string | null;
  /** "Reverse Holo" / "1st Edition" … — null = ordinarie. */
  variantLabel: string | null;
  /** Alla varianter kortet finns i, ordinarie först. Saknas när det bara finns en. */
  variants?: Variant[];
  score: number;
  /** Samma KONST som träffen (omtryck) — visas alltid, se alternatives-filtret. */
  sameArt?: boolean;
  /** Plats i BILDENS topplista (1 = bildens bästa gissning) — visas alltid. */
  artRank?: number;
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
  /** De två bästa OLIKA korten är i praktiken OAVGJORDA. Smalare än `ambiguous`
   *  — det är den här som får FRÅGA, se TIE_MARGIN i services/scanner/index.ts. */
  tied?: boolean;
  remaining?: number;
  /** Admin: skanningens jobb-id — gör användarens korrigering till facit. */
  jobId?: string | null;
}

interface ScanQuota {
  remaining: number;
  limit: number;
  isPremium: boolean;
  /** Skannar UTAN konto (appen, enhets-id). 10 livstid; konto ger 20 till. */
  guest?: boolean;
}

/**
 * ⛔ **"choose" ÄR NYTT (2026-08-29) OCH VÄNDER ETT BESLUT FRÅN 2026-07-30.**
 *
 * Förut fanns bara ett svar: låg flera OLIKA kort praktiskt taget lika visades
 * ändå TOPPEN, märkt med ett gult "?". Motiveringen var mätt och rimlig — första
 * versionen svarade "ingen träff" i de lägena och det var sämre än en märkt
 * gissning. Men det var ett val mellan GISSNING och INGENTING; en LISTA var
 * aldrig på bordet, och skillnaden är avgörande av två skäl:
 *
 * 1. En tyst gissning felprissätter samlingen. Tryckning bär riktiga pengar
 *    (Team Rocket 1st Ed 7 537 kr mot 3 254 kr).
 * 2. **Ett val ÄR facit.** Mätt 2026-08-29 fick 54 % av alla mätrader ingen dom
 *    alls, och av 649 domar var bara 2 korrigeringar — grinden "korrigerade
 *    topp-3 ≥ 95 %" har därför varit outvärderingsbar i två veckor. Att FRÅGA
 *    när vi är osäkra är den enda vägen som producerar starkt facit som
 *    biprodukt av normal användning, i stället för att vänta på att någon
 *    självmant öppnar ett ark de inte vet finns.
 *
 * ⚠️ Hur ofta läget fyrar är ÄNNU OMÄTT — `ambiguous` har styrt det gula "?"
 * sedan 2026-07-30 utan att någonsin bokföras. Flaggan skrivs nu som
 * `recall.amb`; läs frekvensen innan tröskeln (MATCH_MARGIN_MIN) rörs.
 */
type ScanStatus = "identifying" | "matched" | "choose" | "nomatch" | "error";

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
  /** Skanningens jobb-id — användarens korrigering rapporteras som facit.
   *  Sätts för ALLA användare sedan 2026-08-15 (var admin-only). */
  jobId?: string | null;
}

/**
 * Användarens eget val ÄR facit — rapportera det (eld-och-glöm, för ALLA sedan
 * 2026-08-15). En korrigering i kandidatlistan betyder att användaren tittat på
 * det fysiska kortet och pekat ut rätt rad; en oförändrad tillägg-till-samlingen
 * är en bekräftelse. Utan detta försvann rättelsen i klienten.
 *
 * ⛔ **`via` ÄR INTE VALFRI I PRAKTIKEN — UTAN DEN MÄTER HINKEN FEL SAK.** Mätt
 * 2026-08-29: 83,4 % av alla domar kom ur ETT tryck på "Lägg till alla", och de
 * innehöll NOLL korrigeringar (0 av 454, mot 2 av 50 aktiva val). Hinken kan
 * alltså bara säga ja. ⚠️ Skillnaden i RECALL är däremot liten inom samma
 * stratum — 6,6 p.e. på topp-1 — så argumentet är uppmärksamhet, inte
 * träffsäkerhet. Skickas ingen `via` går de två inte att skilja i efterhand
 * annat än med skurgissning på tidsstämplarna. Sätt den vid varje anropsställe.
 */
function reportScanFeedback(
  jobId: string | null | undefined,
  cardId: string | null,
  kind: "corrected" | "confirmed" | "rejected" | "searched",
  extra?: {
    via?: "pick" | "bulk" | "auto";
    productId?: string | null;
    /** Samma kort, annan tryckning — en äkta rättelse av PRODUKTEN, inte av kortet. */
    variantChanged?: boolean;
    /** 1-baserad plats i den visade listan. 0 = inte vald därifrån. */
    rank?: number;
  }
) {
  if (!jobId) return;
  fetch("/api/scanner/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId,
      ...(cardId ? { cardId } : {}),
      kind,
      ...(extra?.via ? { via: extra.via } : {}),
      ...(extra?.productId ? { productId: extra.productId } : {}),
      ...(extra?.variantChanged ? { variantChanged: true } : {}),
      ...(extra?.rank != null ? { rank: extra.rank } : {}),
    }),
  }).catch(() => {
    // Facit är trevligt att ha, aldrig värt ett felmeddelande i skannerflödet.
  });
}

/**
 * Vad valsteget erbjuder. ⛔ **EN POST PER KORT, inte per tryckning.**
 *
 * Frågan här är "vilket KORT är det?" — tryckningen väljs efteråt i
 * variantväljaren, som redan finns och är byggd för just det. Utan dedupen
 * fylls raden av tre likadana Base-Charizard och det verkliga alternativet
 * skjuts utanför skärmen. Samma misstag som `pickAlternatives` gör tvärtom och
 * med flit (där ÄR tryckningen frågan).
 *
 * Taket är 6: raden ska gå att överblicka i ett svep. Mätt 2026-08-29 ligger
 * 96,1 % av de kort bilden faktiskt hittar på plats 1–5 och bara 3,9 % på
 * plats 6–15 — svansen är tom, så ett högre tak köper ingenting.
 */
const CHOOSE_OPTIONS_MAX = 6;

function chooseOptions(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.cardId)) continue;
    seen.add(c.cardId);
    out.push(c);
    if (out.length >= CHOOSE_OPTIONS_MAX) break;
  }
  return out;
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

/**
 * Under så här många kvarvarande skanningar stannar kvot-badgen kvar även när
 * användaren redan börjat skanna. ⛔ Håll den låg: badgen ligger i bottenstapeln
 * och äter live-chippet om den syns i onödan (se kommentaren i QuotaBadge).
 */
const LOW_QUOTA = 5;

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
  /** FOLIESOND (base64) ur samma pixelläsning — instrumentering, påverkar inget
   *  i matchningen. Se src/lib/foil-probe.ts. */
  probe: string | null;
  /** Normaliserad medelgradient på kortytan — fångstkvalitet, se
   *  src/lib/frame-sharpness.ts. Null när den inte gick att räkna. */
  sharpness: number | null;
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
  const toB64 = (fp: Int8Array | Uint8Array) => {
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
  // FOLIESOND ur SAMMA pixelläsning, utan inset — alltså exakt den yta det
  // första avtrycket räknas på, vilket är vad serversidan jämför mot kortets
  // referens. Ren instrumentering: den påverkar varken kandidater eller pris,
  // och den kostar en linjär genomgång till av pixlar vi ändå läst.
  const probeBytes = foilProbeFromRgb(fpPixels, fpW, fpH, 4);
  const probe = probeBytes ? toB64(probeBytes) : null;
  // FÅNGSTKVALITET ur exakt samma pixlar — en linjär genomgång till, ingen ny
  // `getImageData`. Se src/lib/frame-sharpness.ts för varför den mäts alls.
  const sharpness = frameSharpness(fpPixels, fpW, fpH, 4);
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
    return { dataUrl: "", fingerprints, structFingerprints, probe, sharpness, crop: "" };
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
    probe,
    sharpness,
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
/**
 * Taket för hur många kort EN bulk-fångst tar. **Vårt eget tal, ingen fysisk
 * gräns** — `detectCardRegions` kapar helt enkelt listan här.
 *
 * 12 → 20 → **15** (2026-08-02). 12 var satt när fältrundorna handlade om 5-6
 * kort och kapade tyst ägarens 15-kortsfångster. 20 höll inte: MÄTT ur
 * ScannerJob-telemetrin, andel celler som avgjordes av BILDEN utan att kosta ett
 * vision-anrop —
 *     12 kort → 42 % · 42 % · 50 % (tre fångster)
 *     15 kort → 47 %
 *     18 kort → 28 %   ← kollapsen
 * 15 ligger alltså i samma band som 12, medan 18 nästan halverar auto-andelen
 * (och dubblar notan: $0,013 mot $0,008). Taket sattes på DEN mätningen, inte på
 * en känsla — och 15 är ägarens egen övre gräns.
 *
 * ⛔ ÄNDRAS DEN HÄR MÅSTE TVÅ ANDRA STÄLLEN FÖLJA MED, annars kapas fångsten
 * ändå — tyst: `cells`-schemats `.max()` i /api/scanner/identify-bulk (Zod
 * avvisar HELA anropet, inte bara överskottet) och `BULK_DETECTOR_MAX_CARDS` i
 * lib/camera-controls.ts (som klampar zoom-förvalens rekommendation; ett test
 * vaktar att de inte glider isär).
 *
 * ⚠️ Kostnaden är linjär i antalet celler: varje cell gör ~4 avtryckssökningar
 * mot indexet i minnet, så 20 celler ≈ 80 sökningar per anrop mot 12 cellers
 * ~48. Ingen ny Neon-läsning (bilden ger kort-id), men CPU per anrop stiger.
 * ⚠️ OMÄTT över 12: fler kort i samma ruta ger färre pixlar per kort, och
 * detekteringen måste hitta smalare springor mellan dem. Höjningen ÖPPNAR för
 * 20, den lovar inte att 20 fungerar lika bra som 12.
 */
const BULK_MAX_CARDS = 15;

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

/**
 * Skanner-anrop bär appens enhets-id (`x-foilio-device`) — det är det som gör
 * gästskanning möjlig och som slår ihop enhetens räknare med kontots. På
 * webben finns inget id och anropet är exakt som förut. Se src/lib/device-id.ts.
 */
async function scanFetch(url: string, init?: RequestInit): Promise<Response> {
  const extra = await deviceHeaders();
  return fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...extra } });
}

// Klient-gate: utloggad → redirecta till login I APPEN (router.replace = SPA-nav,
// ingen hård navigering som Capacitor kastar till Safari). Scanner monteras (och
// kameran startar) först när inloggning bekräftats, så ingen kamera-flash.
//
// GÄSTSKANNING (2026-08-29): i APPEN får en utloggad användare in ändå — som
// gäst på enhets-id, 10 skanningar livstid. Webben kräver konto som förut:
// där finns ingen enhetsidentitet att räkna på.
export default function SkannaPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Kör EN gång ([] deps). Med [router] kunde detta re-köras när kamera-permission
  // beviljas (→ re-render → instabil router-ref) och router.replace loopa = flimmer.
  useEffect(() => {
    if (hasAuthHint()) {
      setAuthed(true);
      return;
    }
    let cancelled = false;
    // ⛔ Allt som kan gå fel här ska sluta i inloggningen, aldrig i en svart
    // sida: getDeviceId har egen tidsgräns, och ett importfel (chunk saknas
    // mitt i en deploy) fångas nedan.
    void import("@/lib/device-id")
      .then(({ getDeviceId }) => getDeviceId())
      .catch(() => null)
      .then((id) => {
        if (cancelled) return;
        if (id) setAuthed(true);
        else router.replace("/logga-in?callbackUrl=/skanna");
      });
    return () => {
      cancelled = true;
    };
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
  /**
   * ⛔ KAMERANS LIVSCYKEL FÅR ALDRIG BERO PÅ `camera`-OBJEKTETS IDENTITET.
   *
   * `stopCamera` anropas av en avmonterings-effekt (`useEffect(() => () =>
   * stopCamera(), [stopCamera])`). Hamnar `camera` i dess beroenden körs den
   * effekten om varje gång objektet byter identitet — och dess CLEANUP river
   * då strömmen. `startCamera` startar om, anropar `attach()`, som sätter state,
   * som renderar om, som byter identitet igen: kameran fastnade i en
   * starta/stoppa-loop och gick aldrig live (2026-08-02).
   *
   * Därför går `attach` via en ref. Då kan varken en glömd `useMemo` i hooken
   * eller ett framtida instabilt fält i den nå livscykeln — `stopCamera` har
   * tomma beroenden och `startCamera` bara `[t]`, precis som före kontrollerna.
   */
  const attachRef = useRef(camera.attach);
  attachRef.current = camera.attach;

  // Streckkodsläget döljs helt där plattformen inte kan läsa koder (iOS/WebKit
  // har ingen BarcodeDetector). En knapp som bevisligen inte fungerar är sämre
  // än ingen knapp — samma regel som zoom-förvalen följer.
  const [canScanBarcodes, setCanScanBarcodes] = useState(false);
  useEffect(() => setCanScanBarcodes(barcodeSupported()), []);
  // Admin: bulk-fångstens detekteringsbild sparas för felsökning mot verkliga foton.
  const isAdmin = useIsAdmin();
  // DIAGNOSTIKREMSAN ÄR BORTTAGEN (ägarbeslut 2026-08-02) — den låg mitt i
  // kameravyn och visade ström/utsnitt/modellsvar för admin.
  // ⛔ Diagnostiken som BETYDER något är kvar och är oförändrad: modellens svar,
  // bildens topp-3 och det valda kortet skrivs till `ScannerJob.result`
  // (recordScanUsage) och läses av scripts/scanner-telemetry.ts,
  // scanner-scoreboard.ts och scanner-replay.ts. Det är DEN datan som gör
  // träffsäkerhet mätbar; skärmremsan var bara en live-titt på samma sak.
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
    /** Rutan är för suddig för att auto-trycka av. Se src/lib/frame-sharpness.ts. */
    blurry: boolean;
  } | null>(null);
  /** Senaste live-pollens skärpa — följer med fångsten upp som mätdata. */
  const lastSharpness = useRef<number | null>(null);
  const liveStreak = useRef<{ id: string; n: number }>({ id: "", n: 0 });
  const livePollBusy = useRef(false);
  /** De senaste live-pollarnas foliesonder (äldst först, max 5 ≈ 3 s). */
  const probeHistory = useRef<string[]>([]);
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
  /** Har brickan redan lagts till? Läses av `removeScan`, som har tomma
   *  beroenden — en state-läsning där hade varit inaktuell. */
  const addedRef = useRef(false);
  const [quota, setQuota] = useState<ScanQuota | null>(null);
  /** Betalväggen när gratiskvoten tar slut. Öppnas av 429 ELLER av slutaren. */
  const [limitOpen, setLimitOpen] = useState(false);

  // Hämta kvoten när skannern öppnas (badge: "X skanningar kvar").
  useEffect(() => {
    let active = true;
    scanFetch("/api/scanner/quota")
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
  /**
   * Skanningar som väntar på ett VAL. ⛔ De blockerar "Lägg till alla" med flit:
   * ett masstryck som tyst hoppar över de osäkra korten hade gjort valsteget till
   * en fälla — användaren tror att allt lades till, och de kort vi var minst säkra
   * på är precis de som försvinner. Knappen ska säga vad som återstår i stället.
   */
  const pendingChoice = useMemo(
    () => scans.filter((s) => s.status === "choose").length,
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
      structFrames?: string[][],
      foil?: FoilSample,
      /** Fångstkvalitet, se src/lib/frame-sharpness.ts. Ren mätdata. */
      sharp?: number | null
    ): Promise<IdentifyResponse | { error: string; httpStatus?: number }> => {
      try {
        // LOKAL NUMMERLÄSNING, SKUGGLÄGE (2026-09-01): i APPEN läser ML Kit
        // samlarnumret on-device ur samma remsa som skickas som `detail`;
        // webben får `undefined` direkt. ⛔ Ren telemetri — servern ändrar
        // inget i svaret på den. Väntas in FÖRE anropet (egen tidsgräns,
        // 2,5 s) så talet hamnar på SAMMA rad som Geminis läsning och facit —
        // en efterhandsrapport hade saknat raden i 43 % av fallen (ingen dom).
        // Se src/lib/on-device-number.ts.
        const localNumber = strip ? await readNumberStripNative(strip) : undefined;
        // Standard = billiga Haiku-modellen (ingen `precise`) — håller scan-kostnaden
        // mot Pro-priset. Sonnet körs bara på uttryckligt "försök igen, skarpare".
        const res = await scanFetch("/api/scanner/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `detail` = närbild på kortets nederkant. Saknas den (galleriuppladdning,
          // där vi inte vet var kortet sitter i bilden) körs det som förut.
          body: JSON.stringify({
            image: dataUrl,
            detail: strip,
            fingerprintFrames,
            structFrames,
            // Instrumentering (foliefrågan). Servern lagrar den bara för admin
            // och den påverkar ingenting i svaret — se src/lib/foil-probe.ts.
            foil,
            // FÅNGSTKVALITET — påverkar heller ingenting i svaret, men bokförs
            // för ALLA (recall.sharp). ⛔ Utan den går tröskeln SHARP_AUTO_MIN
            // inte att sätta på en fördelning, bara på en gissning — och exakt
            // det felet gjorde att vi trodde 79 % av skanningarna var gratis när
            // produktionen låg på 30,5 %.
            ...(sharp != null ? { sharp } : {}),
            ...(localNumber ? { localNumber } : {}),
          }),
        });
        const data = (await res.json()) as IdentifyResponse & { error?: string };
        if (!res.ok) {
          // Statuskoden följer med: 429 (slut på kvoten) ska INTE se ut som
          // "ingen träff" — det var mätbart förvirrande när gränsen slog till.
          return { error: data.error ?? t("genericError"), httpStatus: res.status };
        }
        setProvider(data.provider);
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
      structFrames?: string[][],
      foil?: FoilSample,
      sharp?: number | null
    ) => {
      const data = await runIdentify(
        dataUrl,
        strip,
        fingerprintFrames,
        structFrames,
        foil,
        sharp
      );
      if (!("error" in data) && typeof data.remaining === "number") {
        const r = data.remaining;
        setQuota((q) => (q ? { ...q, remaining: r } : q));
      }
      /**
       * ⛔ ATT TA SLUT PÅ KVOTEN ÄR INGET FEL — det är köpögonblicket.
       *
       * Förut: en röd fel-toast PLUS ett "kort" i remsan vars titel var
       * felmeddelandet. Varje blockerat slutartryck lade till ett skräpkort till
       * (två syntes i fält 2026-08-26), och beskedet hade ingen knapp att trycka
       * på — texten sa "Uppgradera till Pro" utan att vara en länk. Sex
       * gratisanvändare slog i taket i augusti och noll uppgraderade.
       *
       * Nu: raden tas BORT (inget halvfärdigt kort i remsan) och betalväggen
       * öppnas en gång, med en riktig knapp.
       */
      if ("error" in data && data.httpStatus === 429) {
        setQuota((q) => (q ? { ...q, remaining: 0 } : q));
        setLimitOpen(true);
        setScans((prev) => prev.filter((s) => s.id !== id));
        return;
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
            // ⛔ MEN ETT "?" ÄR INTE ETT VAL. Är de två bästa OLIKA korten i
            // praktiken oavgjorda har vi inget svar att påstå — då frågar vi i
            // stället för att gissa och märka gissningen. Se ScanStatus ovan för
            // varför beslutet från 2026-07-30 vändes.
            // ⛔ **VILLKORET ÄR `tied`, INTE `ambiguous`.** `ambiguous` (0,05)
            // MÄRKER en gissning och är generös med flit; att FRÅGA på samma
            // tröskel provades 2026-07-30 och gjorde att "de flesta kort blev
            // 'ingen träff'" (commit 8c7529c vände det). `tied` (0,01) fångar
            // det uppmätta läget där svaret är ren tärningskastning — nio
            // Gyarados på exakt 1,000. ⚠️ Frekvensen är ÄNNU OMÄTT; `recall.amb`
            // börjar bokföras nu. Läs den innan tröskeln rörs.
            // ⚠️ Kräver ≥2 olika KORT, inte ≥2 kandidater: en lista som bara
            // innehåller tryckningar av samma kort är inget val mellan kort, och
            // variantväljaren i raden hanterar den frågan bättre.
            const distinctCards = new Set(data.candidates.map((c) => c.cardId)).size;
            if (data.tied && distinctCards >= 2) {
              return {
                ...s,
                status: "choose",
                // ⛔ INGEN FÖRVALD TRÄFF. Sätts `match` här smyger vi tillbaka
                // en vinnare, och då är valet en formalitet användaren trycker
                // förbi — vilket är exakt hur "Lägg till alla" blev 82 % av
                // vårt facit utan att någon granskat ett kort.
                match: null,
                candidates: data.candidates,
                confidence: data.confidence,
                uncertain: true,
                jobId: data.jobId ?? null,
              };
            }
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
    [runIdentify]
  );

  // ---- Kamera --------------------------------------------------------------

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    attachRef.current(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

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
      attachRef.current(stream);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setCameraState("live");
      // Ladda ML Kit-modellen medan användaren riktar in kortet — annars äter
      // första skanningens modellstart (~1 s på Android) ur läsningens tidsgräns.
      // No-op på webben. Se src/lib/on-device-number.ts.
      warmUpLocalNumberReader();
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
  }, [t]);

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

  /**
   * ÅTERUPPTA EN AVBRUTEN KAMERA.
   *
   * ⛔ `window.confirm` är en NATIV dialog, och WebView:n pausar `<video>` när
   * den tar över — men återupptar den ALDRIG när den stängs. Den som svarade
   * "Avbryt" på osparade-träffar-frågan stod därför kvar i skannern med en
   * frusen bild. Kameran var aldrig trasig; elementet var pausat.
   *
   * Har OS:et dessutom avslutat spåret (inkommande samtal, en annan app tog
   * kameran) hjälper ingen `play()` — då MÅSTE strömmen öppnas om.
   */
  const resumeCamera = useCallback(() => {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || track.readyState === "ended") {
      stopCamera();
      void startCamera();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [startCamera, stopCamera]);

  // Returnerar false om stängningen avbröts (osparade träffar) → svep-gesten
  // fjädrar tillbaka i stället för att lämna skannern osynlig utanför skärmen.
  const closeScanner = useCallback((): boolean => {
    if (scans.length > 0 && addedCount === null) {
      const ok = window.confirm(t("unsavedConfirm", { count: scans.length }));
      // Återupptagningen ligger HÄR och inte hos den som sveper: dialogen kan
      // avbrytas från krysset, Escape och svep-gesten, och alla tre lämnade
      // annars en frusen bild efter sig.
      if (!ok) {
        resumeCamera();
        return false;
      }
    }
    stopCamera();
    // Skannern ÄR fliken nu → stäng = lämna fliken (router, ej hård nav i Capacitor).
    router.back();
    return true;
  }, [scans.length, addedCount, stopCamera, resumeCamera, router, t]);

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

  // ⛔ EN ENGÅNGS-play() KAN TÄVLA MED PAUSEN OCH FÖRLORA. WebView:n pausar
  // videon när en nativ dialog tar över, och ibland sker det EFTER att dialogen
  // redan stängts — då hinner vår återupptagning först och blir överkörd.
  // Lyssna därför på elementets egen pause-händelse så länge kameravyn är uppe:
  // finns strömmen kvar är en paus alltid ett avbrott, aldrig en avsikt (vi
  // pausar aldrig själva). Saknas strömmen håller vi på att stänga ner, och då
  // SKA den vara pausad.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || view !== "capture") return;
    const onPause = () => {
      if (!streamRef.current) return;
      void video.play().catch(() => undefined);
    };
    video.addEventListener("pause", onPause);
    return () => video.removeEventListener("pause", onPause);
  }, [view, cameraState]);

  // LIVE-POLLEN: fingeravtryck ur aktuell videoruta ~var 600:e ms medan
  // kameravyn är aktiv. Varje poll är ~1 kB upp och ~40 ms server-CPU mot
  // indexet i minnet — ingen bild, ingen modell, ingen kvot. En poll i taget
  // (busy-ref) så en seg lina inte staplar förfrågningar.
  useEffect(() => {
    // Bulk-läget pollar inte: låset/chippen är enkortsbegrepp, och 9 celler
    // × 2 poll/s hade varit CPU utan mottagare. Streckkodsläget pollar sin egen
    // detektor (se nedan) och har ingen konstbild att matcha mot.
    // ⛔ PAUSA NÄR ETT ARK LIGGER ÖVER KAMERAN. Pollen sätter state var 600:e ms
    // och renderade alltså om HELA skannern medan användaren läste detaljvyn —
    // vilket rev och satte om arkets drag-lyssnare mitt i ett svep (se
    // use-event-callback.ts). Den är dessutom ren kostnad: ~1,6 anrop i sekunden
    // mot /api/scanner/identify-art för en kameravy ingen tittar på.
    if (
      cameraState !== "live" ||
      view !== "capture" ||
      mode !== "single" ||
      detailsId !== null ||
      settingsOpen
    ) {
      setLiveHint(null);
      liveStreak.current = { id: "", n: 0 };
      probeHistory.current = [];
      return;
    }
    const iv = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || livePollBusy.current || document.hidden) return;
      const shot = captureFrame(video, canvas, frameRef.current, true);
      if (!shot || shot.fingerprints.length === 0) return;
      // TEMPORAL FOLIESIGNAL: pollarna ligger 600 ms isär, alltså ~2 s
      // handhållen rörelse innan slutaren går — spekulära reflexer flyttar sig
      // över den tiden, tryckfärg gör det inte. Sonderna räknades redan här
      // och kastades; nu behålls de fem senaste och följer med fångsten upp.
      if (shot.probe) {
        const h = probeHistory.current;
        h.push(shot.probe);
        if (h.length > 5) h.shift();
      }
      livePollBusy.current = true;
      scanFetch("/api/scanner/identify-art", {
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
          // ⛔ FÅNGSTKVALITETEN ÄR EN EGEN GRIND, OBEROENDE AV MATCHNINGEN.
          // Låset kräver att BILDMATCHNINGEN är stabil och säker — men en
          // rörelsesuddig ruta kan mycket väl ge tre stabila träffar på FEL
          // kort, och då fyrar auto-slutaren på en fångst ingen människa hade
          // tryckt av på. Mätt 2026-08-29 är takten den enda felkällan i datan
          // med en mekanism: < 1,5 s mellan skanningar ger 34,1 % missar mot
          // 15,3 % vid > 60 s, och gradienten håller inom BÅDA de tunga
          // användarna. Se src/lib/frame-sharpness.ts.
          const sharp = shot.sharpness;
          lastSharpness.current = sharp;
          // Null = måttet gick inte att räkna (för liten yta, helt svart ruta).
          // ⛔ Behandla det som "vet inte", inte som "suddig": att blockera på ett
          // uteblivet mått hade gjort auto-fångsten oberäknelig på enheter där
          // ytan råkar bli liten.
          const blurry = sharp != null && sharp < SHARP_AUTO_MIN;
          const locked = liveStreak.current.n >= 3 && d?.confident === true;
          lockedPolls.current = locked && !blurry ? lockedPolls.current + 1 : 0;
          // ⛔ CHIPPET NAMNGER ALDRIG ETT KORT VI INTE ÄR SÄKRA PÅ.
          // /identify-art returnerar ALLTID en topp-5 — sökningen har inget
          // "hittade inget", bara "närmast". En ruta HELT UTAN kort får därför
          // också ett namn: mätt i emulatorn 2026-09-03 gav en bokhylla
          // "Litleo (JP) #66" → "Woobat #71" → "Shuckle #136" i tur och ordning,
          // och efter avtryckningen stod "Shuckle #136" kvar RAKT OVANFÖR
          // resultatet "Ingen träff" — två motsägande besked samtidigt.
          // `confident` ÄR trust-regeln (poäng + marginal, 100 % uppmätt
          // precision i identifyCardArt) och är den enda signal vi har på att
          // det ens ligger ett känt kort i ramen. Under den: inget chip alls.
          // ⛔ Visa inte "söker…" i stället — hjälptexten under ramen säger
          // redan vad handen ska göra, och ett chip som blinkar förbi vid varje
          // poll är brus. Tystnad är det ärliga läget.
          // ⛔ Grinden gäller BARA chippet. `liveStreak`, `locked` och
          // auto-fångsten räknas vidare precis som förut — auto-fångsten kräver
          // ändå `confident`, så ingen fångstlogik ändras av det här.
          setLiveHint(
            d?.confident === true ? { name: top.name, number: top.number, locked, blurry } : null
          );
          // AUTO-FÅNGST: låset har hållit ≥2 pollar efter att det tändes, och
          // det här kortet har inte redan auto-fångats. Kvot-slut auto-trycker
          // inte (bara toast-spam annars); manuellt tryck funkar som vanligt.
          // ⛔ `!blurry` grindar BARA den här automatiken. Ett manuellt tryck går
          // alltid igenom — en kamera som vägrar fotografera är trasig, inte
          // försiktig, och tröskeln är ännu okalibrerad (talet bokförs nu för
          // att kunna sättas på en fördelning i stället för på en gissning).
          if (
            locked &&
            !blurry &&
            lockedPolls.current >= 3 &&
            autoFired.current !== top.cardId &&
            (quotaRef.current == null || quotaRef.current.remaining > 0)
          ) {
            autoFired.current = top.cardId;
            hapticImpact();
            captureRef.current?.();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          livePollBusy.current = false;
        });
    }, 600);
    return () => window.clearInterval(iv);
  }, [cameraState, view, mode, detailsId, settingsOpen]);


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
  const closeSwipe = useEventCallback(closeScanner);
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
          // Avbrutet (osparade träffar) → fjädra tillbaka in. Kameran
          // återupptas av closeScanner självt — dialogen kan avbrytas från
          // flera håll och alla ska sluta likadant.
          if (!closeSwipe()) el.style.transform = "";
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
    // ⛔ `closeSwipe` MÅSTE ha stabil identitet: `closeScanner` byter identitet
    // varje gång `scans` ändras, och en skanning blir klar ASYNKRONT — mitt i
    // ett svep hade lyssnarna rivits och gesten dött halvvägs ut. Exakt samma
    // fälla som arkets svep-ner (se use-event-callback.ts).
  }, [closeSwipe]);

  // ---- Fånga / ladda upp ---------------------------------------------------

  const addScan = useCallback(
    // `strip` följer med den fångade rutan. Skickas den INTE med som argument
    // utan läses ur en ref vid anropstillfället, ärver en galleriuppladdning
    // närbilden från förra kamerarutan — dvs nederkanten på ett HELT ANNAT kort.
    (
      dataUrl: string,
      strip?: string,
      fingerprintFrames?: string[][],
      structFrames?: string[][],
      foil?: FoilSample,
      sharp?: number | null
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
      void identifyInto(id, dataUrl, strip, fingerprintFrames, structFrames, foil, sharp);
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
      void scanFetch("/api/scanner/identify-gtin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtin }),
      })
        .then((r) => r.json())
        .then(
          (d: {
            found?: boolean;
            match?: Candidate | null;
            remaining?: number;
            /** ⛔ Servern har returnerat den här sedan 2026-08-18 — klienten läste
             *  den aldrig, så `s.jobId` förblev undefined och `reportScanFeedback`
             *  returnerade direkt. En användare som rättade en felmappad
             *  streckkodsträff fick rättelsen tyst bortkastad. Exakt samma bugg som
             *  0db70e3 (bulk-vägens facit), och den enda anledningen att förlusten
             *  var NOLL är att 0 streckkodsrader skrevs efter 08-18. */
            jobId?: string | null;
          }) => {
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
                        jobId: d.jobId ?? null,
                      }
                    : // Koden lästes RÄTT men finns inte i katalogen — det är inte
                      // ett fel i skanningen, och felmeddelandet ska säga just det.
                      {
                        ...s,
                        status: "nomatch",
                        errorMessage: t("barcodeNotFound"),
                        jobId: d.jobId ?? null,
                      }
              )
            );
          }
        )
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
            hapticImpact();
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
    // FÅNGSTKVALITETEN TAS SOM MAX ÖVER RUTORNA, aldrig som medelvärde — av
    // exakt samma skäl som servern tar varje korts BÄSTA likhet över insetsvepet:
    // bara EN ruta är den avgörande, och ett medelvärde drar ner den med brus
    // från de rutor som råkade fångas mitt i en rörelse.
    const sharps: number[] = shot.sharpness != null ? [shot.sharpness] : [];
    let taken = 1;
    const grabNext = () => {
      if (taken >= CAPTURE_FRAMES) {
        addScan(
          shot.dataUrl,
          shot.stripDataUrl,
          frames,
          structFrames,
          // Sonden för DEN fångade rutan + live-pollens sonder (600 ms isär).
          // Historiken tas som den är: den beskriver de sista sekunderna av
          // samma scen, vilket ÄR den temporala signalen.
          shot.probe ? { probe: shot.probe, history: [...probeHistory.current] } : undefined,
          sharps.length ? Math.max(...sharps) : null
        );
        // Nollställ efter användning: nästa korts första skanning får INTE bära
        // sonder från det förra kortets scen — då mäter den temporala signalen
        // ett kortbyte i stället för folieglans.
        probeHistory.current = [];
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
          if (extra.sharpness != null) sharps.push(extra.sharpness);
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
    setScans((prev) => {
      // ⛔ ATT RADERA ÄR OCKSÅ ETT SVAR — och det kastades tyst till 2026-08-29.
      // En raderad skanning betyder "det här dög inte", vilket är facit av precis
      // den sort bekräftelsehinken saknar: den är anrikad med de SVÅRA fallen.
      // 54 % av alla mätrader saknade dom helt, och den som inte hittar sitt kort
      // ger upp — det här stänger en del av det hålet.
      //
      // ⛔ **MEN INTE EFTER ATT BRICKAN LAGTS TILL.** Är korten redan i samlingen
      // är ett tryck på "Ta bort" en STÄDNING av remsan, inte ett underkännande —
      // och eftersom "rejected" väger tyngre än "confirmed" hade det skrivit över
      // en riktig bekräftelse med sin motsats. Ett facit som betyder olika saker
      // före och efter ett knapptryck är värre än inget facit.
      const s = addedRef.current ? undefined : prev.find((x) => x.id === id);
      if (s) {
        reportScanFeedback(s.jobId, s.match?.cardId ?? null, "rejected", {
          via: "pick",
          productId: s.match?.productId,
        });
      }
      return prev.filter((x) => x.id !== id);
    });
    setDetailsId((d) => (d === id ? null : d));
  }, []);

  const chooseCandidate = useCallback((id: string, cand: Candidate) => {
    setScans((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        // ANVÄNDARENS VAL ÄR FACIT: valde hen ett ANNAT KORT än skannerns är
        // det en korrigering (hen tittar på det fysiska kortet); samma kort =
        // bekräftelse. (Sidoeffekt i updatern: kan dubbelköras i dev-StrictMode
        // — servern skriver samma värde idempotent, så det är ofarligt.)
        //
        // ⛔ **JÄMFÖRELSEN GÖRS PÅ KORTET, MEN TRYCKNINGEN MÅSTE ÄNDÅ MED.**
        // Raden expanderar VARIANTER till egna poster som delar `cardId`, så ett
        // byte ordinarie → reverse holo träffade `cardId === cardId` och skrevs
        // som "confirmed". Mätt 2026-08-29: i 378 av 649 domar (58,2 %) hade
        // raden exakt ETT kort men flera varianter — dvs i majoriteten av fallen
        // var den enda NÅBARA rättelsen också den enda som mislabelades.
        // ⛔ Men den får INTE bli en "corrected": ett variantbyte bär samma
        // `cardId` och därmed samma artRank som en bekräftelse, så det skulle
        // kontaminera korrigeringshinken precis som `src: "art"` gjorde. Den
        // bokförs som en EGEN signal (`variantChanged`).
        const sameCard = cand.cardId === s.match?.cardId;
        reportScanFeedback(s.jobId, cand.cardId, sameCard ? "confirmed" : "corrected", {
          via: "pick",
          productId: cand.productId,
          variantChanged: sameCard && cand.productId !== s.match?.productId,
          // ⛔ PLATSEN I SERVERNS KANDIDATLISTA, INTE I SVEP-RADEN — och det är
          // med flit. Raden är omsorterad (sameArt → artRank → namn → poäng) och
          // variantexpanderad, så dess index går inte att jämföra med något.
          // `s.candidates` ÄR listan som bokförs som `recall.shown`, alltså den
          // enda rang som går att ställa mot bildens egen topplista i rapporten.
          // Utan den går "vi hade rätt kort på plats 2" inte att skilja från
          // "plats 9". 0 = kortet fanns inte i listan alls.
          rank: s.candidates.findIndex((c) => c.cardId === cand.cardId) + 1,
        });
        // Användaren valde själv ur listan → inte längre en gissning.
        return { ...s, status: "matched", match: cand, uncertain: false };
      })
    );
    // ⛔ ARKET STÄNGS INTE AV ETT VAL (ägarbeslut 2026-08-04). Att välja
    // variant är inte att vara klar: man vill se att rätt rad blev markerad,
    // jämföra priset och ofta öppna prishistoriken direkt efteråt. Att kastas
    // tillbaka till kameran mitt i det gjorde valet till en enkelbiljett.
    // Arket stängs BARA av användaren — svep ner eller krysset.
  }, []);

  async function addAll() {
    if (matched.length === 0) return;
    // Gäst: samlingen kräver konto. Skicka till registreringen i stället för
    // att låta /api/collection svara 401 — och det är dessutom det bästa
    // säljögonblicket: kortet är hittat och användaren vill spara det.
    if (quota?.guest) {
      router.push("/registrera?callbackUrl=/skanna");
      return;
    }
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
          //
          // ⛔ **`via: "bulk"` ÄR DET SOM GÖR DEN HÄR RADEN LÄSBAR.** Ett tryck
          // här skickar EN bekräftelse per kort i hela brickan — användaren har
          // inte tittat på det enskilda kortet. Mätt 2026-08-29: sådana rader var
          // 83,4 % av allt facit och innehöll NOLL korrigeringar (0 av 454, mot
          // 2 av 50 aktiva val). Summeras de med de granskade valen mäter
          // rapporten knapptryckningsfrekvens i stället för träffsäkerhet.
          reportScanFeedback(s.jobId, s.match!.cardId, "confirmed", {
            via: "bulk",
            productId: s.match!.productId,
          });
        }
      } catch {
        /* fortsätt med nästa */
      }
    }
    setAddingAll(false);
    addedRef.current = true;
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
          onUpgrade={() => router.push(quota?.guest ? "/registrera?callbackUrl=/skanna" : "/priser")}
          onRetryCamera={() => void startCamera()}
          // ⛔ `quota != null` krävs: `null` betyder "vet inte än", och att gissa
          // "slut" hade sålt Pro till en betalande kund varje gång skannern öppnas.
          outOfQuota={quota != null && !quota.isPremium && quota.remaining <= 0}
          onUpgradePrompt={() => setLimitOpen(true)}
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
          pendingChoice={pendingChoice}
          total={total}
          addingAll={addingAll}
          addedCount={addedCount}
          onPatch={patchScan}
          onRemove={removeScan}
          onChoose={chooseCandidate}
          onOpenDetails={setDetailsId}
          onAddAll={() => void addAll()}
          onScanMore={() => {
            setScans([]);
            setAddedCount(null);
            // Ny bricka ⇒ raderingar är återigen ett underkännande, inte städning.
            addedRef.current = false;
            setView("capture");
          }}
          onClose={closeScanner}
        />
      )}

      {/* Betalvägg när gratiskvoten är slut. Samma ark-form som resten av
          appen — inte en toast: det här är köpögonblicket, inte ett fel.
          ⛔ `limit` är GRÄNSEN, inte hur många kort användaren skannat — de
          sammanfaller bara för den som står exakt på taket. Copyn säger därför
          "gratisplanen ger N", aldrig "du har skannat N". */}
      {limitOpen && (
        <ScanLimitSheet
          limit={quota?.limit ?? 30}
          guest={quota?.guest === true}
          onClose={() => setLimitOpen(false)}
          onUpgrade={() => {
            setLimitOpen(false);
            router.push(quota?.guest ? "/registrera?callbackUrl=/skanna" : "/priser");
          }}
          onLogin={() => {
            setLimitOpen(false);
            router.push("/logga-in?callbackUrl=/skanna");
          }}
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
  const { remaining, isPremium, guest } = quota;
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
  /**
   * ⛔ BÅDA RADERNA ÄR ENRADIGA (`truncate`) — ANNARS BESTÄMMER SPRÅKET HÖJDEN.
   *
   * Badgen har fast bredd, och "GRATIS"-pillret är bredare än "PRO". Den svenska
   * underraden ("Tryck här för fler med Pro", 26 tecken) fick därför mindre plats
   * än den engelska och bröt till en TREDJE rad — gratis-badgen blev synligt
   * klumpigare än Pro-badgen, fast de skulle se lika ut (rapporterat 2026-08-26).
   * Med `truncate` är höjden två rader i ALLA språk, oavsett hur långt någon
   * översätter. Texterna är dessutom korta nog att inte kapas.
   */
  const body = (
    <span className="min-w-0 flex-1 text-left">
      {/* Pro-raden var ett ensamt "∞" ett kort tag (2026-08-02) — det såg ut som
          ett renderingsfel bredvid "Förnyas nästa månad" och rullades tillbaka
          till text samma dag. */}
      <span className="block truncate text-sm font-semibold text-ink">
        {/* Pro säljs som OBEGRÄNSAT — då ska ingen nedräkning visas. Taket i
            koden är ett skydd mot skenande loopar, inte en produktgräns, och en
            siffra här hade läst som "du har X kvar" av en kund som betalat för
            obegränsat. Träffas taket säger felmeddelandet det då det händer. */}
        {/* Vid noll läser "0 skanningar kvar" som en nedräkning som gick fel;
            säg vad tillståndet ÄR i stället. */}
        {isPremium
          ? t("scansUnlimited")
          : remaining <= 0
            ? t("limitBadge")
            : t("scansLeft", { count: remaining })}
      </span>
      <span className="block truncate text-xs text-ink-muted">
        {isPremium ? t("renewsNextMonth") : t("tapForMore")}
      </span>
    </span>
  );
  // Lika bred som kortramen i kameravyn (w-[68%] max-w-[20rem] av helskärm).
  //
  // ⛔ HÅLL DEN LÅG. Badgen sitter i bottenstapeln, och LIVE-CHIPPET (kortets
  // namn + nummer) hänger 36 px under kortramen — växer badgen uppåt äter den
  // chippet, vilket är den enda återkoppling användaren har på att kameran
  // känner igen kortet. Rapporterat i fält 2026-08-09: "30 skanningar kvar"
  // täckte halva korttexten. Två rader ryms, men bara med tajt luft.
  const cls =
    "mx-auto flex w-[min(68vw,20rem)] items-center gap-2.5 rounded-2xl bg-black/70 px-3.5 py-2 ring-1 ring-white/10 backdrop-blur";
  // GÄST: badgen ÄR erbjudandet. "10 av 10 gratis kvar · Skapa konto → 30 a…"
  // sa inte vad man fick och kapades (fält 2026-08-29). Rubriken är nu vinsten
  // ("Få 20 skanningar till"), underraden vägen + räknaren. Inget GRATIS-pill —
  // det åt bredden utan att säga något gästen inte redan vet. Turkos ring så
  // den läses som en knapp, inte som status.
  if (guest) {
    const empty = remaining <= 0;
    return (
      <button
        type="button"
        onClick={onUpgrade}
        className={cn(
          cls,
          "w-[min(80vw,22rem)] ring-holo-cyan/50 transition-colors hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
        )}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-ink">
            {empty ? t("guestLimitBadge") : t("guestHeadline")}
          </span>
          <span className="block truncate text-xs text-ink-muted">
            {empty
              ? t("guestEmptySub")
              : t("guestSub", { count: remaining, limit: quota.limit })}
          </span>
        </span>
        <IconArrowRight size={18} className="ml-auto shrink-0 text-holo-cyan" />
      </button>
    );
  }
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
 * Zoom-förvalen längs kamerans högerkant.
 *
 * ⛔ Bara de förval enheten FAKTISKT når renderas — `use-camera-controls`
 * filtrerar listan, och en 0,5×-knapp som inte gör något är sämre än ingen
 * knapp. Är 1× det enda nåbara förvalet ritas ingen rad alls (en ensam pill är
 * brus). Ficklampan bor INTE här utan i bottenraden, bredvid bekräfta-knappen:
 * den ska nås med tummen, inte ligga i vägen för motivet.
 *
 * Korttalen (`maxCards`) är UPPSKATTNINGAR från geometrin, inte mätningar —
 * därför "ca" i copyn. Se ZOOM_PRESET_MAX_CARDS i lib/camera-controls.ts.
 */
function CameraControls(props: {
  zoomPresets: ZoomPresetOption[];
  zoom: ZoomPreset;
  onZoom: (p: ZoomPreset) => void;
  /** Korttalet är bara meningsfullt i bulk — ett kort i taget är ett kort. */
  showCardHint: boolean;
}) {
  const t = useTranslations("Scanner");
  const zoomLabel = (p: ZoomPreset) =>
    p === 0.5 ? t("zoomHalf") : p === 2 ? t("zoomTwo") : t("zoomOne");
  if (props.zoomPresets.length <= 1) return null;
  return (
    <div className="absolute inset-y-0 right-3 z-20 flex flex-col items-end justify-center">
      <div className="flex flex-col items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur">
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
              props.zoom === o.preset ? "bg-holo-cyan text-black" : "text-ink hover:bg-white/10"
            )}
          >
            {zoomLabel(o.preset)}
          </button>
        ))}
      </div>
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
  liveHint: { name: string; number: string; locked: boolean; blurry: boolean } | null;
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
  /** Gratiskvoten slut → slutaren säljer i stället för att skanna. */
  outOfQuota: boolean;
  onUpgradePrompt: () => void;
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
          // ⛔ z-30, ÖVER bottenstapeln (z-20). Live-chippet hänger 36 px under
          // kortramen och låg tidigare på z-10 → bottenstapeln målade över det,
          // så kvot-badgen dolde kortnamnet kameran just känt igen (rapporterat
          // i fält 2026-08-09). Att bara krympa badgen räcker inte: avståndet
          // beror på skärmhöjden, och nästa telefon har en annan. Overlayn är
          // `pointer-events-none` och ritar bara hörnmarkörer + chippet, så den
          // stjäl inga tryck från zoom-kontrollerna. Capture-flashen ligger kvar
          // överst: samma z-30 men SENARE i DOM:en.
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
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
                  props.liveHint.blurry
                    ? "bg-holo-gold text-black"
                    : props.liveHint.locked
                      ? "bg-holo-cyan text-black"
                      : "bg-black/60 text-ink ring-1 ring-white/15"
                )}
              >
                {/* ⛔ SUDDIGT SLÅR LÅST I CHIPPET. Ett grönt lås på en ruta vi
                    just vägrat auto-trycka av på är motsägelsefullt — och det
                    enda användaren kan GÖRA något åt är skärpan. Beskedet ska
                    säga vad handen ska göra, inte vad matchningen tycker. */}
                {props.liveHint.blurry ? (
                  t("holdStill")
                ) : (
                  <>
                    {props.liveHint.locked && <IconCheck size={13} />}
                    {props.liveHint.name} #{props.liveHint.number}
                  </>
                )}
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

      {/* Zoom-förvalen — bara medan kameran faktiskt visar bild. */}
      {cameraState === "live" && (
        <CameraControls
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
        {/* ⛔ Badgen doldes så fort man skannat ett enda kort, så väggen kom
            utan förvarning mitt i en pärm. Den stannar kvar när det börjar ta
            slut — det är precis då den är värd sin plats. Vid gott om kvot
            döljs den fortfarande, annars äter den live-chippet. */}
        {quota && (scans.length === 0 || (!quota.isPremium && quota.remaining <= LOW_QUOTA)) && (
          <QuotaBadge quota={quota} onUpgrade={props.onUpgrade} />
        )}

        {isMock && (
          <p className="mx-auto rounded-full bg-black/70 px-3 py-1 text-center text-[11px] font-medium text-holo-gold ring-1 ring-holo-gold/30 backdrop-blur">
            {t("demoMode")}
          </p>
        )}

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
          {/* ⛔ SLUTAREN FÅR INTE FYRA MOT EN TOM KVOT. Auto-fångsten har alltid
              respekterat kvoten; det manuella trycket gjorde det inte, så en
              användare kunde trycka om och om igen och få ett blockerat anrop
              varje gång. Knappen är kvar och aktiv — den gör bara något annat:
              öppnar betalväggen i stället för att skicka en dömd förfrågan. En
              grå slutare hade läst som att kameran gått sönder. */}
          <button
            type="button"
            onClick={props.outOfQuota ? props.onUpgradePrompt : props.onCapture}
            disabled={cameraState !== "live"}
            aria-label={props.outOfQuota ? t("limitBadge") : t("takePhoto")}
            className={cn(
              "flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full ring-4 ring-white/30 transition-transform",
              "disabled:opacity-40",
              shutterCooling ? "scale-90" : "active:scale-90"
            )}
          >
            <span
              className={cn(
                "h-[3.6rem] w-[3.6rem] rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.4)]",
                props.outOfQuota ? "bg-holo-cyan" : "bg-white"
              )}
            />
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

          {/* FICKLAMPAN sitter längst till höger, bredvid bekräfta-knappen
              (ägarbeslut 2026-08-02). Platsen var en ren symmetri-spacer mot
              galleriknappen, så lampan får den utan att rubba raden — och den
              hamnar i tumzonen i stället för uppe vid kameraramen, där den låg
              ivägen för själva motivet. Saknas torch på enheten (desktop,
              framkamera, hela iOS) står spacern kvar, annars tappar raden sin
              balans och slutaren glider ur mitten. */}
          {props.torchSupported ? (
            <button
              type="button"
              onClick={props.onToggleTorch}
              aria-pressed={props.torchOn}
              aria-label={props.torchOn ? t("torchTurnOff") : t("torchTurnOn")}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan",
                props.torchOn
                  ? "bg-holo-cyan text-black hover:bg-holo-cyan/90"
                  : "bg-white/10 text-ink hover:bg-white/15"
              )}
            >
              <IconFlashlight size={20} />
            </button>
          ) : (
            <span className="h-12 w-12" aria-hidden="true" />
          )}
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
              ) : s.status === "choose" ? (
                /* ⛔ ETT VÄNTANDE VAL ÄR INTE EN MISS. Utan den här grenen föll
                   choose-poster ner i else:et och remsan sa "ingen träff" i rött
                   om en skanning som hittade FLERA möjliga kort — motsatsen till
                   sanningen, och den sortens besked får folk att skanna om i
                   stället för att svara. */
                <span className="block text-[11px] font-medium leading-tight text-holo-gold">
                  {t("whichCard")}
                </span>
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
  /** Skanningar i "choose"-läge — blockerar masstillägget, se pendingChoice. */
  pendingChoice: number;
  total: number;
  addingAll: boolean;
  addedCount: number | null;
  onPatch: (id: string, patch: Partial<ScanItem>) => void;
  onRemove: (id: string) => void;
  onChoose: (id: string, cand: Candidate) => void;
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
    pendingChoice,
    total,
    addingAll,
    addedCount,
    onPatch,
    onRemove,
    onChoose,
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
                          {/* Versionen står i raden, inte bara i väljaren nedanför:
                              den avgör priset till höger och vilken produkt som
                              hamnar i samlingen. */}
                          {s.match.variantLabel ? ` · ${s.match.variantLabel}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-holo-cyan">
                        {s.match.estimatedValue != null ? formatPrice(s.match.estimatedValue) : "–"}
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                      {/* VERSIONEN ÄR ETT VAL, INTE EN GISSNING: en reverse holo har
                          samma konst och samma nummer som det ordinarie kortet, och
                          foliemönstret finns varken i konstavtrycket eller i modellens
                          svar. Skannern kan alltså inte veta — men användaren håller
                          kortet i handen. Ligger bredvid skicket av samma skäl: det är
                          samma sorts uppgift, och den ska sättas INNAN kortet läggs i
                          samlingen (produkten avgör pris, länk och samlingsvärde). */}
                      {s.match.variants && s.match.variants.length > 1 && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-ink-faint">{t("variant")}</span>
                          <Select
                            value={s.match.productId ?? ""}
                            onChange={(e) => {
                              const v = s.match?.variants?.find(
                                (x) => x.productId === e.target.value
                              );
                              if (!v || !s.match) return;
                              onPatch(s.id, {
                                match: {
                                  ...s.match,
                                  productId: v.productId,
                                  variantLabel: v.label,
                                  slug: v.slug,
                                  estimatedValue: v.estimatedValue,
                                },
                              });
                            }}
                            className="h-9 text-sm"
                          >
                            {s.match.variants.map((v) => (
                              <option key={v.productId} value={v.productId}>
                                {v.label ?? t("variantStandard")}
                              </option>
                            ))}
                          </Select>
                        </label>
                      )}
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
              ) : s.status === "choose" ? (
                /* VALSTEGET (2026-08-29). Ligger INLINE i granskningsraden, inte
                   bakom miniatyrbilden: den vägen krävde två tryck på en omärkt
                   affordans och användes i praktiken aldrig — 2 av 649 domar var
                   korrigeringar. Ett val som ska ske måste synas där blicken är. */
                <div className="p-3">
                  <div className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.captured}
                      alt={t("yourImage")}
                      className="h-24 w-[4.3rem] shrink-0 rounded-md object-cover ring-1 ring-holo-gold/40"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{t("whichCard")}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                        {t("whichCardHelp")}
                      </p>
                    </div>
                  </div>
                  {/* Samma vågräta svep-rad som detaljarket: konsten är det man
                      känner igen ett kort på, inte en textrad. Bleeder ut till
                      kanten så ett halvt kort tittar fram — den affordansen är
                      det som säger att raden går att svepa. */}
                  <div className="-mx-3 mt-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1">
                    {chooseOptions(s.candidates).map((c) => (
                      <button
                        key={`${c.cardId}:${c.productId ?? ""}`}
                        type="button"
                        onClick={() => onChoose(s.id, c)}
                        className="flex w-28 shrink-0 snap-start flex-col gap-1.5 rounded-xl bg-surface-overlay p-2 text-left ring-1 ring-surface-border transition-colors hover:ring-holo-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
                      >
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.imageUrl}
                            alt={c.name}
                            className="aspect-[5/7] w-full rounded-md object-cover"
                          />
                        ) : (
                          <span className="flex aspect-[5/7] w-full items-center justify-center rounded-md bg-white/5 text-ink-faint">
                            <IconSearch size={18} />
                          </span>
                        )}
                        <span className="block truncate text-[11px] font-medium text-ink">
                          {c.name}
                        </span>
                        <span className="block truncate text-[10px] text-ink-faint">
                          {c.setName} · #{c.number}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    {/* ⛔ "Inget av dem" är INTE kosmetik — det är den enda vägen
                        som kan skriva ett NEGATIVT facit för ett osäkert fall.
                        Utan den kan mätapparaten strukturellt bara säga ja. */}
                    <button
                      type="button"
                      onClick={() => onOpenDetails(s.id)}
                      className="text-xs font-medium text-holo-cyan hover:underline"
                    >
                      {t("noneOfThese")}
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
              {pendingChoice > 0 && (
                <span className="text-holo-gold">
                  {" "}
                  · {t("pendingChoiceSuffix", { count: pendingChoice })}
                </span>
              )}
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
              // ⛔ ETT OBESVARAT VAL BLOCKERAR MASSTILLÄGGET. Alternativet — att
              // lägga till de säkra och tyst hoppa över resten — hade tappat
              // precis de kort vi var minst säkra på, utan att användaren märkte
              // det. Knappen säger vad som återstår i stället för att göra
              // ingenting: en disabled knapp utan förklaring läses som en bugg.
              disabled={matchedCount === 0 || pendingChoice > 0}
              // Disabled = solid dämpad yta i FULL opacitet (ej dimmad teal). Den
              // gamla disabled:opacity-50 på teal-knappen lämnade en ljus cyan
              // "spök"-remsa i WebKit:s compositing-lager när sista kortet togs bort.
              className="px-5 disabled:bg-surface-overlay disabled:text-ink-faint disabled:opacity-100"
            >
              {pendingChoice > 0
                ? t("chooseFirstN", { count: pendingChoice })
                : matchedCount > 0
                  ? t("addToCollectionN", { count: matchedCount })
                  : t("addToCollection")}
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
/**
 * BETALVÄGGEN NÄR GRATISKVOTEN TAR SLUT.
 *
 * ⛔ ETT TAK ÄR INGET FEL. Förut var beskedet en röd fel-toast med varningstriangel
 * och texten "Uppgradera till Pro för fler" — som INTE var en knapp. Dessutom lade
 * varje blockerat slutartryck till ett skräpkort i remsan med felmeddelandet som
 * titel. Mätt i augusti 2026: sex gratisanvändare slog i taket, noll uppgraderade.
 * Det här är det enda ögonblicket i produkten där användaren bevisligen vill ha
 * mer av det Pro säljer — då ska det finnas en knapp, inte en varningstriangel.
 *
 * ⛔ SÄG VAD SOM INTE HÄNDER OCKSÅ. "Allt du redan skannat ligger kvar" och
 * "kvoten nollställs den 1:a" är hela skillnaden mellan "appen tog något ifrån
 * mig" och "jag har använt upp månadens portion".
 *
 * ⛔ PUNKTERNA ÄR SKANNINGSPUNKTER, inte hela Pro-listan. Användaren står i
 * kameravyn med ett kort i handen — prisgrafer och Tradera-serier svarar inte på
 * det hen försöker göra just nu.
 */
function ScanLimitSheet(props: {
  limit: number;
  /** Gäst i appen: säljer KONTOT (20 skanningar till), inte Pro. */
  guest?: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  onLogin?: () => void;
}) {
  const t = useTranslations("Scanner");
  if (props.guest) {
    return (
      <Sheet title={t("guestLimitTitle")} onClose={props.onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{t("guestLimitBody", { count: props.limit })}</p>
          <Button onClick={props.onUpgrade}>{t("guestLimitCta")}</Button>
          <button
            type="button"
            onClick={props.onLogin}
            className="text-sm text-holo-cyan transition-colors hover:underline"
          >
            {t("guestLimitLogin")}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="text-sm text-ink-faint transition-colors hover:text-ink-muted"
          >
            {t("limitDismiss")}
          </button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={t("limitTitle")} onClose={props.onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t("limitBody", { count: props.limit })}</p>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{t("limitProLead")}</p>
          <ul className="space-y-2">
            {[t("limitProScans"), t("limitProBulk"), t("limitProGrading")].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-ink-muted">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-rise" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <Button onClick={props.onUpgrade}>{t("limitCta")}</Button>
        <button
          type="button"
          onClick={props.onClose}
          className="text-sm text-ink-faint transition-colors hover:text-ink-muted"
        >
          {t("limitDismiss")}
        </button>
      </div>
    </Sheet>
  );
}

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
  const router = useRouter();
  const { item } = props;

  /**
   * ETT ANDRA TRYCK PÅ DET VALDA KORTET = produkt & prishistorik.
   *
   * Ersätter en egen knapp längst ner: kortet man just valt ÄR produkten man
   * vill läsa om, så åtgärden hör hemma på kortet — inte i en knapprad som
   * dessutom alltid pekade på TRÄFFEN och aldrig på den variant man nyss bytte
   * till. Första trycket väljer, andra öppnar.
   *
   * `openProductOverlay` svarar false på desktop/när värden inte är monterad →
   * fall tillbaka på vanlig navigering, aldrig ett dött tryck.
   */
  const openProduct = useCallback(
    (slug: string) => {
      if (!openProductOverlay(slug)) router.push(`/produkter/${slug}`);
    },
    [router]
  );

  // Regeln bor i lib/scan-alternatives.ts — ren och testad, för den avgör om
  // en felmatchning går att RÄTTA och har felat i fält en gång.
  // Raden bär korten med IDENTISK KONST, en post per variant — den enda frågan
  // bilden inte kan svara på själv.
  //
  // ⛔ **FALLBACKEN ÄR INTE LÄNGRE ETT KANTFALL (2026-08-29).** Kommentaren här
  // sa förut att den finns för textskanningar utan bildmatchning. Sedan
  // `pickSameArtRail` slutade räkna träffens EGET kort som ett alternativ är den
  // majoritetsvägen: nedre gräns 378 av 649 domar (58,2 %) hade exakt ett kort i
  // raden, och för art-avgjorda skanningar fyrar den nästan alltid: ett
  // same-art-syskon (likhet ≥ SAME_ART_MIN) trycker ner marginalen mot noll, och
  // `artConfidentFrom` kräver en marginal. ⚠️ Det är en TENDENS, inte en
  // konstruktion — grinden är tvågrenad (agree-grenen har ett lägre golv) och
  // 5 av 81 art-avgjorda rader kom just den vägen. Se scan-alternatives.ts.
  // Före ändringen var raden ALDRIG tom när det
  // fanns en träff, så en felmatchning till ett kort med ANNAN konst gick inte
  // att rätta alls — vilket gjorde 0 av 142 i den art-avgjorda hinken
  // ofalsifierbart. ⚠️ Priset är att bredare (gallrade) alternativ nu visas i de
  // fallen; det är en OBEMÄTT avvägning, inte ett fältbevisat urval.
  // ⛔ `item.match` MÅSTE prependas i fallback-läget: `pickAlternatives` filtrerar
  // bort exakt träffens post för att undvika dubblett, så utan den försvinner
  // det valda kortet ur raden. Vaktat mekaniskt i scan-alternatives.test.ts.
  const rail = useMemo(() => {
    const sameArt = pickSameArtRail(item.candidates, item.match);
    if (sameArt.length > 0) return sameArt;
    const alts = pickAlternatives(item.candidates, item.match);
    return item.match ? [item.match, ...alts] : alts;
  }, [item.candidates, item.match]);

  return (
    <Sheet title={t("scanDetails")} onClose={props.onClose} fill>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/* DIN BILD VS DIN TRÄFF — TAR DEN HÖJD SOM BLIR ÖVER (2026-09-05).
            Arket är max 85 % av skärmen och allt annat här (meta, kandidatrad,
            åtgärder) har fast höjd. Förut hade bildparet också det (kolumnbredd ×
            7/5 ≈ 240 px), så på varje telefon tog arket slut mitt i kandidatraden
            och "Ta bort skanning" låg under vikningen. Nu fyller paret det som
            återstår: stort på en Pro Max, mindre på en 13 mini, samma layout.
            ⛔ Proportionen viker aldrig — bilden sätts med max-h + max-w och
            aspect-ratio, så den blir MINDRE, aldrig avlång. Golvet 112 px: under
            det scrollar arket i stället (SE-klassen). `minmax(0,1fr)` på raden
            och min-h-0 hela vägen ner är det som gör krympningen möjlig — en
            auto-minimihöjd någonstans i kedjan låser bilden vid full bredd igen.
            Ägaren 2026-09-05: den kompakta hero-raden var fel svar, "I like how
            it was before but i just wanted it all to fit in one view". */}
        <div className="grid min-h-[112px] flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3">
          <figure className="flex min-h-0 flex-col items-center gap-2">
            <div className="min-h-0 w-full flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.captured}
                alt={t("yourImage")}
                className="mx-auto block aspect-[5/7] h-auto max-h-full w-auto max-w-[min(100%,260px)] rounded-xl object-cover ring-1 ring-surface-border"
              />
            </div>
            <figcaption className="shrink-0 text-xs text-ink-faint">{t("yourImage")}</figcaption>
          </figure>
          <figure className="flex min-h-0 flex-col items-center gap-2">
            <div className="min-h-0 w-full flex-1">
              {item.match?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.match.imageUrl}
                  alt={t("yourMatch")}
                  className="mx-auto block aspect-[5/7] h-auto max-h-full w-auto max-w-[min(100%,260px)] rounded-xl object-cover ring-1 ring-holo-cyan/40"
                />
              ) : (
                <span className="mx-auto flex aspect-[5/7] h-full max-w-full items-center justify-center rounded-xl bg-surface-overlay text-ink-faint ring-1 ring-surface-border">
                  <IconSearch size={24} />
                </span>
              )}
            </div>
            <figcaption className="shrink-0 text-xs text-ink-faint">
              {item.match ? t("yourMatch") : t("noMatch")}
            </figcaption>
          </figure>
        </div>

        {/* Träff-meta */}
        {item.match && (
          <div className="shrink-0">
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
          </div>
        )}

        {/* Alternativ */}
        {/* Varför gissningen är en gissning — sagt rakt ut, inte antytt. Flera
            OLIKA kort låg praktiskt taget lika, så listan nedan är inte
            "alternativ om jag har fel" utan "kort som var precis lika troliga". */}
        {item.uncertain && item.match && (
          <p className="shrink-0 rounded-xl bg-holo-gold/10 px-3 py-2 text-xs leading-relaxed text-holo-gold ring-1 ring-holo-gold/25">
            {t("uncertainMatch")}
          </p>
        )}

        {/* KORTEN SOM EN VÅGRÄT RAD MAN SVEPER I (2026-08-04).
            Konsten är det man känner igen ett kort på — inte en textrad — och en
            lodrät lista visade tre bilder i frimärksformat och sköt resten under
            vikningen. Raden bär TRÄFFEN FÖRST, markerad: utan ett ankare vet man
            inte vad man jämför MOT när man sveper. Bleeder ut till panelens kant
            (-mx-5/px-5) så att ett halvt kort tittar fram i högerkanten — det är
            den affordansen som säger att raden går att svepa. */}
        {rail.length > 0 && (
          <div className="shrink-0">
            <p className="mb-2 text-xs font-medium text-ink-muted">
              {item.match ? t("notRight") : t("possibleMatches")} · {rail.length}
            </p>
            {/* data-no-swipe: raden äger sitt vågräta drag. Utan den läste
                skannerns stäng-gest (högersvep på roten) varje svep i raden som
                "stäng skannern" och kortet gled ut under fingret. */}
            <div
              data-no-swipe
              className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1"
            >
              {rail.map((c) => {
                const selected =
                  item.match != null &&
                  c.cardId === item.match.cardId &&
                  c.productId === item.match.productId;
                return (
                  <button
                    // Nyckeln måste bära VARIANTEN: flera produkter delar cardId,
                    // så cardId ensamt gav dubblettnycklar och React återanvände
                    // fel kort.
                    key={c.productId ?? c.cardId}
                    type="button"
                    onClick={() => {
                      // Valt kort + andra trycket → produkten. Saknar kortet slug
                      // finns ingen produktsida att gå till; då är ett omtryck
                      // bara en bekräftelse, aldrig ett dött tryck.
                      if (selected && c.slug) openProduct(c.slug);
                      else props.onChoose(c);
                    }}
                    aria-current={selected}
                    aria-label={
                      selected && c.slug ? `${c.name} — ${t("showProduct")}` : c.name
                    }
                    className={`w-[132px] shrink-0 snap-start rounded-2xl border p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan ${
                      selected
                        ? "border-holo-cyan/60 bg-holo-cyan/5"
                        : "border-surface-border hover:border-holo-cyan/50 hover:bg-surface-overlay"
                    }`}
                  >
                    <span className="relative block">
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.imageUrl}
                          alt=""
                          className="aspect-[5/7] w-full rounded-xl object-cover"
                        />
                      ) : (
                        <span className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-surface-overlay text-ink-faint">
                          <IconCards size={24} />
                        </span>
                      )}
                      {/* Affordansen för andra trycket. Syns BARA på det valda
                          kortet, för det är bara där gesten finns — en ikon på
                          alla hade lovat något de andra inte gör. */}
                      {selected && c.slug && (
                        <span
                          aria-hidden="true"
                          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-surface/80 text-holo-cyan ring-1 ring-holo-cyan/40 backdrop-blur"
                        >
                          <IconChart size={14} />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block truncate text-sm font-semibold text-ink">
                      {c.name}
                    </span>
                    {/* Numret LEDER raden — det är DEN uppgiften som skiljer två kort
                        med identisk konst åt, och som delsträng i setraden drunknade
                        den. Tryckningen står efter i accentfärg: utan etiketten ser
                        tryckningarna identiska ut (samma namn, set, nummer). En rad
                        i stället för två så att hela kortet får plats i arket. */}
                    <span className="block truncate text-xs">
                      <span className="tabular-nums text-ink-muted">#{c.number}</span>
                      <span className="text-ink-faint"> · </span>
                      <span className="font-medium text-holo-cyan">
                        {c.variantLabel ?? t("ordinaryPrinting")}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-ink-faint">{c.setName}</span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold tabular-nums text-ink">
                        {c.estimatedValue != null ? formatPrice(c.estimatedValue) : "–"}
                      </span>
                      {/* Rund markör, inte ett "+": raden VÄLJER vilket kort
                          skanningen är, den lägger inget i samlingen. */}
                      <span
                        aria-hidden="true"
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          selected
                            ? "border-holo-cyan bg-holo-cyan text-surface"
                            : "border-surface-border text-ink-faint"
                        }`}
                      >
                        {selected ? <IconCheck size={16} /> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Gesten är osynlig utan en rad text — ikonen ensam säger att något
                finns, inte hur man når det. */}
            {item.match?.slug && (
              <p className="mt-2 text-[11px] text-ink-faint">{t("tapAgainForProduct")}</p>
            )}
          </div>
        )}

        {/* Åtgärder. ⛔ INGEN "Visa produkt"-knapp här längre (2026-08-04):
            åtgärden bor på det valda kortet (andra trycket). Knappen pekade
            dessutom alltid på TRÄFFEN, aldrig på den variant man nyss bytte
            till — så den kunde öppna fel produkt efter ett variantbyte.
            Sök-fallbacken finns kvar: utan produktsida vore vyn en återvändsgränd. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {!item.match?.slug && (
            <LinkButton
              /* ⛔ EN TOM `?q=` ÄR INTE EN SÖKNING. Vid "ingen träff" är `match`
                 null, så länken blev `/produkter?q=` — en ofiltrerad katalog som
                 SER ut som ett sökresultat, och dessutom en robots-blockerad
                 dynamisk render. Utan namn skickar vi till katalogen rakt av. */
              href={
                item.match?.name
                  ? `/produkter?q=${encodeURIComponent(item.match.name)}`
                  : "/produkter"
              }
              variant="outline"
              /* ⛔ ATT LÄMNA SKANNERN ÄR ETT NEGATIVT FACIT — och det kastades
                 tyst. Den som inte hittar sitt kort söker manuellt, lägger till
                 det från katalogen och rapporterar ingenting; mätt 2026-08-29
                 saknade 54 % av alla mätrader dom helt, och det är precis de
                 SVÅRA fallen. Rapporteras FÖRE navigeringen — efteråt är
                 komponenten avmonterad. */
              onClick={() =>
                reportScanFeedback(item.jobId, item.match?.cardId ?? null, "searched", {
                  via: "pick",
                })
              }
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

/* ===========================================================================
 * Svep-för-att-radera — vänstersvep avslöjar röd raderingsyta; släpp förbi
 * halva kortet → radera (samma glid + 0.25s ease som sheet-svepet). Native
 * pointer-events + pan-y så vertikal listscroll förblir webbläsarens.
 * ======================================================================== */
function SwipeToDelete({
  onDelete: onDeleteProp,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const fgRef = useRef<HTMLDivElement>(null);
  // Samma fälla som arkets `onClose`: anroparen skickar en inline-arrow
  // (`onDelete={() => onRemove(s.id)}`), och effekten nedan registrerar
  // lyssnare. En rendering mitt i ett svep hade rivit dem och lämnat kortet
  // fruset halvvägs. Se src/hooks/use-event-callback.ts.
  const onDelete = useEventCallback(onDeleteProp);

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
  onClose: onCloseProp,
  fill = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /**
   * Arket tar ALLTID sina 85 % och kroppen blir en flex-kolumn, så att en del av
   * innehållet (bildparet i skanningsdetaljerna) kan fylla det som blir över i
   * stället för att skjuta resten under vikningen. Utan flaggan: max 85 %,
   * innehållshöjd, scroll vid överskott — som förut.
   */
  fill?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Scanner");
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  // ⛔ STABIL IDENTITET ÄR INTE HYGIEN HÄR, DET ÄR FUNKTIONEN (bugg i fält
  // 2026-08-04): anroparen skickar en inline-arrow, och drag-effekten nedan
  // REGISTRERAR lyssnare. Med en ny identitet per rendering revs de och sattes
  // om ~1,6 ggr/s (live-pollen bakom arket sätter state var 600:e ms) — mitt i
  // ett svep hade den nya uppsättningen aldrig sett `touchstart`, så arket
  // slutade följa fingret och frös. Se src/hooks/use-event-callback.ts.
  const onClose = useEventCallback(onCloseProp);

  /**
   * SVEP NEDÅT FÖR ATT STÄNGA.
   *
   * ⛔ TOUCH-EVENTS, INTE POINTER-EVENTS (omskrivet 2026-08-04). Den gamla
   * versionen fångade pointern på handtaget, och `pointercancel` behandlades som
   * "fingret släppte". Men i WebKit avbryter ETT `preventDefault()` på touchmove
   * hela pointer-strömmen — och studsvakten i `pwa-register.tsx` gjorde precis
   * det på varje nedåtdrag när `scrollY === 0`, vilket skannern ALLTID har
   * (`fixed inset-0`). Följden: gesten avbröts mitt i, arket gled tillbaka och
   * frös. Ett snabbt svep hann förbi 100 px innan avbrottet och stängde; ett
   * långsamt — eller ett som bromsade i mitten — gjorde det aldrig. Exakt det
   * ägaren rapporterade. Touch-events överlever ett `preventDefault`; pointer
   * gör det inte. Vakten opt-outar dessutom via `data-drag-surface` nedan.
   *
   * ⛔ RIKTNINGEN MÅSTE AVGÖRAS UNDER WEBBLÄSARENS EGEN TRÖSKEL (2026-08-04,
   * andra omgången). Första fixen låste axeln vid 8 px, och DET var kvar-buggen:
   * ett snabbt svep hinner 8 px i den FÖRSTA touchmove-händelsen, så vår
   * `preventDefault()` hann före WebKits scrollbeslut. Ett långsamt svep levererar
   * 1–2 px per ruta — då passerar webbläsarens egen tröskel (~5 px) FÖRST, den
   * tar gesten, skickar `touchcancel`, och arket gled tillbaka och frös. Samma
   * symtom som pointer-versionen, en nivå ner. Tröskeln är därför 3 px: tillräckligt
   * för att läsa riktningen, under webbläsarens för att hinna först. Är gesten vår
   * blockeras VARJE efterföljande move — hinner den bli icke-avbrytbar
   * (`cancelable === false`) har vi redan förlorat.
   *
   * TRE SAKER SOM MÅSTE HÅLLAS ISÄR PÅ SAMMA YTA:
   *  - vågrätt drag  → kandidatraden äger det (utesluts redan vid touchstart:
   *    en gest som börjar i en sidledsscroller blir aldrig vår)
   *  - drag uppåt / kroppen redan nedscrollad → vanlig scroll
   *  - drag nedåt i topp → vi äger gesten och stänger
   * Draget får därför starta på handtaget ALLTID, men i kroppen bara när den
   * står i topp — annars hade en scroll uppåt läst som en stängning.
   *
   * STÄNGER PÅ STRÄCKA **ELLER** FART: ett kort, snabbt kast är lika tydligt
   * som ett långt lugnt drag, och att bara mäta sträcka gör den snabba gesten
   * omöjlig.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let vy = 0;
    let dy = 0;
    let dragging = false;
    /** Gesten får bli vår (rätt startpunkt), men riktningen är ännu oläst. */
    let eligible = false;
    /** Riktningen är läst och den var nedåt — vi äger gesten. */
    let owning = false;

    const begin = (x: number, y: number, t: number) => {
      startX = x;
      startY = y;
      lastY = y;
      lastT = t;
      dy = 0;
      vy = 0;
      eligible = true;
      owning = false;
      dragging = true;
    };

    const abort = () => {
      dragging = false;
      eligible = false;
      owning = false;
      panel.style.transition = "";
      panel.style.transform = "";
    };

    /** true = vi äger gesten och anroparen ska blockera native scroll. */
    const move = (x: number, y: number, t: number, fromHandle: boolean): boolean => {
      if (!dragging || !eligible) return false;
      const ddx = x - startX;
      const ddy = y - startY;
      if (!owning) {
        // Domen bor i src/lib/sheet-drag.ts — ren och testad, för regeln har
        // felat i fält två gånger och symtomet var båda gångerna "ibland".
        const decision = classifyDrag(ddx, ddy, fromHandle);
        if (decision === "wait") return false;
        // Släpp den helt: en gest vi lämnat ifrån oss tas ALDRIG tillbaka mitt
        // i, annars slåss två stycken om samma finger.
        if (decision === "release") {
          abort();
          return false;
        }
        owning = true;
        // animate-fade-in-up (fill-mode: both) pinnar transform och överröstar
        // vår inline-transform → måste rensas, annars syns ingen följning/glid.
        panel.style.animation = "none";
        panel.style.transition = "none";
      }
      dy = Math.max(0, ddy);
      if (t > lastT) {
        vy = (y - lastY) / (t - lastT);
        lastY = y;
        lastT = t;
      }
      panel.style.transform = `translateY(${dy}px)`;
      return true;
    };

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      eligible = false;
      // Riktningen hann aldrig läsas (en tapp, eller en gest vi lämnat) — då
      // finns ingen transform att ångra och ingenting att stänga.
      if (!owning) return;
      owning = false;
      panel.style.transition = "transform 0.25s ease";
      if (shouldCloseSheet(dy, vy)) {
        panel.style.transform = "translateY(110%)";
        window.setTimeout(onClose, 230);
      } else {
        panel.style.transform = "";
      }
    };

    const isHandle = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.("[data-sheet-handle]");

    /**
     * En gest som börjar i en yta med EGEN scroll (kandidatraden i sidled, en
     * nästlad lista som inte står i topp) blir aldrig vår — beslutet tas HÄR,
     * vid touchstart, och aldrig mitt i gesten. Mitt-i-beslut var hela skälet
     * att raden och arket slogs om samma finger.
     */
    const startsInOwnScroller = (target: EventTarget | null) => {
      let el = target as HTMLElement | null;
      while (el && el !== panel) {
        if (el.scrollWidth > el.clientWidth + 1) return true;
        if (el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    };

    let fromHandle = false;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        abort();
        return;
      }
      fromHandle = isHandle(e.target);
      // Kroppen får bara starta ett drag när den redan står i topp — annars
      // vore varje scroll uppåt en stängning.
      if (!fromHandle && (panel.scrollTop > 0 || startsInOwnScroller(e.target))) {
        dragging = false;
        eligible = false;
        return;
      }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging || e.touches.length !== 1) return;
      const own = move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp, fromHandle);
      // Vi äger gesten: utan detta scrollar/studsar WebView:n samtidigt som
      // arket följer fingret — och värre, den TAR gesten och skickar touchcancel.
      // Sker bara efter riktningsbeslutet (3 px), så vågräta svep i
      // kandidatraden aldrig blockeras (den lärdomen kostade tre felsökningar
      // — se project_overscroll_guard_killed_horizontal_gestures).
      if (own && e.cancelable) e.preventDefault();
    };

    // MUS: pointer-events duger på desktop (ingen touchmove-vakt, ingen
    // WebView som avbryter). Touch går uteslutande via touch-events ovan.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      fromHandle = isHandle(e.target);
      if (!fromHandle && panel.scrollTop > 0) return;
      begin(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      move(e.clientX, e.clientY, e.timeStamp, fromHandle);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      finish();
    };

    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    panel.addEventListener("touchend", finish);
    // Ett avbrott (systemgest, inkommande samtal) ska dömas som ett släpp och
    // ALDRIG lämna gesten hängande — det var hela den gamla buggen.
    panel.addEventListener("touchcancel", finish);
    panel.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("touchend", finish);
      panel.removeEventListener("touchcancel", finish);
      panel.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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
        // data-drag-surface: studsvakten i pwa-register.tsx måste hålla fingrarna
        // borta här — dess preventDefault avbröt gesten mitt i (se effekten ovan).
        data-drag-surface
        // overscroll-behavior: contain — en studs som kedjas vidare till
        // dokumentet är ännu en väg till touchcancel mitt i draget.
        style={{ overscrollBehavior: "contain" }}
        className={`relative overflow-y-auto rounded-t-3xl border-t border-surface-border bg-surface-raised p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card animate-fade-in-up ${
          fill ? "flex h-[85%] flex-col" : "max-h-[85%]"
        }`}
      >
        {/* Dragyta: handtag + rubrik. touch-action:none → ingen native scroll här.
            Kroppen går också att dra i, men bara när den står i topp. */}
        <div
          ref={handleRef}
          data-sheet-handle
          style={{ touchAction: "none" }}
          className="-mx-5 -mt-5 shrink-0 cursor-grab px-5 pb-3 pt-5 active:cursor-grabbing"
        >
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-border" aria-hidden="true" />
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
        {/* min-h-0: utan den kan kolumnen aldrig bli lägre än sitt innehåll och
            ingenting inuti får något att krympa mot. Räcker inte höjden ändå
            (golven nedan) flödar innehållet över och panelen scrollar som förut. */}
        {fill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </div>
    </div>
  );
}
