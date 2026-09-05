# Android-release (Google Play)

> Skapad 2026-07-20 i samband med Capacitor 8-migreringen (targetSdk 36).
> iOS byggs av Codemagic (`codemagic.yaml`) — den här filen gäller BARA Android.

> **Status 2026-09-05**: versionCode 2 / versionName 1.2, `cap sync` kört mot
> `https://foilio.se/produkter` med UA-taggen `FoilioApp/1.2`, och `bundleRelease` bygger
> felfritt (28,7 MB, OSIGNERAD tills keystoren finns). Allt som fylls i i Play Console —
> butikstext, Data safety, köp, Google-inloggningens SHA-1 — står i `docs/PLAY-LISTING.md`.

## Engångssetup (ägaren)

### 1+2. Keystore + `android/keystore.properties` — kör skriptet i EN EGEN PowerShell
```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-keystore-setup.ps1
```
Det frågar efter lösenordet interaktivt (hamnar aldrig i en kommandorad eller logg),
skapar `%USERPROFILE%\foilio-upload.jks` och skriver `android/keystore.properties`
(gitignorad — `.gitignore` rad 45–47 täcker även `*.jks`/`*.keystore`). Bara enkla
ASCII-tecken i lösenordet: Gradle läser filen som ISO-8859-1.
**Förlorar du filen/lösenordet kan Play App Signing rädda dig (Google håller
app-signeringsnyckeln), men spara ändå en kopia på säkert ställe (inte i molnet
okrypterat, ALDRIG i repot).**

Manuellt motsvarar det:
```powershell
& "D:\Emulator\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore $env:USERPROFILE\foilio-upload.jks -storetype PKCS12 `
  -alias foilio -keyalg RSA -keysize 2048 -validity 10000
```
```properties
storeFile=C:/Users/milos/foilio-upload.jks
storePassword=DITT_LOSENORD
keyAlias=foilio
keyPassword=DITT_LOSENORD
```
`app/build.gradle` läser filen om den finns; saknas den byggs release osignerad
(debug-byggen påverkas aldrig).

### 3. Google Play Console
- Skapa utvecklarkonto (engångsavgift $25) på https://play.google.com/console
- Skapa appen (Foilio, svenska, gratis med köp i appen)
- Aktivera **Play App Signing** (default vid första uppladdningen)

## Bygga en release (varje gång)

```powershell
# 1. Bumpa versionCode (MÅSTE öka för varje uppladdning) + versionName
#    i android/app/build.gradle (versionCode 1 → 2 → 3 …)

# 2. Synka webbkonfig → android (glöm inte efter capacitor.config.ts-ändringar).
#    Samma start-URL som iOS (codemagic.yaml) och samma UA-tagg som versionsnamnet —
#    taggen är det som släpper in bygget i community v2 (lib/community-v2-gate.ts).
$env:CAP_SERVER_URL = "https://foilio.se/produkter"
$env:MARKETING_VERSION = "1.2"
npx cap sync android

# 3. Bygg signerad AAB (Android Studios JDK: D:\Emulator\jbr)
$env:JAVA_HOME = "D:\Emulator\jbr"
cd android
.\gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Ladda upp AAB:en i Play Console → Produktion (eller Intern testning först —
rekommenderas: syns inom minuter, inga granskningskrav).

## Kom ihåg
- **versionCode** bumpas manuellt — Play avvisar återanvända nummer. Håll `versionName`
  = iOS `MARKETING_VERSION` = `MARKETING_VERSION` vid `cap sync` (tre ställen, ett tal).
- **Google-inloggning i Play-bygget kräver en ANDRA Android-OAuth-klient** med
  app-signeringsnyckelns SHA-1 (Play Console → App-integritet) — den befintliga är
  registrerad på debug-keystoren. Annars `[28444] Developer console is not set up
  correctly` bara i butiksbygget. Se `docs/PLAY-LISTING.md`.
- **Pro-köp**: `NEXT_PUBLIC_RC_ANDROID_KEY` i Railway + Play-app i RevenueCat. Saknas
  nyckeln visar `/priser` "Kommer snart" i appen (`storeShellWithoutPurchases()`) —
  ⛔ aldrig Stripe i skalet, Play avvisar egen checkout för digitala varor.
- **Community v2 syns för ALLA byggen ≥ 1.2** via UA-taggen — ett Android-släpp i
  produktion lanserar forumet på Android. Beslut + alternativ i `docs/PLAY-LISTING.md`.
- **Push på Android är avstängd med flit** (ingen FCM/google-services.json än);
  se memory `project_android_push_followup` innan den slås på.
- targetSdk 36 (Android 16) sedan Capacitor 8-migreringen — uppfyller Plays
  krav för nya appar även efter aug 2026.
- RevenueCat: Play-produkterna måste finnas i RevenueCat-dashboarden innan
  köp funkar i Android-appen.
