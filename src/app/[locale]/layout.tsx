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

  return (
    <html lang={locale} className={`dark ${inter.variable}`}>
      <body>
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
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
