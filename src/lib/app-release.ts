/**
 * UPPDATERINGSSKÄRMEN — när visas den, för vilken version och med vilka nyheter.
 *
 * EN fil styr båda telefonerna (ägarbeslut 2026-10-06): `src/data/app-release.json`.
 * Den skrivs när en version släpps: versionsnummer, datum, nyheterna och golvet för
 * en TVINGAD uppdatering. Appen jämför sin egen version (`@capacitor/app`) med den.
 *
 * ⛔ Butiken måste HA versionen innan skärmen lovar den:
 *   • iPhone — Apples lookup (`/api/app/min-version`) säger vad som FAKTISKT ligger i
 *     App Store. Skärmen visar den versionen; under Apples granskning hade
 *     "Uppdatera" annars lett till en butikssida med den gamla.
 *   • Android — Google Play har inget publikt uppslag. `androidOnPlay` i filen sätts
 *     till true FÖRST när Play publicerat versionen.
 * Nyheterna visas bara när butikens version ÄR filens version; annars en neutral rad
 * (någon glömde uppdatera filen — skärmen ska inte påstå fel nyheter).
 *
 * Ren och testad (`tests/unit/app-release.test.ts`). Webben når aldrig hit.
 */
import { compareVersions } from "@/lib/app-version";

export type ReleaseIcon = "link" | "store" | "map" | "scan" | "bell" | "spark";

export interface ReleaseNote {
  icon?: ReleaseIcon;
  title: string;
  text: string;
  en?: { title: string; text: string };
}

export interface AppRelease {
  version: string;
  /** ISO-datum ("2026-10-08"). */
  released: string;
  /** Under den här ⇒ tvingad uppdatering (ingen "Senare"). */
  minVersion: string;
  /** Sätts till true när Google Play publicerat `version`. */
  androidOnPlay: boolean;
  notes: ReleaseNote[];
}

export interface UpdatePrompt {
  mode: "optional" | "required";
  /** Versionen användaren får i butiken. */
  version: string;
  installed: string;
  /** Tom ⇒ visa den neutrala raden. */
  notes: ReleaseNote[];
  /** Dagen `version` släpptes ("2026-10-06"): Apples datum på iPhone, annars filens. */
  released: string | null;
}

export function updatePrompt(opts: {
  platform: "ios" | "android";
  installed: string | null | undefined;
  release: AppRelease;
  /** iPhone: versionen i App Store enligt Apples lookup. */
  iosStoreVersion?: string | null;
  /** iPhone: dagen Apple släppte den versionen ("2026-10-06") — vinner över filens datum. */
  iosStoreReleased?: string | null;
}): UpdatePrompt | null {
  const { platform, installed, release } = opts;
  if (!installed) return null;
  const available = platform === "ios" ? opts.iosStoreVersion : release.androidOnPlay ? release.version : null;
  if (!available) return null;
  const newer = compareVersions(available, installed);
  if (newer === null || newer <= 0) return null;
  const belowMin = compareVersions(installed, release.minVersion);
  const sameAsFile = compareVersions(available, release.version) === 0;
  return {
    mode: belowMin !== null && belowMin < 0 ? "required" : "optional",
    version: available.trim(),
    installed: installed.trim(),
    notes: sameAsFile ? release.notes : [],
    // ⛔ Filens datum skrivs i FÖRVÄG (1.4 stod på "8 oktober", Apple släppte den 6:e).
    //    På iPhone vet Apple svaret; filen är bara reserven.
    released: (platform === "ios" ? opts.iosStoreReleased : null) || (sameAsFile ? release.released : null),
  };
}

/** Nyhetens text på användarens språk; svenskan är originalet och reserven. */
export function localizedNote(note: ReleaseNote, locale: string): { title: string; text: string } {
  return locale === "en" && note.en ? note.en : { title: note.title, text: note.text };
}
