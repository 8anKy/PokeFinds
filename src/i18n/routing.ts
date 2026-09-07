import { defineRouting } from "next-intl/routing";

// Svenska = standard UTAN prefix (befintliga URL:er oförändrade: /marknad, /produkter/...).
// Engelska = /en/... . localePrefix "as-needed" håller sv-SEO och Capacitor-deeplinks intakta.
export const routing = defineRouting({
  locales: ["sv", "en"],
  defaultLocale: "sv",
  localePrefix: "as-needed",
  // ⛔ `maxAge` MÅSTE stå här — utan den är NEXT_LOCALE en SESSIONSCOOKIE och
  // språkvalet överlever inte att webbläsaren (eller appens WebView) stängs.
  // next-intls default är `{ name: "NEXT_LOCALE", sameSite: "lax" }`, alltså UTAN
  // livslängd, och den skrivs på BÅDA vägarna: `syncCookie` i middlewaren och
  // `syncLocaleCookie` i klientroutern (`useRouter().replace(..., { locale })`).
  // Den senare kördes EFTER språkväljarens egen 1-årscookie och skrev över den med
  // en sessionscookie — därför "fastnade" ett byte EN→SV bara till nästa omstart,
  // varefter `Accept-Language` vann igen och språket föll tillbaka till engelska.
  // Vaktat av tests/unit/locale-cookie.test.ts.
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];
