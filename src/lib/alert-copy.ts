/**
 * Väljer meddelandenyckel efter om larmen är pausade.
 *
 * ⛔ VARFÖR EN NYCKEL-VÄXEL OCH INTE EN OMSKRIVEN STRÄNG. När restock-larmen pausades
 * 2026-08-23 löstes samma problem genom att RADERA ordet "restock" ur sju säljtexter.
 * Det är en enkelriktad åtgärd: den dagen larmen slås på igen måste någon minnas exakt
 * vilka sju strängar som en gång hade ett ord i sig, och vilket. Ingen kommer att göra
 * det. Här ligger den pausade formuleringen i en EGEN nyckel (`<namn>Paused`) och
 * originalet är orört — att slå på larmen igen kräver bara att flaggan ändras.
 *
 * Samma resonemang som `pausableFeatures()` för prissidans punktlistor; den här
 * funktionen är motsvarigheten för löpande text.
 *
 * Anropas både i server- och klientkomponenter, så flaggan skickas IN — modulen får
 * aldrig läsa env själv (klientkomponenter ser bara `NEXT_PUBLIC_`-speglingen och
 * serverkomponenter bara serverflaggan; en läsning här hade valt fel i ena fallet).
 */
export function alertCopyKey(base: string, paused: boolean): string {
  return paused ? `${base}Paused` : base;
}
