/**
 * Säljarens identitet — det e-handelslagen (2002:562) 8 § kräver att en
 * näringsidkare publicerar: namn, geografisk adress, e-post och momsreg.nr.
 *
 * ⛔ BOR I MILJÖVARIABLER, INTE I KODEN. Verksamheten är en ENSKILD FIRMA, vilket
 * betyder att "företagsadressen" är ägarens HEMADRESS och att momsreg.numret är
 * bildat ur personnumret. Lagen kräver att det står på SAJTEN — den kräver inte
 * att det ligger i ett PUBLIKT GitHub-repo, där det dessutom klonas, indexeras och
 * arkiveras utanför vår kontroll. Uppgifterna sätts därför på Railway och renderas
 * av den körande appen. Samma resonemang som att villkorsutkasten flyttades till
 * det privata systerrepot (2026-08-05).
 *
 * ⚠️ Detta är INTE juridisk rådgivning. Texten på /villkor är ett utkast som en
 * svensk jurist bör läsa innan den betraktas som färdig.
 */
export interface LegalEntity {
  name: string;
  /** En rad per adressrad, i visningsordning. */
  addressLines: string[];
  vatNumber: string;
  email: string;
}

/** Adressen är flerradig men en env-variabel är enradig → "|" separerar raderna. */
const ADDRESS_SEPARATOR = "|";

/**
 * `null` när uppgifterna saknas eller är HALVA.
 *
 * ⛔ Allt-eller-inget med flit: ett företagsblock som visar namn men saknar
 * momsreg.nr ser ut som att kravet är uppfyllt utan att vara det, och det är
 * värre än att blocket inte finns — då syns det åtminstone att något saknas.
 * `startCheckout` vägrar dessutom sälja när den här returnerar null, så en
 * ofullständig konfiguration kan inte tyst leda till försäljning.
 */
export function legalEntity(): LegalEntity | null {
  const name = process.env.LEGAL_ENTITY_NAME?.trim();
  const address = process.env.LEGAL_ENTITY_ADDRESS?.trim();
  const vatNumber = process.env.LEGAL_ENTITY_VAT?.trim();
  const email = process.env.LEGAL_ENTITY_EMAIL?.trim() || "hej@foilio.se";
  if (!name || !address || !vatNumber) return null;

  const addressLines = address
    .split(ADDRESS_SEPARATOR)
    .map((line) => line.trim())
    .filter(Boolean);
  if (addressLines.length === 0) return null;

  return { name, addressLines, vatNumber, email };
}
