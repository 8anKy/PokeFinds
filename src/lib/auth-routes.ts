/**
 * Sidor som nås via e-postlänk i en EXTERN webbläsare (Safari/Gmail), inte appen:
 * lösenordsåterställning och e-postverifiering. På dessa visar vi inga vägar in i
 * webben (ingen tab-bar, oklickbar logo, inga login-knappar) — användaren ska gå
 * tillbaka till appen. Se dead-end-behandlingen i bottom-tabs + auth-brand + sidorna.
 */
export const EMAIL_LANDING_ROUTES = ["/aterstall-losenord", "/verifiera"] as const;

export function isEmailLandingRoute(pathname: string | null | undefined): boolean {
  return (
    !!pathname &&
    EMAIL_LANDING_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}
