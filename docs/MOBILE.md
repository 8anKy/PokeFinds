# Foilio som iOS- & Android-app (Capacitor)

Foilio paketeras som native-appar med **Capacitor**. Eftersom Foilio är en
fullstack-Next.js-app (server-komponenter, API-routes, NextAuth, Prisma/Postgres)
går den **inte** att exportera statiskt. Den native appen är därför ett tunt
**Capacitor-skal** som laddar den **hostade** webbappen i en WebView via
`server.url`. Samma app som på webben — ingen UI-omskrivning, inga två kodbaser.

> **Förutsättning:** Hosting måste vara live först (se `docs/HOSTING.md`). Du
> behöver en publik HTTPS-URL (t.ex. `https://pokefinds.vercel.app`) att peka
> appen mot.

## ✨ Stor fördel: uppdateringar utan ny store-granskning

Eftersom appen laddar den hostade sajten ramar du in **webbdeployen**. Allt du
ändrar på webben (sidor, priser, funktioner, copy) syns direkt i appen vid nästa
öppning — **ingen ny App Store-/Play-inlämning behövs**. Du lämnar bara in en ny
binär när något **native** ändras (behörigheter, plugins, ikon, app-namn).

## Arkitektur

```
App Store / Google Play
        │  (native binär = tunt skal)
        ▼
Capacitor WebView ──► server.url = https://din-hostade-app  (Vercel)
        │                         │
        │                         ▼
   native API:er            Next.js (SSR, API, auth, DB på Neon)
   (kamera, ev. push)
```

- `capacitor.config.ts` — appId `se.pokefinds.app`, appName `Foilio`,
  `server.url` läses från env `CAP_SERVER_URL`.
- `mobile-shell/index.html` — offline-/fallback-skal (visas bara om ingen
  server-URL är satt eller appen är offline).
- `android/` — Android-projektet (incheckat; byggs i Android Studio).
- `ios/` — genereras på en Mac (se nedan).

## Engångsinstallation

```bash
npm install --legacy-peer-deps   # Capacitor-paketen ligger redan i package.json
```

## Android (kan byggas på Windows)

**Kräver:** [Android Studio](https://developer.android.com/studio) (ger Android
SDK + JDK).

1. Peka appen mot din hostade URL och synka:
   ```bash
   # PowerShell
   $env:CAP_SERVER_URL="https://pokefinds.vercel.app"; npm run cap:sync
   ```
   (Android-projektet `android/` finns redan — `cap:add:android` behövs inte igen.)
2. Öppna i Android Studio:
   ```bash
   npm run cap:android
   ```
3. Bygg/testa: välj en emulator eller ansluten telefon → **Run** ▶.
4. Release-binär för Google Play: **Build ▸ Generate Signed Bundle / APK ▸
   Android App Bundle (.aab)**, skapa en keystore (spara den säkert!), bygg.
5. Ladda upp `.aab` i [Google Play Console](https://play.google.com/console)
   (engångsavgift $25).

Kameran på `/skanna` använder `getUserMedia` i WebView:en — `CAMERA`-behörigheten
ligger redan i `AndroidManifest.xml`, så Android frågar användaren första gången.

## iOS (kräver Mac eller moln-Mac)

iOS-projekt kan bara genereras/byggas på macOS (Xcode + CocoaPods). Du är på
Windows, så välj **A** eller **B**:

**A. På en Mac:**
```bash
npm install --legacy-peer-deps
npm run cap:add:ios                       # genererar ios/ (kör pod install)
export CAP_SERVER_URL="https://pokefinds.vercel.app"
npm run cap:sync
npm run cap:ios                           # öppnar Xcode
```
I Xcode: sätt Team (Apple Developer, $99/år), Bundle Id `se.pokefinds.app`, kör på
simulator/enhet, **Product ▸ Archive** → ladda upp till App Store Connect.

Lägg till i `ios/App/App/Info.plist` (kamera-behörighet, annars kraschar skannern):
```xml
<key>NSCameraUsageDescription</key>
<string>Foilio använder kameran för att skanna och identifiera dina kort.</string>
```

**B. Utan egen Mac — moln-byggtjänst:** [Codemagic](https://codemagic.io),
[Ionic Appflow](https://ionic.io/appflow) eller [EAS-liknande Mac-CI](https://www.macincloud.com).
Anslut repot, sätt `CAP_SERVER_URL`, ladda upp dina Apple-signeringscertifikat,
låt molnet köra `cap add ios` + archive.

## Branded ikoner & splash (inför store-inlämning)

Capacitor genererar standardikoner. Byt mot Foilio-märket:
```bash
npm i -D @capacitor/assets
# lägg en 1024×1024 PNG i assets/icon.png (+ valfri assets/splash.png 2732×2732)
npx @capacitor/assets generate --iconBackgroundColor "#0a0a0c" --splashBackgroundColor "#0a0a0c"
npm run cap:sync
```
(Källa finns redan: `public/icon-512.png` / `public/icon.svg` — skala upp till 1024.)

## Store-godkännande (viktigt)

- **Apple-riktlinje 4.2** kan avvisa rena "webbsajt-i-skal"-appar. Foilio
  motiverar native-status via **kamera-skannern** och (rekommenderat) **push**.
  Inför inlämning: aktivera minst en tydlig native-funktion och beskriv den.
- **Native push (rekommenderad uppgradering):** webb-push fungerar i Android-
  WebView men är begränsad på iOS. För riktiga restock-/pris-aviseringar i appen,
  lägg till `@capacitor/push-notifications` (APNs/FCM) och registrera token mot
  Foilio notifikationssystem. Dokumenteras som nästa steg.
- **Konton/avgifter:** Apple Developer $99/år, Google Play $25 engång.

## Konfiguration i korthet

| Sak | Var |
| --- | --- |
| Server-URL appen laddar | env `CAP_SERVER_URL` (vid `cap sync`/bygge) |
| App-id / namn | `capacitor.config.ts` (`se.pokefinds.app` / `Foilio`) |
| Android-behörigheter | `android/app/src/main/AndroidManifest.xml` |
| iOS-behörigheter | `ios/App/App/Info.plist` (på Mac) |
| Offline-skal | `mobile-shell/index.html` |
