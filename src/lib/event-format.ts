/**
 * Datumtexterna för evenemang. Egen fil för att BÅDE klientlistan och den
 * serverrenderade detaljsidan använder dem — en funktion som bor i en
 * `"use client"`-modul går inte att anropa från en serverkomponent (den blir en
 * klientreferens, inte en funktion).
 */
import { daysUntil, type EventItem } from "@/lib/feed";
import { dateLocaleTag } from "@/lib/format";

/** "lör 3 okt 10:00 – sön 4 okt 19:00", eller bara startdagen när slut saknas. */
export function formatEventRange(event: Pick<EventItem, "startsAt" | "endsAt">, locale: string): string {
  const tag = dateLocaleTag(locale);
  const start = new Date(event.startsAt);
  const day = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" });
  const startText = `${day.format(start)} ${time.format(start)}`.replace(/\./g, "");
  if (!event.endsAt) return startText;
  const end = new Date(event.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const endText = sameDay ? time.format(end) : `${day.format(end)} ${time.format(end)}`.replace(/\./g, "");
  return `${startText} – ${endText}`;
}

/**
 * Nedräkningens form. `null` när evenemanget redan börjat — då visas ingen pill
 * alls hellre än "om 0 dagar", som läser som ett fel.
 */
export function countdownFor(startsAt: string, now = new Date()): { key: "today" | "tomorrow" | "days"; days: number } | null {
  const days = daysUntil(startsAt, now);
  if (days < 0) return null;
  if (days === 0) return { key: "today", days };
  if (days === 1) return { key: "tomorrow", days };
  return { key: "days", days };
}
