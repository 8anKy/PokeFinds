/**
 * AUTO-FÅNGSTENS AVTRYCKARE — "ett kort ligger STILLA i ramen", inte "vi vet redan vilket kort".
 *
 * VARFÖR (mätt 2026-11-28, ägaren: auto-skanningen hittar inte korten, varken i kortmataren eller
 * i handen): avtryckaren krävde förut att LIVE-POLLEN (`/identify-art`, färglayouten ensam) var
 * "säker" tre pollar i rad. 600 riktiga fångster uppspelade genom samma regel: säker på **13 %**
 * av rutorna, och pollens etta var kortet skanningen till slut visade i 51 %. Avtryckaren kunde
 * alltså inte gå för de flesta kort, hur snabb pollen än var (48 ms server, en poll per ~210 ms i
 * drift samma dag). Och kravet köpte ingen träffsäkerhet: VILKET kort det är avgörs av skanningen
 * (`/identify`, motorn), precis som vid ett manuellt tryck.
 *
 * Nu avgör tre lokala frågor, alla ur pixlar pollen redan läst (inget nätanrop):
 *   1. STILLA — på varandra följande rutor ser likadana ut (korrelation mellan konstavtrycken).
 *   2. SKARP — skärpegrinden som förut (`SHARP_AUTO_MIN`, lib/frame-sharpness.ts).
 *   3. NYTT — rutan skiljer sig från den som senast fångades, eller har gjort det sedan dess.
 *
 * TRÖSKLARNA ÄR SATTA PÅ PRODUKTIONSDATA (ScannerJob, 2026-11-28), inte på en gissning:
 *   · rutor ur SAMMA fångst (~16 ms isär, n=2 428): p05 0,942 · p10 0,964 · median 0,994
 *   · två fångster i rad av OLIKA kort (n=2 893):   median 0,416 · p95 0,797 · p99 0,885
 * ⇒ `STILL_MIN` 0,92 ligger över p99 för ett kortbyte (ett byte läses inte som "stilla") och under
 * p05 för en stadig hand. `REARM_MAX` 0,80 = p95 för olika kort: ett nytt kort som liknar det förra
 * mer än så laddar om på RÖRELSEN under bytet (en ruta mitt i bytet räcker), inte på slutbilden.
 * ⚠️ Rutorna i mätningen ligger 16 ms isär, avtryckaren jämför med ~120 ms: en ostadig hand kan
 * ligga lägre. Varje auto-fångst bokförs (`recall.auto`, lägsta korrelationen den gick på) så
 * tröskeln kan flyttas på en fördelning.
 *
 * ⛔ Två LIKA kort i rad (energier i en kortmatare) skiljs bara av rörelsen mellan dem — därför
 * laddar avtryckaren om på en ENDA avvikande ruta, och därför får takten (`AUTO_TICK_MS`) inte
 * sänkas så långt att ett byte ryms mellan två rutor.
 * ⛔ Ingen närvarogrind: varken pollens poäng eller hörndetektorn skiljer "kort" från "inget kort"
 * (mätt: poäng ≥ 0,55 för 96 % av korten och 76 % av "inget kort"-fångsterna; hörn hittade på 66 %
 * respektive 37 %). En stadig, skarp ruta utan kort ger alltså en skanning som svarar "ingen träff";
 * `autoCaptureResult` bromsar då nästa försök, så en vy utan kort inte matar skanningar.
 */

/** Rutorna ska vara minst så här lika för att räknas som stilla. */
export const AUTO_STILL_MIN = 0.92;
/** Antal rutor i rad som ska vara stilla (3 rutor = 2 jämförelser ≈ 0,25 s vid 120 ms). */
export const AUTO_STILL_FRAMES = 3;
/** Under den här likheten mot senast fångade ruta är det en ny scen ⇒ avtryckaren laddas om. */
export const AUTO_REARM_MAX = 0.8;
/** Avtryckarens takt. Lokal — nätpollen (chippet) går i sin egen takt bredvid. */
export const AUTO_TICK_MS = 120;
/**
 * Paus efter auto-fångster i rad UTAN träff (index = antal missar, sista värdet gäller därefter).
 * Första missen är gratis: motorn missar enstaka riktiga kort, och i en kortmatare ska nästa kort
 * inte få vänta för det. Två i rad är med ~2 % sannolikhet riktiga kort — då är det troligare en
 * vy utan kort.
 */
export const AUTO_MISS_BACKOFF_MS = [0, 0, 1500, 3000, 6000] as const;
/**
 * Så många skanningar får vänta på svar innan avtryckaren håller inne. Motorn tar ett kort i taget
 * (~0,7 s) och den snabba vägen ger upp efter 4 s — en längre kö hade fått svar på sämre underlag.
 */
export const AUTO_MAX_PENDING = 2;

export interface AutoCaptureState {
  /** Förra rutans avtryck. */
  prev: Int8Array | null;
  /** Rutor i rad som varit stilla (inklusive den första i raden). */
  still: number;
  /** Lägsta korrelationen i den pågående stilla raden — mätdata. */
  stillMin: number;
  /** Avtrycket som senast fångades (auto ELLER manuellt). Null = laddad. */
  fired: Int8Array | null;
  /** Auto-fångster i rad utan träff. */
  misses: number;
  /** Tidigast nästa auto-fångst (ms, samma klocka som `now`). */
  pausedUntil: number;
}

export function newAutoCaptureState(): AutoCaptureState {
  return { prev: null, still: 0, stillMin: 1, fired: null, misses: 0, pausedUntil: 0 };
}

/**
 * Korrelationen mellan två konstavtryck (−1..1). Avtrycken är standardiserade per kanal
 * (lib/art-fingerprint.ts), så det här är oberoende av ljusstyrka och vitbalans.
 * ⛔ En helt jämn ruta (locket på, alla nollor) ger 0, aldrig 1: en svart bild är inte "stilla".
 */
export function frameCorrelation(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

export interface AutoCaptureFrame {
  /** Rutans konstavtryck (hela ramen, utan inset). Null = gick inte att räkna. */
  fp: Int8Array | null;
  /** Rutan är för suddig (skärpegrinden). Okänd skärpa räknas som skarp — se frame-sharpness.ts. */
  blurry: boolean;
  /** Skanningar som väntar på svar. */
  pending: number;
  now: number;
}

/**
 * En ruta in, ett besked ut: ska slutaren gå NU? Muterar `state`.
 * ⛔ Anroparen bokför fångsten med `autoCaptureFired` först när slutaren faktiskt gick — den kan
 * vägra (nedkylning), och då ska nästa ruta försöka igen.
 */
export function autoCaptureStep(
  state: AutoCaptureState,
  frame: AutoCaptureFrame
): { fire: boolean; stillMin: number } {
  const { fp } = frame;
  if (!fp) {
    state.prev = null;
    state.still = 0;
    state.stillMin = 1;
    return { fire: false, stillMin: 1 };
  }
  // NYTT? En enda ruta som avviker från den fångade räcker — bytet mellan två kort är kort.
  if (state.fired && frameCorrelation(fp, state.fired) < AUTO_REARM_MAX) state.fired = null;

  const c = state.prev ? frameCorrelation(fp, state.prev) : 0;
  if (state.prev && c >= AUTO_STILL_MIN) {
    state.still += 1;
    state.stillMin = Math.min(state.stillMin, c);
  } else {
    state.still = 1;
    state.stillMin = 1;
  }
  state.prev = fp;

  const fire =
    state.fired === null &&
    state.still >= AUTO_STILL_FRAMES &&
    !frame.blurry &&
    frame.pending < AUTO_MAX_PENDING &&
    frame.now >= state.pausedUntil;
  return { fire, stillMin: state.stillMin };
}

/** Slutaren gick (auto eller manuellt) på den här rutan — samma scen fångas inte en gång till. */
export function autoCaptureFired(state: AutoCaptureState, fp: Int8Array | null): void {
  if (fp) state.fired = fp;
}

/**
 * Pollen pausades (ett ark över kameran, lägesbyte). Rörelsehistoriken nollas, men det fångade
 * kortet MINNS — annars fångas samma kort igen så snart arket stängs.
 */
export function autoCapturePaused(state: AutoCaptureState): void {
  state.prev = null;
  state.still = 0;
  state.stillMin = 1;
}

/** Ett skanningssvar kom. En träff (auto eller manuell) nollar bromsen; bara auto-missar bromsar. */
export function autoCaptureResult(
  state: AutoCaptureState,
  r: { auto: boolean; hit: boolean; now: number }
): void {
  if (r.hit) {
    state.misses = 0;
    state.pausedUntil = 0;
    return;
  }
  if (!r.auto) return;
  state.misses += 1;
  const wait = AUTO_MISS_BACKOFF_MS[Math.min(state.misses, AUTO_MISS_BACKOFF_MS.length - 1)];
  state.pausedUntil = wait > 0 ? r.now + wait : 0;
}
