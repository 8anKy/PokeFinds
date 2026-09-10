/**
 * Lanseringsgrind för samlingsimporten.
 *
 * ⛔ Fail-safe åt rätt håll: en saknad eller felstavad variabel betyder DOLD.
 * Importen skriver många samlingsposter i ett svep och får inte gå att nå via
 * en gissad sida eller ett direkt API-anrop innan ägaren har testat flödet.
 */
export function collectionImportPublic(
  value: string | undefined = process.env.COLLECTION_IMPORT_PUBLIC
): boolean {
  return value === "1";
}
