# Google Play – butikssida, Data safety och första uppladdning

> Skapad 2026-09-05. Bygget beskrivs i `docs/RELEASE-ANDROID.md`; den här filen är allt som
> fylls i **i Play Console**. Copyn nedan speglar `/priser` (messages/sv.json → `Pricing`) och
> UTELÄMNAR restock- och prislarmen med flit — båda är pausade (se CLAUDE.md). Lägg tillbaka
> dem här FÖRST när flaggorna slås på, annars säljer butikssidan en funktion som inte går.

## App-uppgifter
| Fält | Värde |
|---|---|
| Appnamn | Foilio |
| Paketnamn | `se.foilio.app` (låst efter första uppladdningen) |
| Standardspråk | Svenska (sv-SE); engelsk översättning valfri (appen har EN-läge) |
| App eller spel | App |
| Gratis/betald | Gratis, **med köp i appen** (prenumeration "Foilio Pro", 49 kr/mån) |
| Kategori | Verktyg (alt. Shopping) |
| E-post för kontakt | samma som `LEGAL_ENTITY_EMAIL` |
| Webbplats | https://foilio.se |
| Integritetspolicy | https://foilio.se/integritetspolicy |

## Kort beskrivning (max 80 tecken)
```
Priser, samlingsvärde och kortskanner för Pokémon TCG-samlare i Sverige.
```

## Fullständig beskrivning (max 4 000 tecken)
```
Foilio är appen för svenska Pokémon TCG-samlare. Se vad dina kort är värda, jämför priser hos svenska butiker och håll koll på hela samlingen – på ett ställe, i kronor.

PRISER SOM STÄMMER
• Lägsta pris hos över 40 svenska butiker, med direktlänk till produkten
• Marknadspris för över 25 000 singlar och sealed-produkter, engelska och japanska
• Prisgrafer och historik – se hur värdet rört sig över tid
• Vad kort faktiskt sålts för på Tradera, med graderade kort som egen serie

DIN SAMLING, DITT VÄRDE
• Lägg till kort och sealed – portföljen räknar om värdet varje dag
• Set-komplettering: se exakt vilka kort som saknas i varje set
• Bevakningslista för det du jagar

SKANNA KORT MED KAMERAN
• Rikta kameran mot ett kort – Foilio känner igen det och visar priset direkt
• 10 gratis skanningar utan konto, 30 per månad med konto
• AI-gradering: få en bedömning av skicket innan du skickar in kortet

FYND OCH MARKNAD
• Största rörelserna just nu, trendande kort och veckans fynd
• Veckobrev med samlingens utveckling

FOILIO PRO
Obegränsade bevakningar, obegränsad kortskanning, bulkskanning av hela rader, 15 AI-graderingar per månad med starkare modell, Tradera-priser i grafen och längre prishistorik. Prenumerationen kostar 49 kr per månad, förnyas automatiskt och kan avslutas när som helst i Google Play.

Foilio är byggt i Sverige, för svenska samlare. Priserna kommer från verifierade källor och visas alltid i kronor – ingen växelkursgissning, inga påhittade siffror.

Villkor: https://foilio.se/villkor
Integritetspolicy: https://foilio.se/integritetspolicy
```

## Grafik
| Tillgång | Krav | Fil |
|---|---|---|
| Appikon | 512×512 PNG, 32-bit, ≤ 1 MB | `assets/play/icon-512.png` |
| Funktionsgrafik | 1024×500 PNG/JPG | `assets/play/feature-graphic.png` |
| Telefonskärmbilder | 2–8 st, 16:9 eller 9:16, min 320 px, max 3 840 px | tas i emulatorn (Pixel 9, 1080×2424): `adb exec-out screencap -p > shot.png` — startsidan, en produktsida med prisgraf, skannern, portföljen, ett set med komplettering |

Skärmbilder: inga statusfält med privat info, inga konkurrentnamn, ingen restock-copy.

## Data safety (dataskyddsformuläret)
Svaren nedan beskriver appen som den är byggd. **Verifiera markerade rader mot koden innan
du skickar in** — ett felaktigt formulär är en policyöverträdelse, inte ett stavfel.

**Samlar appen in eller delar användardata?** Ja.
**Krypteras data under överföring?** Ja (enbart https).
**Kan användaren begära radering?** Ja — Inställningar → Radera konto (`DELETE /api/users/me`),
samt export. Ange https://foilio.se/installningar som väg.

| Datatyp | Samlas in | Delas | Syfte | Obligatoriskt |
|---|---|---|---|---|
| E-postadress | Ja | Nej | Kontohantering, veckobrev (avanmälan finns) | Ja för konto; nej som gäst |
| Namn (visningsnamn) | Ja | Nej | Kontohantering, community | Ja för konto |
| Användar-ID | Ja | Ja — till RevenueCat (köp) och Stripe (webbköp) | Kontohantering, köp | Ja för konto |
| Foton | Ja | Ja — bilden skickas till AI-leverantör (Google Gemini) för igenkänning/gradering | Appfunktion (skanner, gradering) | Nej — bara när användaren skannar |
| Köphistorik | Ja | Ja — RevenueCat | Kontohantering, betalning | Nej |
| Enhets-ID (ANDROID_ID) | Ja | Nej | Gästkvot för skannern (`x-foilio-device`) | Ja för gästskanning |
| Appinteraktioner | Ja (anonymt, utan användar-ID) | Nej | Analys | — |
| Användargenererat innehåll (foruminlägg, meddelanden, bilder) | Ja | Nej | Appfunktion (community) | Nej |
| Ungefärlig plats | Nej | — | — | — |
| Kontakter, kalender, SMS, filer | Nej | — | — | — |
| Krasch-/diagnostikloggar | Nej (ingen Crashlytics/Sentry) | — | — | — |

⚠️ **Verifiera**: (1) att skannerbilder inte lagras efter svaret (ScannerJob) — annars är
"Foton" också "lagrad" data; (2) att `AnalyticsEvent` fortfarande saknar `userId` (CLAUDE.md
säger det, formuläret bygger på det); (3) Tradera/Discord-kopplingen — kopplar användaren sitt
konto delas ett ID med den tjänsten; det står inte i integritetspolicyn i dag (öppet ärende).

**Annonser**: Nej. **Spårnings-SDK:er**: inga. **Konto krävs**: nej (gäst kan bläddra + 10 skanningar).

## Innehållsklassificering (IARC)
Verktygs-/handelsapp; ingen våld/sex/droger; **användargenererat innehåll: Ja** (forum +
meddelanden) med moderering (rapportera, ordfilter, blockera). Landar på "Alla"/PEGI 3.
Om community v2 inte ska vara påslagen på Android: svara Nej på UGC (se nedan).

## Övriga deklarationer i Play Console
- **Målgrupp**: 13+ (villkoren kräver 13 år). Kryssa INTE "riktar sig till barn".
- **Nyhets-app**: Nej. **Covid-app**: Nej. **Finansiella funktioner**: Nej (vi förmedlar inga
  betalningar mellan användare — Foilio är aldrig part i en affär).
- **Hälsoappar**: Nej. **Statlig app**: Nej.
- **Kontoradering**: URL https://foilio.se/installningar + "i appen". Kräver att sidan
  faktiskt går att nå utloggad med instruktion — Play kontrollerar länken manuellt.
- **Behörigheter**: `CAMERA` (skanner) — begärs i runtime av WebView:en. `INTERNET`. Inget annat.
- **Annons-ID**: appen använder INTE annons-ID → svara Nej (annars kräver Play en deklaration).

## Köp i appen (kopplat till RevenueCat)
1. Play Console → Intäktsgenerera → Prenumerationer → skapa `foilio_pro_monthly`
   (basplan `monthly`, 49,00 kr, auto-förnyande, ingen provperiod).
2. RevenueCat → Project → Apps → **+ Google Play** (paketnamn `se.foilio.app`, ladda upp
   service-account-JSON från Google Cloud med Play-behörighet), lägg produkten i entitlementet
   `premium` och offeringen `default` som `$rc_monthly`.
3. Kopiera Play-appens **publika API-nyckel** (`goog_…`) → Railway `NEXT_PUBLIC_RC_ANDROID_KEY`
   → **ny deploy** (bakas in vid bygget). Utan nyckeln visar `/priser` i appen "Kommer snart"
   (`storeShellWithoutPurchases()`, `lib/purchases.ts`) — ⛔ aldrig Stripe: Play förbjuder egen
   checkout för digitala varor i appen och avvisar bygget.
4. Play-webhooken ("Real-time developer notifications") pekas på RevenueCat, inte på oss —
   vår webhook `/api/webhooks/revenuecat` tar redan emot bådas events.
⛔ Prenumerationen måste vara **aktiv i Play Console** innan testköp går; testare läggs till
under Inställningar → Licenstestning så köpen inte debiteras.

## Google-inloggning i release-bygget
Android-OAuth-klienten i Google Cloud är registrerad med DEBUG-keystorens SHA-1. Efter första
uppladdningen: Play Console → **Testa och släpp → App-integritet → App-signering** → kopiera
SHA-1 för **app-signeringsnyckeln** (inte upload-nyckeln — Play signerar om AAB:en) → Google
Cloud → Credentials → **skapa en ny Android-klient** med paketnamn `se.foilio.app` + den SHA-1:n.
Ingen kodändring: appen skickar `webClientId` och Google matchar paket + signatur på enheten.
Utan detta: `[28444] Developer console is not set up correctly` vid Google-inloggning i
Play-bygget, medan debug-bygget funkar. Testa i Intern testning INNAN produktion.

## Community v2 på Android — ett beslut, inte en detalj
Android-bygget bär `FoilioApp/1.2` i user-agenten (`capacitor.config.ts`, `MARKETING_VERSION`).
Servern släpper in forum + meddelanden + Tradera-på-profilen för **alla** native-byggen ≥ 1.2
(`lib/community-v2-gate.ts`). Att släppa Android i produktion är alltså att lansera community
v2 för Android-användare, före iOS 1.2 och före `COMMUNITY_V2_PUBLIC=1`. Tre vägar:
1. **Acceptera** — då gäller lanseringslistan i CLAUDE.md: Discord-kanal + `DISCORD_MARKET_CHANNEL_ID`.
2. **Intern testning bara** tills iOS 1.2 släpps — då är det bara ägaren som ser det.
3. Bygga Android med `MARKETING_VERSION=1.1` — gömmer community men ljuger om versionen; undvik.

## Ordning för första släppet
1. `scripts/android-keystore-setup.ps1` (ägaren, egen PowerShell) → `android/keystore.properties`.
2. `$env:JAVA_HOME='D:\Emulator\jbr'; cd android; .\gradlew bundleRelease` →
   `android/app/build/outputs/bundle/release/app-release.aab` (signerad).
3. Play Console: skapa utvecklarkonto ($25, identitetsverifiering kan ta 1–3 dagar) → skapa app →
   fyll i allt ovan → **Intern testning** → ladda upp AAB → lägg till din Google-adress som testare
   → installera från länken.
4. Efter uppladdningen: App-signerings-SHA-1 → ny Android-OAuth-klient (ovan).
5. RevenueCat + `NEXT_PUBLIC_RC_ANDROID_KEY` → deploy.
6. Testa på riktig telefon: Google-inloggning, en skanning, en gradering, ett Pro-köp
   (licenstestare), avbryt prenumerationen i Play.
7. Produktion: samma AAB, "Granska och publicera". Första granskningen tar normalt 1–7 dagar;
   nya utvecklarkonton måste dessutom ha haft 12 testare i 14 dagar i **sluten** testning
   innan produktion låses upp (Plays krav för personliga konton sedan 2023 — gäller INTE
   organisationskonton).
