import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import "@/styles/globals.css";
import { routing } from "@/i18n/routing";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
import { Providers } from "@/components/providers";
import { CookieBanner } from "@/components/features/cookie-banner";
import { ServiceWorkerRegister } from "@/components/pwa-register";
import { BottomTabs } from "@/components/layout/bottom-tabs";
import { ProductOverlayHost } from "@/components/features/product-overlay";
import { PushManager } from "@/components/push-manager";
import { ScrollReset } from "@/components/scroll-reset";
import { EngagementTracker } from "@/components/engagement-tracker";
import { AppBoot } from "@/components/app-boot";
import { OfflineBanner } from "@/components/offline-banner";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Meta" });
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    title: {
      default: t("title"),
      template: "%s | Foilio",
    },
    description: t("description"),
    openGraph: {
      type: "website",
      locale: t("ogLocale"),
      siteName: "Foilio",
      title: t("title"),
      description: t("ogDescription"),
    },
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/manifest.json",
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  // Explicit annars tappas device-width i Capacitor-WebView:en → desktop-layout på mobil.
  width: "device-width",
  initialScale: 1,
  // cover → env(safe-area-inset-*) får riktiga värden (bottom-tabs + body-padding).
  viewportFit: "cover",
  // App-känsla: ingen zoom. Stoppar iOS auto-zoom när man fokuserar sökfältet
  // (som annars sköt sönder layouten) + pinch-zoom som flyttade menyraden.
  maximumScale: 1,
  userScalable: false,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Aktiverar statisk rendering (ISR) för locale-segmentet — annars blir sidorna dynamiska.
  setRequestLocale(locale);
  const messages = await getMessages();
  const tLoad = await getTranslations({ locale, namespace: "Loading" });

  return (
    <html lang={locale} className={`dark ${inter.variable}`}>
      <body>
        {/* Branded laddningsskärm (#21, ägarens Stitch-design "Foilio - Loading").
            Ligger i SSR-HTML:en → syns direkt vid kall app-/sidstart och täcker
            nätverks-/hydreringsgapet. AppBoot döljer den (+ native splash) när appen
            hydrerat. noscript: utan JS döljs den så SSR-innehållet blir synligt. */}
        <div id="app-loader" aria-hidden="true">
          <span className="app-loader-word">Foilio</span>
          <span className="app-loader-status">
            <svg
              className="app-loader-spinner"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                fill="currentColor"
                opacity="0.75"
              />
            </svg>
            <span className="app-loader-sub">{tLoad("collection")}</span>
          </span>
        </div>
        <noscript>
          <style>{`#app-loader{display:none}`}</style>
        </noscript>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            {children}
            {/* Overlay FÖRE bottom-tabs: båda z-40 → tabs (senare i DOM) målas
                ovanpå overlayn (syns/klickbara), medan overlayn täcker sidans egen
                header (annars dubbel header). */}
            <ProductOverlayHost />
            <BottomTabs />
            {/* Push-tap-navigering: mountad i ROT-layouten (ej (app)-gruppen) så
                notis-tap landar rätt även när appen står på en marketing-route som
                Utforska (/produkter). Capacitor retainar tap-eventet tills en lyssnare
                finns → tidigare gick det förlorat på de routerna. */}
            <PushManager />
            <CookieBanner />
            <ServiceWorkerRegister />
            <ScrollReset />
            <EngagementTracker />
            <AppBoot />
            <OfflineBanner />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
