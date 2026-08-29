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
const SERVER_URL = process.env.CAP_SERVER_URL?.trim() || "https://foilio.se";

const config: CapacitorConfig = {
  // android/ har applicationId se.foilio.app (build.gradle); intern namespace är
  // kvar som se.pokefinds.app med flit — osynligt för användare, se build.gradle.
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
        // Håll BÅDA foilio-värdarna (apex + www) inne i WebView:en — annars öppnar
        // Capacitor en navigering till "fel" värd i Safari (t.ex. en redirect till
        // apex medan appen kör på www). Butikslänkar är INTE med → de öppnar externt.
        // api.tradera.com: Tradera-kontokopplingens hela inloggnings-omväg (token-login
        // → accept → tillbaka till foilio.se) måste stanna i WebView:en, annars öppnar
        // det i system-Safari (en HELT separat cookie-jar) → skey-cookien tappas och
        // /installningar visas med Safaris egen (ev. andra) inloggade session.
        // discord.com: samma sak för Discord-OAuth:en (connect → authorize → callback).
        // Utan den öppnade authorize-sidan i Safari, där Foilio-sessionen inte finns →
        // callbacken svarade "fel-ingen-session" och användaren dumpades på webbens
        // inloggning. I WebView:en delar hela kedjan cookie-jar, och Discord-inloggningen
        // görs EN gång (WKWebView:s cookies överlever appomstarter). Det finns ingen
        // "logga in via Discord-appen"-väg att erbjuda i stället: Discords OAuth är
        // alltid deras webbsida, per deras egen design.
        // appleid.apple.com: Apple-inloggningen på ANDROID kör Apples webbflöde i
        // WebView:en (Apple tillåter WebViews; iOS använder det nativa SDK:t via
        // SocialLogin-pluginet nedan). Google står INTE här med flit — Google
        // blockerar sitt webbflöde i WebViews, appen kör alltid nativt för Google.
        allowNavigation: [
          "foilio.se",
          "www.foilio.se",
          "api.tradera.com",
          "discord.com",
          "appleid.apple.com",
        ],
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
    // Google-/Apple-inloggning i appen (lib/social-login.ts). Bara de två
    // providrarna buntas — facebook/twitter hade dragit in deras SDK:er i binären.
    // ⛔ Ändring här kräver `npx cap sync` + nytt nativt bygge.
    SocialLogin: {
      providers: { google: true, apple: true, facebook: false, twitter: false },
      logLevel: 1,
    },
    // resize: none → WebView:en ändrar INTE storlek när tangentbordet öppnas, så
    // position:fixed (bottom-tabs) hoppar inte. Tangentbordet läggs ovanpå i stället.
    Keyboard: { resize: "none" },
    // Splash-skärm (#21, ägarens Stitch-laddningsdesign): appen laddar den HOSTADE
    // webbappen över nätet i WebView:en → mellan native-start och att webben renderat
    // var det tidigare en SVART skärm (nätverks-/hydreringsgapet). launchAutoHide:false
    // håller splashen uppe tills webben är redo och själv anropar SplashScreen.hide()
    // (AppBoot) → inget svart gap. Splash-bilden (assets/splash.png) = "Foilio"-ordmärke
    // ovanför mitten på mörk yta; den animerade native-spinnern (turkos) renderas
    // centrerad → hamnar UNDER ordmärket = Stitch-laddningsskärmen, native (en statisk
    // splash-bild kan inte själv animera). backgroundColor matchar appen så kanterna
    // inte blinkar.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0a0a0c",
      androidScaleType: "CENTER_CROP",
      showSpinner: true,
      spinnerColor: "#2dd4bf",
      iosSpinnerStyle: "large",
      androidSpinnerStyle: "large",
      launchFadeOutDuration: 250,
    },
  },
};

export default config;
