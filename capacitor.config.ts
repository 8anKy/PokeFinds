import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor-konfiguration för Foilio iOS/Android-app.
 *
 * Foilio är en fullstack-Next.js-app (server-komponenter, API-routes, NextAuth,
 * Prisma/Postgres) → den kan INTE exporteras statiskt. Den native appen är därför
 * ett tunt Capacitor-skal som laddar den HOSTADE webbappen via `server.url`
 * (ingen UI-omskrivning — samma app i App Store / Google Play som på webben).
 *
 * Sätt `CAP_SERVER_URL` till din produktions-URL vid bygge, t.ex.:
 *   CAP_SERVER_URL=https://pokefinds.vercel.app npx cap sync
 * Saknas den laddas det lokala offline-skalet (mobile-shell/index.html) som ber
 * dig sätta URL:en. Se docs/MOBILE.md.
 */
const SERVER_URL = process.env.CAP_SERVER_URL?.trim() || "https://www.foilio.se";

const config: CapacitorConfig = {
  // ponytail: android/ är fortfarande genererat med gamla se.pokefinds.app —
  // regenerera (radera android/ + `npx cap add android`) före Android-launch.
  appId: "se.foilio.app",
  appName: "Foilio",
  webDir: "mobile-shell",
  backgroundColor: "#0a0a0c",
  server: SERVER_URL
    ? {
        // Ladda den hostade appen direkt i WebView:en.
        url: SERVER_URL,
        cleartext: false,
        androidScheme: "https",
      }
    : { androidScheme: "https" },
  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0c",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0a0a0c",
  },
  plugins: {
    // resize: none → WebView:en ändrar INTE storlek när tangentbordet öppnas, så
    // position:fixed (bottom-tabs) hoppar inte. Tangentbordet läggs ovanpå i stället.
    Keyboard: { resize: "none" },
  },
};

export default config;
