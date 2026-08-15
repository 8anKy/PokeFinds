/**
 * Förslag på rättad e-postdomän ("Menade du …@gmail.com?").
 *
 * BAKGRUND (2026-08-15): en registrering fastnade för att adressen var
 * feltypad — mejlet med koden studsade, användaren såg bara ett kodfält som
 * aldrig fylldes och försökte aldrig igen. Kontot skapas först NÄR koden anges,
 * så det fanns varken ett konto att laga eller en fungerande adress att nå
 * personen på. Enda verkliga botemedlet är att fånga typon INNAN mejlet skickas.
 *
 * ⛔ FÖRSLAGET BLOCKERAR ALDRIG. Det är en gissning om en domän vi inte känner
 * igen, och en riktig adress på en ovanlig domän måste alltid gå att skicka in.
 * Klienten renderar det som en knapp bredvid fältet, aldrig som ett fel.
 */

/**
 * Kända e-postdomäner. Listan är avsiktligt SVERIGE-TUNG och kort: varje post
 * gör förslagen försiktigare (en exakt träff ger aldrig förslag), men en lång
 * lista med udda domäner ökar risken att en feltypad adress ligger 1 tecken
 * från fel granne.
 *
 * ⛔ `email.com` och `mail.com` står MED FLIT INTE i listan. Båda är riktiga
 * domäner (mail.com-familjen), men i svensk trafik är sannolikheten att någon
 * menade `gmail.com` mycket större än att de har en adress där — och eftersom
 * förslaget bara är en knapp kostar en felaktig gissning ingenting för den som
 * faktiskt har adressen. Det var precis `@email.com` som studsade.
 */
const KNOWN_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.se",
  "outlook.com",
  "outlook.se",
  // Microsofts regionala domäner är RIKTIGA adresser som annars hade legat 2
  // tecken från "hotmail.se" och fått ett felaktigt förslag. De står här som
  // tystare, inte som gissningskandidater.
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.dk",
  "hotmail.nl",
  "outlook.dk",
  "outlook.de",
  "outlook.fr",
  "live.com",
  "live.se",
  "msn.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "yahoo.se",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "telia.com",
  "telia.se",
  "comhem.se",
  "tele2.se",
  "bredband.net",
  "bredband2.com",
  "spray.se",
  "passagen.se",
  "home.se",
  "swipnet.se",
] as const;

/** Domänens första etikett ("gmail" i "gmail.com"). */
function secondLevel(domain: string): string {
  return domain.slice(0, domain.indexOf("."));
}

/**
 * Damerau-Levenshtein (optimal string alignment) — som Levenshtein, men en
 * OMKASTNING av två grannar kostar 1 i stället för 2. Det är den vanligaste
 * skrivfelstypen ("gmial", "hotmial"), och med rak Levenshtein hade de krävt
 * tröskel 2, vilket i sin tur släppt igenom långsökta förslag.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Hur långt ifrån en känd domän får en typo ligga? Skalar med längden. */
function maxDistanceFor(domain: string): number {
  return domain.length >= 9 ? 2 : 1;
}

/**
 * Returnerar en rättad adress om domänen ser feltypad ut, annars `null`.
 * Lokaldelen rörs ALDRIG — ett fel där (`hugo` i stället för `hugoo`) går inte
 * att gissa, bara att låta användaren själv upptäcka.
 */
export function suggestEmailCorrection(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;

  const suggested = suggestDomain(domain);
  return suggested ? `${local}@${suggested}` : null;
}

/** Domändelen av `suggestEmailCorrection` — exporterad för tester. */
export function suggestDomain(domain: string): string | null {
  if ((KNOWN_DOMAINS as readonly string[]).includes(domain)) return null;

  // 1) Rätt leverantör, fel toppdomän ("gmail.se"). Avståndet fångar inte det
  //    (`.se` → `.com` är tre tecken), men etiketten före punkten är entydig.
  //    Kräver att exakt EN känd domän bär etiketten — bär flera den (hotmail
  //    finns som .se OCH .com) faller vi igenom till avståndet i stället för att
  //    ge upp: annars hade "hotmail.con" blivit helt utan förslag, och en missad
  //    typo kostar en registrering medan ett onödigt förslag bara är en knapp
  //    man låter bli att trycka på.
  const sld = secondLevel(domain);
  const sameProvider = KNOWN_DOMAINS.filter((d) => secondLevel(d) === sld);
  if (sameProvider.length === 1) return sameProvider[0];

  // 2) Nära granne. Vid oavgjort ges INGET förslag — två lika troliga
  //    kandidater betyder att vi inte vet, och ett myntkast i gränssnittet
  //    läser som ett påstående.
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const candidate of KNOWN_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  if (!best || tied || bestDistance > maxDistanceFor(domain)) return null;
  return best;
}
