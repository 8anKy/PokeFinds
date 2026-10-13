/**
 * VECKOPUSHEN OM SAMLINGEN (ägarbeslut 2026-10-13, ersätter veckobrevet).
 *
 * Ren text-dom — jobbet (src/jobs/portfolio-push.ts) räknar talen, den här filen
 * bestämmer vad som står i notisen. Testad i tests/unit/portfolio-push.test.ts.
 *
 * ⛔ FÖRÄNDRINGEN ÄR MARKNADENS, INTE SAMLINGENS: den räknas bara på poster som
 *    ägdes redan för en vecka sedan. Annars hade "+2 000 kr" betytt "du skannade
 *    kort i veckan" — ett påstående om marknaden som inte är sant.
 * ⛔ Ingen förändring känd ⇒ notisen säger bara värdet, aldrig "0 %".
 */
import { formatPercent, formatPrice } from "@/lib/format";

export interface PortfolioPushInput {
  /** Hela samlingens värde nu (öre). */
  totalValueOre: number;
  /** Marknadens rörelse på det som ägdes för en vecka sedan (öre), null = okänd. */
  changeOre: number | null;
  /**
   * Procent av det som ägdes för en vecka sedan. null när den delen är för liten del
   * av samlingen — "−7 kr (−2,1 %)" på en samling värd 3 455 kr läser som ett räknefel.
   */
  changePercent: number | null;
  /** Veckans största lyft i samlingen, om något steg. */
  topMover: { name: string; percent: number } | null;
}

/** Under en krona i rörelse är det avrundning, inte en vecka. */
const FLAT_ORE = 100;

const kr = (ore: number) => formatPrice(Math.round(ore / 100) * 100);

export function portfolioPushMessage(
  input: PortfolioPushInput
): { title: string; body: string; url: string } | null {
  // 0 kr är inget värde — "–" betyder att vi inte vet. Ingen notis.
  if (!(input.totalValueOre > 0)) return null;

  const parts = [`Din samling är värd ${kr(input.totalValueOre)}.`];
  const { changeOre, changePercent } = input;
  if (changeOre != null) {
    if (Math.abs(changeOre) < FLAT_ORE) {
      parts.push("Oförändrad mot förra veckan.");
    } else {
      const sign = changeOre > 0 ? "+" : "−";
      // Procenten utelämnas när jobbet inte kan ge en ärlig (se `changePercent`).
      const pct = changePercent != null ? ` (${sign}${formatPercent(Math.abs(changePercent), false)})` : "";
      parts.push(`${sign}${kr(Math.abs(changeOre))}${pct} den här veckan.`);
    }
  }
  if (input.topMover && input.topMover.percent > 0) {
    parts.push(`Störst lyft: ${input.topMover.name} ${formatPercent(input.topMover.percent)}.`);
  }

  return { title: "Din samling den här veckan", body: parts.join(" "), url: "/samling" };
}
