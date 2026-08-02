/**
 * Kamerakontroller för skannern: FICKLAMPA (torch) och ZOOM-FÖRVAL (0,5× / 1× / 2×).
 *
 * VARFÖR EN EGEN MODUL, OCH VARFÖR DELAD I TVÅ FILER
 * --------------------------------------------------
 * Den här filen är RAMVERKSFRI med flit. All BESLUTSLOGIK (vilka förval som
 * faktiskt finns, vilket värde ett förval motsvarar på den här enheten, vad
 * kapabiliteterna betyder) ligger i rena funktioner utan `window`, `navigator`
 * eller React på modulnivå — då går de att köra i vitest, som här är
 * `environment: "node"` utan jsdom/RTL (se vitest.config.ts). En React-hook går
 * INTE att enhetstesta i det uppsättet. Samma uppdelning som `art-fingerprint.ts`
 * och `card-quad.ts`: matematiken utanför komponenten, komponenten tunn.
 * Hooken bor i `src/hooks/use-camera-controls.ts` och innehåller bara
 * livscykel + state.
 *
 * VARFÖR DET HÄR ÖVERHUVUDTAGET ÄR KLURIGT
 * ----------------------------------------
 * `torch` och `zoom` ligger i MediaStream Image Capture-tillägget, inte i
 * kärnan av getUserMedia. Följden är att BÅDE stödet och ENHETEN varierar:
 *  - torch saknas på desktop, på FRAMKAMEROR och i iOS Safari (WebKit har
 *    ingen torch-kapabilitet alls — inte ens i standalone-PWA);
 *  - `zoom`-kapabilitetens intervall är enhetsspecifikt och står INTE i "x".
 *    Två skalor förekommer i naturen: faktor ({min:1,max:8}) och procent
 *    ({min:100,max:800}). Ett hårdkodat `zoom: 2` betyder alltså "2×" på den
 *    ena och "nästan helt utzoomat" på den andra;
 *  - 0,5× är oftast INTE ett zoom-värde utan ETT ANNAT FYSISKT OBJEKTIV
 *    (ultravidvinkeln), som exponeras som en egen enhet i `enumerateDevices()`.
 *    Många telefoner har ingen ultravidvinkel alls.
 *
 * Därför exponerar modulen vilka förval som FAKTISKT går att nå, i stället för
 * att rendera tre knappar och hoppas. En 0,5×-knapp som inte gör något är sämre
 * än ingen knapp — exakt samma regel som gäller resten av appen (visa aldrig en
 * kontroll som inte bevisligen fungerar).
 *
 * ⛔ MODULEN RÖR ALDRIG STRÖMMENS LIVSCYKEL. Anroparen (skanner-sidan) äger
 * `getUserMedia`/`track.stop()`. Kräver ett förval en annan kamera returneras
 * `needs-stream-restart` med enhetens id — anroparen öppnar om strömmen själv.
 * Att stoppa någon annans ström bakom ryggen på dem är precis den sortens
 * osynliga sidoeffekt som gör kamerabuggar omöjliga att felsöka.
 */

// ---------------------------------------------------------------------------
// SMAL LOKAL TYPUTVIDGNING
// ---------------------------------------------------------------------------
// `MediaTrackSettings` HAR redan `torch`/`zoom` i TS 5.9:s lib.dom, men
// `MediaTrackCapabilities` och `MediaTrackConstraintSet` har det inte. Vi
// utvidgar dem LOKALT (inte via `declare global`) — dels för att inte krocka
// den dagen TS lägger in fälten själv, dels för att `any` här hade tagit bort
// hela poängen: det är just de här fälten som är osäkra och behöver typas.

/** Zoom-kapabilitetens intervall som webbläsarna faktiskt rapporterar det. */
export interface ZoomCapability {
  min?: number;
  max?: number;
  /** Chrome sätter step; spec:en kräver det inte. Saknas den antar vi kontinuerlig. */
  step?: number;
}

/** `track.getCapabilities()` + Image Capture-tilläggets fält. */
export interface CameraCapabilities extends MediaTrackCapabilities {
  /** Spec:en säger `sequence<boolean>`; Chrome ger en bar `true`. Båda hanteras. */
  torch?: boolean | boolean[];
  zoom?: ZoomCapability;
}

/** Ett constraint-set som får bära torch/zoom (bara giltigt inuti `advanced`). */
export interface CameraConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
  zoom?: number;
}

/** Delmängden av `MediaDeviceInfo` vi behöver — så testerna slipper DOM. */
export interface VideoDeviceLike {
  deviceId: string;
  kind?: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// FÖRVAL
// ---------------------------------------------------------------------------

export type ZoomPreset = 0.5 | 1 | 2;

/** Renderingsordning i UI:t — vidast först, som i telefonernas egna kameraappar. */
export const ZOOM_PRESETS: readonly ZoomPreset[] = [0.5, 1, 2];

export type ZoomPresetKind =
  /** Kamerans grundläge — kräver ingen kapabilitet alls. */
  | "native"
  /** `applyConstraints` på NUVARANDE spår. */
  | "zoom"
  /** Kräver att anroparen öppnar en ANNAN kamera (ultravidvinkel eller tillbaka). */
  | "device";

export interface ZoomPresetOption {
  preset: ZoomPreset;
  kind: ZoomPresetKind;
  /** Värdet i enhetens EGEN skala (bara `kind === "zoom"`). Aldrig "x". */
  trackZoom?: number;
  /** Enheten som ska öppnas (bara `kind === "device"`). */
  deviceId?: string;
  /** true ⇒ anroparen måste stoppa strömmen och köra getUserMedia igen. */
  requiresStreamRestart: boolean;
  /** OMÄTT rekommendation, se `ZOOM_PRESET_MAX_CARDS`. */
  maxCards: number;
}

// ---------------------------------------------------------------------------
// KORTREKOMMENDATION PER FÖRVAL — ⚠️ UPPSKATTNINGAR, INTE MÄTVÄRDEN
// ---------------------------------------------------------------------------

/**
 * Bulk-detektorns TAK. Speglar `BULK_MAX_CARDS` i
 * `src/app/[locale]/(app)/skanna/page.tsx` (konstanten är inte exporterad
 * därifrån — det är en sid-modul). Ändras den där måste den ändras här;
 * `camera-controls.test.ts` vaktar åtminstone att tabellen aldrig går ÖVER taket.
 */
export const BULK_DETECTOR_MAX_CARDS = 12;

/**
 * Antal kort som ryms i rutan vid 1× på ett normalt handhållet avstånd.
 * ⚠️ ANKARET ÄR EN UPPSKATTNING, inte en mätning — det är valt så att det
 * stämmer med storleken på de bordslägg som fältrundorna faktiskt använt
 * (~6 kort), inget annat.
 */
export const BULK_ANCHOR_CARDS_AT_1X = 6;

/**
 * ⚠️⚠️ OMÄTTA UPPSKATTNINGAR — INGA FÄLTMÄTNINGAR LIGGER BAKOM DE HÄR TALEN. ⚠️⚠️
 *
 * Härledningen är ren geometri: synfältets LINJÄRA bredd skalar ~1/zoom, alltså
 * skalar YTAN ~1/zoom², och antal kort som får plats skalar med ytan. Från
 * ankaret 6 kort vid 1×:
 *   0,5× → 6 / 0,5² = 24  → KLAMPAT till detektorns tak (12)
 *   1×   → 6
 *   2×   → 6 × 0,5² = 1,5 → 1 (2× är i praktiken ett enkortsläge)
 *
 * Det som INTE är modellerat, och som är precis det fältmätningen ska avgöra:
 * pixelbudgeten per kort (12 kort i rutan ⇒ varje kort får ~1/12 av bildens
 * yta, och samlarnumret är ~2 mm på ett 88 mm kort — det är samma vägg som
 * skannern redan slagit i), ultravidvinkelns tunnförvrängning i kanterna, och
 * att många telefoners ultravidvinkel har LÄGRE sensorupplösning än huvud-
 * kameran. Talen är alltså ett TAK för vad som får plats, inte ett löfte om
 * vad som går att LÄSA.
 *
 * ⛔ Presentera dem aldrig som uppmätta. Byt dem mot riktiga siffror så fort
 * en fältrunda har kört bulk-detektorn vid varje förval.
 */
export const ZOOM_PRESET_MAX_CARDS: Readonly<Record<ZoomPreset, number>> = {
  0.5: 12,
  1: 6,
  2: 1,
};

/**
 * Rekommenderat maxantal kort vid ett zoom-förval. Ren funktion, ingen webbläsare.
 * ⚠️ Se `ZOOM_PRESET_MAX_CARDS` — talen är UPPSKATTNINGAR i väntan på fälttest.
 */
export function recommendedBulkCards(preset: ZoomPreset): number {
  return Math.min(ZOOM_PRESET_MAX_CARDS[preset] ?? 1, BULK_DETECTOR_MAX_CARDS);
}

// ---------------------------------------------------------------------------
// KAPABILITETSLÄSNING (rena funktioner över ett kapabilitetsobjekt)
// ---------------------------------------------------------------------------

/**
 * Är ficklampan stödd enligt spårets kapabiliteter?
 * Spec:en säger `sequence<boolean>` (t.ex. `[false, true]`), Chrome ger `true`.
 * En lista som BARA innehåller `false` betyder uttryckligen "kan inte" — den
 * skillnaden måste hanteras, annars visas knappen på framkameran.
 */
export function readTorchSupport(caps: CameraCapabilities | null | undefined): boolean {
  const torch = caps?.torch;
  if (torch === true) return true;
  if (Array.isArray(torch)) return torch.includes(true);
  return false;
}

/**
 * Zoom-intervallet, eller null när enheten inte kan zooma (eller rapporterar
 * något vi inte vågar tolka).
 *
 * ⛔ `max < 1.5` avvisas MED FLIT: ett sådant intervall (t.ex. {min:0,max:1})
 * är varken faktor- eller procentskala, och att gissa "1 = 1×" där hade gjort
 * 2×-knappen till en no-op och 0,5×-knappen till något oförutsägbart. Hellre
 * bara 1× än ett förval som gör fel sak.
 */
export function readZoomRange(
  caps: CameraCapabilities | null | undefined
): Required<ZoomCapability> | null {
  const zoom = caps?.zoom;
  if (!zoom) return null;
  const min = typeof zoom.min === "number" ? zoom.min : NaN;
  const max = typeof zoom.max === "number" ? zoom.max : NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max <= min) return null;
  if (max < 1.5) return null;
  const step = typeof zoom.step === "number" && zoom.step > 0 ? zoom.step : 0;
  return { min, max, step };
}

/**
 * Vilket värde i enhetens skala som betyder 1× (kamerans grundläge)?
 *
 * TVÅ SIGNALER MÅSTE VARA ENSE innan vi läser skalan som PROCENT: `min >= 50`
 * OCH `max >= 40`. Ingen faktorskala börjar på 50× — men en telefon KAN
 * rapportera max 100 i faktorskala (Samsungs digitala "Space Zoom"), så `max`
 * ensamt räcker inte. Med båda signalerna är 100 neutralläget, annars 1.
 * Basen klampas in i intervallet: en huvudkamera som redan är inzoomad
 * (min > 1) har inget lägre "1×" att erbjuda.
 */
export function zoomBaseUnit(range: Required<ZoomCapability>): number {
  const neutral = range.min >= 50 && range.max >= 40 ? 100 : 1;
  return Math.min(Math.max(neutral, range.min), range.max);
}

/**
 * Snappar till NÄRMASTE tillåtna steg och klampar in i intervallet.
 * Grova steg (0,3) gör att 2× kan landa på 1,9× — närmast, och medvetet hellre
 * något UNDER än något över det användaren bad om. Tillgängligheten avgörs före
 * snappningen (`zoomValueForPreset`), så ett förval blir aldrig synligt bara för
 * att avrundningen råkade landa i intervallet.
 */
export function snapZoom(value: number, range: Required<ZoomCapability>): number {
  const clamped = Math.min(Math.max(value, range.min), range.max);
  if (!range.step) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  // Avrundning kan skjuta ut över max — klampa igen, annars svarar
  // applyConstraints OverconstrainedError på ett värde vi själva räknat fram.
  const bounded = Math.min(Math.max(snapped, range.min), range.max);
  // Flyttalssmuts (0.30000000000000004) → runda till 6 decimaler.
  return Math.round(bounded * 1e6) / 1e6;
}

/**
 * Värdet i enhetens skala för ett förval, eller null om enheten inte NÅR dit.
 *
 * ⛔ Klampa aldrig ett onåbart förval in i intervallet och kalla det tillgängligt:
 * en 2×-knapp som i verkligheten ger 1,2× ljuger om vad användaren får. Räcker
 * inte intervallet finns förvalet helt enkelt inte på den här enheten.
 */
export function zoomValueForPreset(
  preset: ZoomPreset,
  range: Required<ZoomCapability> | null
): number | null {
  if (!range) return null;
  const target = zoomBaseUnit(range) * preset;
  const eps = 1e-6;
  if (target < range.min - eps || target > range.max + eps) return null;
  return snapZoom(target, range);
}

// ---------------------------------------------------------------------------
// ULTRAVIDVINKEL-URVAL
// ---------------------------------------------------------------------------

/**
 * Hittar ultravidvinkelns `deviceId` bland videoenheterna, eller null.
 *
 * ⛔ ETIKETTEN ÄR ENDA SIGNALEN, och den är BARA ifylld efter att kameratillstånd
 * getts — kör alltså den här EFTER getUserMedia, aldrig före.
 *
 * ⛔ "wide" ensamt DUGER INTE. iOS exponerar "Back Dual Wide Camera" och
 * "Back Triple Camera" som VIRTUELLA enheter — de är inte ultravidvinkeln, de är
 * den sammansatta kameran. Bara "ultra wide"/"ultrawide"/"ultra-wide" (och
 * "0.5x", som en del Android-skal skriver ut) får räknas.
 *
 * ⛔ ANDROID CHROME GER OGENOMSKINLIGA ETIKETTER ("camera2 2, facing back").
 * Där går det INTE att veta vilken bakre enhet som är ultravidvinkeln utan att
 * öppna var och en och läsa kapabiliteter — vilket tänder kameran flera gånger
 * och kostar sekunder. Vi svarar då null, och 0,5×-knappen visas inte. Att
 * gissa "andra bakre enheten" hade lika gärna landat på telefotot eller en
 * djupsensor, och en knapp som ibland byter till fel objektiv är värre än en
 * knapp som saknas. (Telefoner som SMÄLTER IN ultravidvinkeln i den logiska
 * kameran täcks ändå — då är 0,5× ett zoom-värde med `min <= 0.5 × bas`.)
 */
export function pickUltraWideDevice(devices: readonly VideoDeviceLike[]): string | null {
  const ultraWide = /ultra[\s._-]*wide/i;
  const halfX = /(^|[^0-9])0[.,]5\s*x/i;
  for (const device of devices) {
    if (device.kind && device.kind !== "videoinput") continue;
    if (!device.deviceId) continue;
    const label = device.label ?? "";
    if (/front|selfie|user/i.test(label)) continue;
    if (ultraWide.test(label) || halfX.test(label)) return device.deviceId;
  }
  return null;
}

/**
 * Listar videoenheter. Egen wrapper så hooken slipper feature-detektera, och så
 * att ett nekat/omöjligt anrop blir en tom lista i stället för ett kast.
 */
export async function listVideoDevices(): Promise<VideoDeviceLike[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// FÖRVALS-RESOLVERN (ren — hela API:ts hjärna)
// ---------------------------------------------------------------------------

export interface ZoomContext {
  /** Nuvarande spårs zoom-intervall (null = kan inte zooma). */
  zoomRange: Required<ZoomCapability> | null;
  /** `getSettings().deviceId` för spåret vi kör nu. */
  currentDeviceId: string | null;
  /** Kameran vi STARTADE i (huvudvidvinkeln) — dit 1×/2× hör hemma. */
  defaultDeviceId: string | null;
  /** Ultravidvinkelns id, om den kunde identifieras. */
  ultraWideDeviceId: string | null;
}

/**
 * Vilka förval finns FAKTISKT här och nu, och hur når man dem?
 *
 * Två lägen, för zoom-intervallet tillhör DET SPÅR som är öppet:
 *  A. Vi står på huvudkameran → 1× är grundläget, 2× (och ibland 0,5×) nås med
 *     applyConstraints, annars kräver 0,5× ett objektivbyte.
 *  B. Vi står på ULTRAVIDVINKELN → dess egna 1× ÄR ungefär 0,5× av huvud-
 *     kameran. Att zooma in 2× där ger inte huvudkamerans 2× (fel sensor, fel
 *     skärpedjup, sämre upplösning) — så 1× och 2× kräver ett byte TILLBAKA.
 */
export function resolveZoomPresets(ctx: ZoomContext): ZoomPresetOption[] {
  const onUltraWide =
    !!ctx.ultraWideDeviceId && ctx.currentDeviceId === ctx.ultraWideDeviceId;
  const options: ZoomPresetOption[] = [];

  for (const preset of ZOOM_PRESETS) {
    const maxCards = recommendedBulkCards(preset);

    if (onUltraWide) {
      if (preset === 0.5) {
        // Redan här — inget att göra.
        options.push({ preset, kind: "device", requiresStreamRestart: false, maxCards });
      } else if (ctx.defaultDeviceId) {
        // Tillbaka till huvudkameran. Zoomen (2×) sätts när det nya spåret finns —
        // hooken minns förvalet och applicerar det vid `attach`.
        options.push({
          preset,
          kind: "device",
          deviceId: ctx.defaultDeviceId,
          requiresStreamRestart: true,
          maxCards,
        });
      }
      // Utan känt defaultDeviceId kan vi inte lova en väg tillbaka → dölj förvalet.
      continue;
    }

    if (preset === 1) {
      // 1× är alltid nåbart: det ÄR kamerans grundläge. Har enheten zoom-
      // kapabilitet skickas basvärdet med, så att en tidigare 2× kan tas bort.
      options.push({
        preset,
        kind: "native",
        trackZoom: ctx.zoomRange ? zoomBaseUnit(ctx.zoomRange) : undefined,
        requiresStreamRestart: false,
        maxCards,
      });
      continue;
    }

    const value = zoomValueForPreset(preset, ctx.zoomRange);
    if (value !== null) {
      options.push({ preset, kind: "zoom", trackZoom: value, requiresStreamRestart: false, maxCards });
      continue;
    }

    if (preset === 0.5 && ctx.ultraWideDeviceId) {
      options.push({
        preset,
        kind: "device",
        deviceId: ctx.ultraWideDeviceId,
        requiresStreamRestart: true,
        maxCards,
      });
    }
    // 2× utan tillräcklig zoom, eller 0,5× utan ultravidvinkel: förvalet finns inte.
  }

  return options;
}

/**
 * Vilket förval STÅR vi på, givet spårets faktiska inställningar?
 *
 * Läses ur verkligheten (`getSettings()`), inte ur vad vi senast BAD om — en
 * `applyConstraints` kan tystna eller klampas av plattformen, och då ska
 * knappraden visa var kameran är, inte var vi hoppades att den var.
 */
export function derivePresetFromSettings(
  settings: MediaTrackSettings | null | undefined,
  ctx: ZoomContext
): ZoomPreset {
  if (ctx.ultraWideDeviceId && ctx.currentDeviceId === ctx.ultraWideDeviceId) return 0.5;
  const zoom = settings?.zoom;
  if (typeof zoom !== "number" || !ctx.zoomRange) return 1;
  const base = zoomBaseUnit(ctx.zoomRange);
  if (base <= 0) return 1;
  const factor = zoom / base;
  // Närmaste förval, men bara om vi är RIMLIGT nära det (±25 %) — ett
  // mellanläge (1,6×) är inget förval och ska inte lysa upp 2×-knappen.
  // Närmaste förval inom ±25 % relativ avvikelse — grova zoom-steg gör att en
  // 2×-begäran kan landa på 1,9× (se snapZoom), och då ska 2×-knappen lysa.
  // Ett äkta mellanläge (1,4× från ett OS-nyp) faller igenom till 1×.
  let best: ZoomPreset = 1;
  let bestDist = Infinity;
  for (const preset of ZOOM_PRESETS) {
    const dist = Math.abs(factor - preset) / preset;
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return bestDist <= 0.25 ? best : 1;
}

// ---------------------------------------------------------------------------
// SPÅR-OPERATIONER (tunna, ALLTID try/catch)
// ---------------------------------------------------------------------------

/**
 * Läser kapabiliteter defensivt. `getCapabilities` saknas HELT i iOS Safari och
 * i äldre WebViews, och kan kasta på ett spår som just avslutats.
 */
export function readCapabilities(
  track: MediaStreamTrack | null | undefined
): CameraCapabilities | null {
  if (!track || track.readyState !== "live") return null;
  const withCaps = track as MediaStreamTrack & {
    getCapabilities?: () => MediaTrackCapabilities;
  };
  if (typeof withCaps.getCapabilities !== "function") return null;
  try {
    return (withCaps.getCapabilities() ?? null) as CameraCapabilities | null;
  } catch {
    return null;
  }
}

/** Samma defensiva läsning för `getSettings()`. */
export function readSettings(
  track: MediaStreamTrack | null | undefined
): MediaTrackSettings | null {
  if (!track) return null;
  try {
    return track.getSettings() ?? null;
  } catch {
    return null;
  }
}

/**
 * ⛔ `applyConstraints` AVVISAR (OverconstrainedError/NotSupportedError) på
 * enheter som inte kan det man ber om — och en oavhanterad rejection i en
 * Capacitor-WebView bubblar upp som en krasch, inte som ett tyst nej. VARJE
 * anrop går genom den här: fångar, returnerar false.
 */
async function applyAdvanced(
  track: MediaStreamTrack | null | undefined,
  set: CameraConstraintSet
): Promise<boolean> {
  if (!track || track.readyState !== "live") return false;
  try {
    await track.applyConstraints({ advanced: [set] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tänder/släcker ficklampan. Returnerar det tillstånd kameran FAKTISKT hamnade i.
 *
 * Vi litar inte på att `applyConstraints` löste ut = lampan lyser: några
 * Android-skal löser ut och ignorerar. `getSettings().torch` är verkligheten när
 * den finns; saknas fältet får vår begäran gälla (bättre än att alltid rapportera
 * "av" och göra knappen omöjlig att stänga av).
 */
export async function applyTorch(
  track: MediaStreamTrack | null | undefined,
  on: boolean
): Promise<boolean> {
  const ok = await applyAdvanced(track, { torch: on });
  if (!ok) return false;
  const settings = readSettings(track);
  return typeof settings?.torch === "boolean" ? settings.torch : on;
}

/** Sätter ett rått zoom-värde i ENHETENS skala (inte "x"). */
export async function applyZoomValue(
  track: MediaStreamTrack | null | undefined,
  value: number
): Promise<boolean> {
  return applyAdvanced(track, { zoom: value });
}

/**
 * Pinnar en videobegäran till en viss kamera, utan att kasta bort anroparens
 * egna villkor (upplösningen! skannern BEGÄR 4K med flit).
 *
 * ⛔ `facingMode` tas bort: den och ett exakt `deviceId` kan motsäga varandra
 * och ge OverconstrainedError. `exact` är rätt här — faller den tillbaka på
 * huvudkameran har användaren tryckt 0,5× och fått 1×, tyst.
 */
export function withDeviceId(
  video: MediaTrackConstraints,
  deviceId: string
): MediaTrackConstraints {
  const next: MediaTrackConstraints = { ...video, deviceId: { exact: deviceId } };
  delete next.facingMode;
  return next;
}
