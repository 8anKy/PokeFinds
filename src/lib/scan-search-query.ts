/**
 * Den manuella sökningen i skannern: "dark tyranitar 19", "charizard 4/102",
 * "falinks TG07". Delar frågan i NAMNORD och ett eventuellt SAMLARNUMMER.
 *
 * Numret känns igen som ett eget ord med minst en siffra: "19", "#19", "019",
 * "4/102", "TG07", "SWSH140". Står det kvar som namnord hade "19" krävts i
 * kortets NAMN och sökningen gett noll träffar.
 *
 * ⛔ Inga lookbehinds (iOS 15-WebView) — modulen är ren men kan importeras av klienten.
 */
export interface ScanSearchQuery {
  /** Ord som ska finnas i kortets namn ELLER setets namn (gemener). */
  words: string[];
  /** Samlarnumret som skrivet ("19", "4", "TG07") utan total och inledande "#". */
  number: string | null;
}

const NUMBER_TOKEN = /^#?([A-Za-z]{0,5}\d{1,4}[A-Za-z]?)(?:\/[A-Za-z]{0,5}\d{1,4})?$/;

export function parseScanSearch(raw: string): ScanSearchQuery {
  const tokens = raw
    .trim()
    .slice(0, 80)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let number: string | null = null;
  const words: string[] = [];
  for (const t of tokens) {
    const m = NUMBER_TOKEN.exec(t);
    // Bara ETT nummer; ett andra sifferord ("151") hör till namnet/setet.
    if (m && number == null && /\d/.test(m[1])) {
      number = m[1];
      continue;
    }
    words.push(t.toLowerCase());
  }
  return { words, number };
}
