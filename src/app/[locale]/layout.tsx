import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import "@/styles/globals.css";
import { routing } from "@/i18n/routing";
import { baseOpenGraph } from "@/lib/canonical";

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
import { AppResumeRefresh } from "@/components/app-resume-refresh";
import { OfflineBanner } from "@/components/offline-banner";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Meta" });
  return {
    // ⛔ `||`, ALDRIG `??`: en tom miljövariabel (GitHub Actions expanderar en saknad
    // repo-variabel till "") passerar `??` — och `new URL("")` KASTAR, dvs rot-layouten
    // faller och HELA sajten svarar 500. Reserven är produktionsdomänen, inte localhost:
    // en absolut URL mot localhost hade i stället avindexerat sajten tyst. Vaktat av
    // tests/unit/env-empty-string-guard.test.ts.
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se"),
    title: {
      default: t("title"),
      template: "%s | Foilio",
    },
    description: t("description"),
    // Basen (type/siteName/og:locale/delningsbild) bor i baseOpenGraph() eftersom
    // Nexts metadata-merge är GRUND per toppfält — se kommentaren där.
    openGraph: {
      ...baseOpenGraph(params.locale),
      title: t("title"),
      description: t("ogDescription"),
    },
    // Utan `twitter` faller X/Twitter tillbaka på en naken länk. Kortet ärver
    // `og:image`/`og:title` automatiskt — därför bara korttypen här, ingen dubblerad
    // bild- och titeldeklaration som kan glida isär från openGraph.
    // ⚠️ `summary`, INTE `summary_large_image`: korttypen måste matcha BILDEN, och vår
    // delningsbild är märket i kvadrat (1024×1024). X beskär ett stort kort till 2:1
    // och hade kapat loggans över- och underkant; `summary` visar kvadraten hel.
    // Byt hit `summary_large_image` samtidigt som `OG_IMAGE` blir ett riktigt
    // 1200×630-kort (se lib/canonical.ts) — de två ändringarna hör ihop.
    // ⚠️ Gäller BARA X. Discord, Slack, iMessage och Facebook läser `og:image` och
    // bryr sig inte om den här raden.
    twitter: { card: "summary" },
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/manifest.json",
    // Ägarverifiering för Google Search Console. ⚠️ Egenskapen är sedan 2026-08-14 en
    // DOMÄN-property för `foilio.se` (täcker apex + www, http + https i EN property och
    // håller ihop historiken över värdbytet) — inte bara URL-prefixet
    // https://www.foilio.se, som var ENDA egenskapen när raden skrevs. Den propertyn
    // lever kvar (den hänger på en DNS-TXT utanför repot); apex blev kanonisk samma dag.
    // Domän-propertyn verifierades via DNS-TXT på `@`; den här taggen och
    // public/google892b920dceef4a34.html är de äldre bevisen. BÅDA stannar — vilket
    // bevis som håller vilken property är inte värt att gissa i, och att behålla dem
    // kostar ingenting.
    // ⛔ TA INTE BORT NÅGOT AV BEVISEN efter att verifieringen gått igenom: Google
    // kontrollerar beviset om med jämna mellanrum och AVVERIFIERAR egenskapen om det
    // försvunnit — då slutar sitemap-inlämning, indexeringsrapporter och
    // "Begär indexering" fungera, tyst och utan att något i appen felar.
    // ⛔ Hårdkodad med flit, INTE en env-variabel: token är publik per design (den
    // står i sidkällan på varje sidvisning) och en env-variabel som glöms vid en
    // miljöflytt hade avverifierat sajten utan ett enda felmeddelande.
    verification: {
      google: "-lgTBlCJrAGz6O9Ox4rgpkIQSxNxIhcQUa67BibM4yg",
    },
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
        {/* Ingen web-laddningsskärm: laddnings-UI:t (Stitch "Foilio - Loading") bor
            i den NATIVE splashen (assets/splash.png + turkos native-spinner, se
            capacitor.config.ts) som täcker HELA app-starten tills webben är redo.
            AppBoot döljer splashen då. Webben har ingen laddningsskärm alls. */}
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
            <AppResumeRefresh />
            <OfflineBanner />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
