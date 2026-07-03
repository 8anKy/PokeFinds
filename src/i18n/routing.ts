import { defineRouting } from "next-intl/routing";

// Svenska = standard UTAN prefix (befintliga URL:er oförändrade: /marknad, /produkter/...).
// Engelska = /en/... . localePrefix "as-needed" håller sv-SEO och Capacitor-deeplinks intakta.
export const routing = defineRouting({
  locales: ["sv", "en"],
  defaultLocale: "sv",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
