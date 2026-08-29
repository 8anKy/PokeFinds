/**
 * Visningsnamn för konton som skapas utan formulär (Google/Apple).
 *
 * `User.name` är case-insensitivt UNIKT (råindex User_name_lower_key), och
 * leverantörens förslag ("Anna") krockar garanterat förr eller senare. Rena
 * funktioner över en `isTaken`-fråga så dedupen går att testa utan databas.
 * Gränserna (2–80 tecken) är registreringsformulärets — profilen ska aldrig
 * visa ett namn formuläret hade nekat.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 80;

/** Basnamn ur leverantörens förslag, annars e-postens lokaldel, annars "Samlare". */
export function baseDisplayName(name: string | null, email: string | null): string {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length >= NAME_MIN) return cleaned.slice(0, NAME_MAX);
  const local = (email ?? "").split("@")[0]?.replace(/[._+-]+/g, " ").trim() ?? "";
  if (local.length >= NAME_MIN) return local.slice(0, NAME_MAX);
  return "Samlare";
}

/**
 * Nästa lediga variant: "Anna", "Anna 2", "Anna 3" … Efter 50 försök ett
 * slumpsuffix — ett upptaget namn får aldrig blockera en inloggning.
 */
export async function uniqueDisplayName(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const withSuffix = (suffix: string) => base.slice(0, NAME_MAX - suffix.length) + suffix;
  if (!(await isTaken(base))) return base;
  for (let n = 2; n <= 50; n++) {
    const candidate = withSuffix(` ${n}`);
    if (!(await isTaken(candidate))) return candidate;
  }
  return withSuffix(` ${Math.floor(1000 + Math.random() * 9000)}`);
}
