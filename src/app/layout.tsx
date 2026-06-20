import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
import { Providers } from "@/components/providers";
import { CookieBanner } from "@/components/features/cookie-banner";
import { ServiceWorkerRegister } from "@/components/pwa-register";
import { BottomTabs } from "@/components/layout/bottom-tabs";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Foilio — Din kontrollpanel för Pokémon TCG-marknaden",
    template: "%s | Foilio",
  },
  description:
    "Bevaka priser, lagerstatus och värdet på din samling. Foilio samlar prisdata, restock-alerts och marknadstrender för Pokémon TCG i Sverige.",
  openGraph: {
    type: "website",
    locale: "sv_SE",
    siteName: "Foilio",
    title: "Foilio — Din kontrollpanel för Pokémon TCG-marknaden",
    description:
      "Bevaka priser, lagerstatus och värdet på din samling. Håll koll på marknaden innan alla andra.",
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

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" className={`dark ${inter.variable}`}>
      <body>
        <Providers>
          {children}
          <BottomTabs />
          <CookieBanner />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
