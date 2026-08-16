# Foilio som iOS- & Android-app (Capacitor)

Foilio paketeras som native-appar med **Capacitor**. Eftersom Foilio är en
fullstack-Next.js-app (server-komponenter, API-routes, NextAuth, Prisma/Postgres)
går den **inte** att exportera statiskt. Den native appen är därför ett tunt
**Capacitor-skal** som laddar den **hostade** webbappen i en WebView via
`server.url`. Samma app som på webben — ingen UI-omskrivning, inga två kodbaser.

> **Förutsättning:** Hosting måste vara live först (se `docs/HOSTING.md`). Du
> behöver en publik HTTPS-URL (i prod: `https://foilio.se` — apex, inte www) att
> peka appen mot.

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
Capacitor WebView ──► server.url = https://din-hostade-app  (Railway)
        │                         │
        │                         ▼
   native API:er            Next.js (SSR, API, auth, DB på Neon)
   (kamera, ev. push)
```

- `capacitor.config.ts` — appId `se.foilio.app`, appName `Foilio`,
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
   $env:CAP_SERVER_URL="https://foilio.se"; npm run cap:sync
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
Windows, så välj **A** eller **B**.

> **Rekommendation:** har du inte pålitlig Mac-åtkomst → kör **B (Codemagic)** som
> riktig pipeline. HELA kedjan (`cap add ios`, signering, bygge, TestFlight) går
> utan egen Mac: Codemagic sköter cert/profiler via en **App Store Connect API-
> nyckel** och bygger på `git push`. En Mac är bara *snabbare* för första
> interaktiva Xcode-körningen, aldrig ett krav. **IAP/premium kan dock bara testas
> på en riktig iPhone** (TestFlight-bygge + sandbox-testkonto) — ingen byggtjänst
> testar köp åt dig.

**A. På en Mac:**
```bash
npm install --legacy-peer-deps
npm run cap:add:ios                       # genererar ios/ (kör pod install)
export CAP_SERVER_URL="https://foilio.se"
npm run cap:sync
npm run cap:ios                           # öppnar Xcode
```
I Xcode: sätt Team (Apple Developer, $99/år), Bundle Id `se.foilio.app`, kör på
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

## Premium-betalning (In-App Purchase via RevenueCat)

Apple-riktlinje **3.1.1** kräver att digitala prenumerationer som säljs *inne i*
iOS-appen går via Apples In-App Purchase — egen checkout (Stripe m.m.) blir
avvisad. Samma på Android (Google Play Billing). Vi använder **RevenueCat** som
wrappar bådas StoreKit/Billing, validerar kvitton server-side och håller reda på
vem som är premium.

**Kod som redan finns (web-repot):**
| Fil | Roll |
| --- | --- |
| `src/lib/purchases.ts` | configure + köp + återställ. No-op på webben (bara native). |
| `src/app/(marketing)/priser/upgrade-button.tsx` | Köpknapp + "Återställ köp" i appen; oförändrat "Kommer snart" på webben. |
| `src/app/api/webhooks/revenuecat/route.ts` | RevenueCat-webhook → sätter `User.planTier`. |

**Viktigt — var nycklarna bor:** appen laddar JS från den **hostade** sajten
(Railway), inte från byggmaskinen. Därför ligger RevenueCat-nycklarna i **Railways**
env-variabler, inte i iOS-bygget:
- `NEXT_PUBLIC_RC_IOS_KEY`, `NEXT_PUBLIC_RC_ANDROID_KEY` (publika SDK-nycklar)
- `REVENUECAT_WEBHOOK_AUTH` (delad hemlighet = `Authorization`-header på webhooken)

Sätt dem i Railway → redeploya. iOS-/Android-bygget pekar bara på `foilio.se`.

**Setup-ordning (engång):**
1. RevenueCat-projekt (gratis): skapa entitlement `premium` + en *offering* med
   din 49 kr/mån-produkt. Kopiera iOS-/Android-API-nycklarna → Railway.
2. App Store Connect / Play Console: definiera prenumerationen (49 kr/mån) och en
   **sandbox-testanvändare**. Länka produkten till `premium`-entitlementet i RC.
3. RevenueCat → webhook-URL `https://foilio.se/api/webhooks/revenuecat`,
   `Authorization`-headern = ditt `REVENUECAT_WEBHOOK_AUTH`.
   ⛔ **APEX, aldrig `www`.** Cloudflare 301:ar www → apex, och RevenueCat följer inte
   redirects: webhooken slutar levereras TYST. Den äger `planTier` (`EXPIRATION` sätter
   FREE ovillkorligt), så utfallet är att app-köpares Pro fryser — samma tysta mekanism
   som dödade alla restock-larm i fyra dygn 2026-07-08. Gäller Stripe-webhooken likaså.
4. Xcode (på Mac) / Codemagic: lägg till **In-App Purchase**-capability i iOS-appen.
5. Testa köpet på en riktig iPhone via TestFlight, inloggad med sandbox-kontot.

Köpflöde: knapp → RevenueCat-köp → Apple/Google tar betalt → RC-webhook sätter
`planTier = PREMIUM` → appen laddas om och låser upp premium.

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

## Universella länkar (e-post → appen, inte Safari)

**Problemet:** push deep-länkar in i appen, men **e-post gör det inte** — och e-post
är kanalen de flesta faktiskt har. Ett restock-mejl som öppnas på en iPhone landar i
**Safari**, som har en **helt egen cookie-jar** (WKWebView:ens session delas inte).
Användaren möts därför ofta av en utloggad sajt i stället för produkten som pushen
kom ifrån.

**Lösningen** är universella länkar (iOS) / App Links (Android): en fil på
`https://foilio.se/.well-known/…` som talar om att appen äger domänen.

### iOS — läget just nu

| Del | Status |
| --- | --- |
| `public/.well-known/apple-app-site-association` | ✅ i repot (Team ID `F2XP44FF3B`, bundle `se.foilio.app`) |
| `application/json`-headern | ✅ regel i `next.config.mjs` |
| `associated-domains`-entitlementet i bygget | ⛔ **KVAR** (se nedan) |
| Associated Domains på App-id:t i Developer-portalen | ⛔ **KVAR** (ägaren) |

Filen ligger under `public/` och har **ingen filändelse** — det är Apples krav.
Två icke-uppenbara detaljer som annars biter tyst:

- **Content-Type måste vara `application/json`.** Utan filändelse gissar den
  statiska filhanteraren `application/octet-stream`, och Apple förkastar filen
  **tyst** — länkarna öppnar i Safari precis som förut. Därav headers-regeln i
  `next.config.mjs`.
- **Apple följer inte redirects för AASA-filen.** Den måste hämtas från **apex**
  (`https://foilio.se/...`). ⛔ Registrera aldrig `applinks:www.foilio.se` — Cloudflares
  301 www→apex ser konfigurerad ut men verifieras aldrig (samma mekanism som gör att
  Stripe-/RevenueCat-webhooks måste peka på apex).
- i18n-middlewaren rör inte sökvägen: matchern exkluderar allt som innehåller en punkt,
  och `.well-known` börjar med en. Ingen `/sv`-rewrite alltså.

**Det som återstår — och det kräver ett NYTT native-bygge.** `git push` räcker
**inte**: entitlementet sitter i binären, inte på webben.

1. **Apple Developer-portalen** (ägaren, engång): Identifiers → `se.foilio.app` →
   kryssa i **Associated Domains** → Save. Utan capability på App-id:t går profilen
   inte att signera med entitlementet.
2. **`codemagic.yaml`** — `ios/` är gitignorerad och genereras färskt av `cap add ios`
   vid varje bygge, så all iOS-konfiguration bor i codemagic.yaml. Utöka
   `App.entitlements`-heredocen i steget *Generera iOS-projektet* med
   associated-domains-nyckeln (samma fil som redan bär `aps-environment`):

   ```xml
   <key>com.apple.developer.associated-domains</key>
   <array>
     <string>applinks:foilio.se</string>
   </array>
   ```

   Lägg till en fail-loud-kontroll i samma stil som de befintliga:
   `grep -q applinks:foilio.se ios/App/App/App.entitlements`.
3. **Kör ett nytt Codemagic-bygge** → TestFlight → verifiera på en riktig iPhone.
   Installationen hämtar AASA-filen; ändringar i filen slår igenom först vid
   ominstallation eller när iOS uppdaterar den (kan dröja).

**Verifiera filen innan bygget:**

```bash
curl -sI https://foilio.se/.well-known/apple-app-site-association
# vill se: HTTP/2 200 + content-type: application/json  (ingen 301, ingen www)
```

### Android — INTE byggd, värdena saknas

`assetlinks.json` är **avsiktligt inte skapad**. En fil med platshållar-fingeravtryck
ser konfigurerad ut och fungerar aldrig — värre än ingen fil. Det som behövs:

| Värde | Var det hämtas |
| --- | --- |
| Paketnamn `se.foilio.app` | ✅ finns (`android/app/build.gradle`, `applicationId`) |
| SHA-256-fingeravtryck | ⛔ **saknas** — Play Console → Release → Setup → **App signing** → *SHA-256 certificate fingerprint*. Ta **appsignerings**nyckeln (Play App Signing), inte enbart uppladdningsnyckeln. Kör du interna byggen direkt från en .aab/.apk signerad med uppladdningsnyckeln: lägg in **båda** fingeravtrycken. |

När ägaren har fingeravtrycket:

1. Skapa `public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "se.foilio.app",
       "sha256_cert_fingerprints": ["<SHA-256 från Play Console>"]
     }
   }]
   ```
   (Filändelsen `.json` gör att Content-Type blir rätt av sig själv — ingen
   headers-regel behövs.)
2. Lägg ett `intent-filter` med `android:autoVerify="true"` för `https://foilio.se`
   på `MainActivity` i `android/app/src/main/AndroidManifest.xml`. Till skillnad från
   `ios/` **är** `android/` incheckad, så den ändringen ligger kvar i repot.
3. Nytt Android-bygge (`npm run cap:sync` + ny .aab). Även här: `git push` räcker inte.

## Konfiguration i korthet

| Sak | Var |
| --- | --- |
| Server-URL appen laddar | env `CAP_SERVER_URL` (vid `cap sync`/bygge) |
| App-id / namn | `capacitor.config.ts` (`se.foilio.app` / `Foilio`) |
| Android-behörigheter | `android/app/src/main/AndroidManifest.xml` |
| iOS-behörigheter | `ios/App/App/Info.plist` (på Mac) |
| iOS-entitlements/Plist i CI | `codemagic.yaml` (`ios/` genereras om vid varje bygge) |
| Universella länkar (iOS) | `public/.well-known/apple-app-site-association` + `next.config.mjs` |
| Offline-skal | `mobile-shell/index.html` |
