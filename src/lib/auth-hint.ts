"use client";

import { useSyncExternalStore } from "react";

/**
 * Liten, icke-känslig "inloggad?"-ledtråd i en läsbar cookie så att klient-chrome
 * (header, tabbar) slipper anropa /api/auth/session per sidvisning — det anropet
 * sköt 411K function-invocations/mån och brände Vercel Active CPU, även för
 * utloggade besökare. Sätts vid login, rensas vid logout. Servern avgör ALLTID
 * den riktiga behörigheten (middleware + API) — denna cookie är bara en UI-hint,
 * så en inaktuell hint är ofarlig (self-healing: nästa skyddade anrop omdirigerar).
 */
const NAME = "fo_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dygn (matchar JWT-sessionens maxAge)
const EVENT = "fo_auth_change";

export function setAuthHint(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${NAME}=1; path=/; max-age=${MAX_AGE}; samesite=lax`
    : `${NAME}=; path=/; max-age=0; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function hasAuthHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").includes(`${NAME}=1`);
}

/** Prenumerera på hint-ändringar (login/logout i appen). Returnerar avprenumerant. */
export function onAuthHintChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

const serverSnapshot = (): null => null;

/**
 * Reaktiv variant: uppdateras direkt när setAuthHint körs (login/logout i appen).
 *
 * `null` = "vet inte än" och förekommer BARA i serverrenderingen och den första
 * hydreringsrundan (`getServerSnapshot`). På klienten läses cookien SYNKRONT i
 * första renderingen. ⛔ Inte `useState(null)` + effekt: headern ligger i varje
 * routegrupps egen layout och REMONTERAS vid varje flikbyte (Utforska → Samling
 * → Mer …), och en effekt-läsning gav då en runda med platshållaren (128 px)
 * före profilcirkeln (36 px) — Discord-knappen bredvid hoppade ~90 px i sidled
 * vid varje flikbyte (rapporterat 2026-09-06). useSyncExternalStore ger
 * server-värdet vid hydrering (ingen mismatch) och det riktiga vid alla andra
 * monteringar.
 */
export function useAuthHint(): boolean | null {
  return useSyncExternalStore<boolean | null>(onAuthHintChange, hasAuthHint, serverSnapshot);
}
