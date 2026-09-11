/** Tar bort locale-prefixet som next-intl ibland exponerar under kallstart. */
export function normalizeSwipePathname(pathname: string): string {
  return pathname.replace(/^\/(?:sv|en)(?=\/|$)/, "") || "/";
}

/**
 * Rutter som faktiskt renderar SwipeBack. Fångsten använder samma dom så en
 * vanlig intern länk aldrig kopierar den nuvarande sidan i onödan.
 */
export function isSwipeBackDestination(pathname: string): boolean {
  const normalized = normalizeSwipePathname(pathname);
  return (
    /^\/(?:sets|profil)\/[^/]+$/.test(normalized) ||
    /^\/forum\/(?:g|t)\/[^/]+$/.test(normalized) ||
    normalized === "/forum/sparade" ||
    /^\/(?:nyheter|evenemang)\/[^/]+$/.test(normalized) ||
    normalized === "/bevakningar" ||
    normalized === "/gradera" ||
    normalized === "/meddelanden" ||
    /^\/meddelanden\/[^/]+$/.test(normalized) ||
    normalized === "/skanna" ||
    normalized === "/installningar" ||
    /^\/installningar\/(?:konto|kopplingar|notiser|profil|synlighet)$/.test(normalized) ||
    /^\/mer\/(?:utmarkelser|bjud-in)$/.test(normalized)
  );
}
