"use client";

import { useEffect, useState } from "react";

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

/** Reaktiv variant: uppdateras direkt när setAuthHint körs (login/logout i appen). */
export function useAuthHint(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setOn(hasAuthHint());
    read();
    return onAuthHintChange(read);
  }, []);
  return on;
}
