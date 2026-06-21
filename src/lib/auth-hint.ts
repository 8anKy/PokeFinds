"use client";

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

export function setAuthHint(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${NAME}=1; path=/; max-age=${MAX_AGE}; samesite=lax`
    : `${NAME}=; path=/; max-age=0; samesite=lax`;
}

export function hasAuthHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").includes(`${NAME}=1`);
}
