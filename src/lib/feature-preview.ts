/**
 * FÖRHANDSVISNING AV FUNKTIONER — "bara för mig tills jag testat".
 *
 * Ägaren vill kunna prova en ändring i drift innan alla får den. Tre nycklar
 * öppnar en funktion, i den här ordningen:
 *   1. `FEATURE_<NAMN>_PUBLIC=1`   — släppt för alla (Railway-env, ny deploy)
 *   2. rollen ADMIN/SUPERADMIN      — ägarens eget konto
 *   3. `FEATURE_PREVIEW_EMAILS`     — kommaseparerad lista, t.ex. ett gratis
 *                                     testkonto (skannerräknaren syns aldrig
 *                                     för en admin — admin har ingen kvot)
 *
 * ⛔ Fail-safe åt rätt håll: saknad/felstavad variabel = DOLD. Samma mönster
 * som collection-import-gate och community-v2-gate. Ren funktion — servern
 * skickar in env och användare, testerna slipper process.env.
 */
/** APP_TOUR = appens guidade tur (lib/app-tour.ts), öppnas för alla med `FEATURE_APP_TOUR_PUBLIC=1`. */
export type PreviewFeature = "SCAN_COUNTER" | "PUSH_TO_STORE" | "APP_TOUR";

const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);

export interface PreviewInput {
  feature: PreviewFeature;
  role?: string | null;
  email?: string | null;
  /** `FEATURE_<feature>_PUBLIC` */
  publicFlag?: string | null;
  /** `FEATURE_PREVIEW_EMAILS` */
  previewEmails?: string | null;
}

export function parsePreviewEmails(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
}

export function previewAllowed(input: PreviewInput): boolean {
  if ((input.publicFlag ?? "").trim() === "1") return true;
  if (input.role && ADMIN_ROLES.has(input.role)) return true;
  const email = (input.email ?? "").trim().toLowerCase();
  return email.length > 0 && parsePreviewEmails(input.previewEmails).has(email);
}

/** Serverns läsning: env + användare. */
export function previewAllowedFor(
  feature: PreviewFeature,
  user: { role?: string | null; email?: string | null } | null | undefined
): boolean {
  return previewAllowed({
    feature,
    role: user?.role,
    email: user?.email,
    publicFlag: process.env[`FEATURE_${feature}_PUBLIC`],
    previewEmails: process.env.FEATURE_PREVIEW_EMAILS,
  });
}
