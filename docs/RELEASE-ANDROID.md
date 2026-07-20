# Android-release (Google Play)

> Skapad 2026-07-20 i samband med Capacitor 8-migreringen (targetSdk 36).
> iOS byggs av Codemagic (`codemagic.yaml`) — den här filen gäller BARA Android.

## Engångssetup (ägaren)

### 1. Skapa upload-keystore (EN gång — förvara säkert, utanför repot)
```powershell
& "D:\Emulator\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore $env:USERPROFILE\foilio-upload.jks `
  -alias foilio -keyalg RSA -keysize 2048 -validity 10000
```
Välj ett starkt lösenord. **Förlorar du filen/lösenordet kan Play App Signing
rädda dig (Google håller app-signeringsnyckeln), men spara ändå en kopia
på säkert ställe (inte i molnet okrypterat, ALDRIG i repot).**

### 2. Skapa `android/keystore.properties` (gitignorad — hamnar aldrig i repot)
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

# 2. Synka webbkonfig → android (glöm inte efter capacitor.config.ts-ändringar)
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
- **versionCode** bumpas manuellt — Play avvisar återanvända nummer.
- **Push på Android är avstängd med flit** (ingen FCM/google-services.json än);
  se memory `project_android_push_followup` innan den slås på.
- targetSdk 36 (Android 16) sedan Capacitor 8-migreringen — uppfyller Plays
  krav för nya appar även efter aug 2026.
- RevenueCat: Play-produkterna måste finnas i RevenueCat-dashboarden innan
  köp funkar i Android-appen.
