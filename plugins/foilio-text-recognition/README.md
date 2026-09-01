# foilio-text-recognition

Lokal Capacitor-plugin: on-device textigenkänning på **iOS** via Apple Vision
(`VNRecognizeTextRequest`). Ren SPM, inga externa paket, ingen binärtillväxt.

**Varför den finns**: `@capacitor-mlkit/text-recognition` är CocoaPods-only på iOS
(Googles ML Kit saknar SPM) och `ios/App` genereras som SPM-projekt av `cap add ios`
i Codemagic. Android kör ML Kit-pluginet; JS-kontraktet delas i
`src/lib/on-device-number.ts`.

**Installation**: `"foilio-text-recognition": "file:plugins/foilio-text-recognition"` i
rotens `package.json`. `npm ci` symlänkar den till `node_modules`, och `cap sync`/`cap add ios`
hittar `Package.swift` och lägger paketet i `CapApp-SPM`.

**API**: `FoilioTextRecognition.recognize({ base64, languages? }) → { text, lines }`.

**Ingen byggkedja**: `dist/` är handskriven (tre små filer) — det finns inget att kompilera på
JS-sidan. Swift-filen kompileras första gången i Codemagic; håll den minimal.
