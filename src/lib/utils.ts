import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * HTML-entiteter i butiksfeeds — MÅSTE avkodas före normalisering.
 *
 * Utan detta blir "Team Rocket&#x27;s Mewtwo ex" till "...rocket x27 s..." och
 * multipack-vakten läser "x27" som "×27 styck" → hela annonsen förkastas som
 * lot-annons och produkten får ingen offer alls. På samma sätt innehöll
 * "Cynthia&#039;s Garchomp" strängen "#039" och lästes som ett kortnummer.
 * Hittat i katalogrevisionen 2026-07-13 — drabbar VARJE produkt med apostrof.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Råtitel med entiteter avkodade — för vakter som behöver parenteser/siffror kvar. */
/**
 * Dagens datum vid UTC-midnatt — nyckeln varje PriceSnapshot skrivs på.
 *
 * ANVÄND ALDRIG `d.setHours(0,0,0,0)` för det: den ger LOKAL midnatt, och
 * `PriceSnapshot.date` är en `@db.Date` som lagrar UTC-datumet. På en svensk
 * maskin (UTC+2) blir 2026-07-25 lokal midnatt = 2026-07-24T22:00Z → hela
 * körningen skriver på GÅRDAGENS rad. GitHub Actions kör i UTC så felet syns
 * aldrig i drift — bara när jobben körs manuellt från en annan tidszon, och då
 * skriver de tyst över fel dygn (hände 2026-07-25: en lokal omkörning klobbrade
 * 07-24 och lämnade 07-25 orörd).
 */
export function utcToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** `days` dygn före UTC-midnatt idag — samma nyckelrymd som utcToday(). */
export function utcDaysAgo(days: number): Date {
  const d = utcToday();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function decodeTitle(s: string): string {
  return decodeHtmlEntities(s);
}

/** Normaliserar produkttitlar för matchning: gemener, inga specialtecken, kollapsade mellanslag. */
export function normalizeTitle(s: string): string {
  return decodeHtmlEntities(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
