---
paths:
  - "src/middleware.ts"
  - "src/lib/session-cookie.ts"
  - "src/lib/signup-code.ts"
  - "src/lib/email-typo.ts"
  - "src/lib/mail-status.ts"
  - "src/app/api/auth/**"
  - "src/app/(auth)/**"
  - "src/components/features/email-typo-hint.tsx"
  - "scripts/signup-verification-report.ts"
---
# Auth, session och registrering

- **REGISTRERING KRÄVER MEJLAD KOD — KONTOT FÖDS VERIFIERAT (2026-08-12)**: tvåstegad registrering.
  `/api/auth/register/send-code` mejlar en 6-siffrig kod (hashad rad i `SignupVerification`, TTL 15 min,
  5 gissningar sedan låst, per-IP + per-adress-spärr, skicka-först-spara-sedan) och `/api/auth/register`
  kräver koden → `emailVerifiedAt` sätts vid skapandet. Ren dom = `src/lib/signup-code.ts` (testad utan DB).
  Inbjudningar krediteras DIREKT i register-routen (`creditInviteOnVerify`) — nya konton når aldrig
  `/api/auth/verify`. ⛔ LÄNK-FLÖDET (`verificationToken`/`/verifiera`/resend-verification) finns
  kvar ENBART för gamla konton och får inte rivas: två konton (inkl. ägarens SUPERADMIN) lever på tokens
  utan utgångstid. ⛔ `templates.ts` får INTE importera signup-code (drar in Node-crypto i edge-bundlen via
  instrumentation → scheduler → notifications) — TTL:en skickas in som parameter. E2E kan inte läsa inkorgen,
  så auth.spec verifierar att kodsteget NÅS; själva skapandet täcks av enhetstester + smoke-test.
  **UPPTAGET NAMN/ADRESS FÄLLS VID "SKICKA KOD", INTE EFTER KODEN (2026-08-12)**: send-code gör samma
  namn-/adresskollar som /register och svarar 409 med `field: "name"|"email"` så klienten fäster felet vid
  rätt fält — ägaren fick annars "namnet upptaget" först i kodsteget. Kollarna ligger FÖRE per-adress-
  spärren (3 utskick/h) så en namnrättelse aldrig bränner utskicksbudgeten; /register behåller sina kollar
  som facit (racet namn-tas-mellan-stegen skickar tillbaka till fältet, koden överlever rättelsen).
  **VerifyEmailBanner BORTTAGEN (ägarbeslut 2026-08-12)**: nya konton föds verifierade, så bannern kunde
  bara nå de två legacy-kontona — deras väg är /verifiera:s resend-formulär (endpointen lever kvar).
  **EN FELTYPAD ADRESS ÄR EN ÅTERVÄNDSGRÄND — DÄRFÖR TYPO-FÖRSLAGET (2026-08-15)**: en registrering gick
  förlorad på `@email.com` (studs i Resend, mejlet nådde ingen, personen försökte aldrig igen). Kontot
  skapas först NÄR koden anges, så det fanns varken ett konto att laga eller en fungerande adress att nå
  personen på — enda botemedlet är att fånga typon FÖRE utskicket. `suggestEmailCorrection`
  (`src/lib/email-typo.ts`, Damerau-Levenshtein mot en kort lista kända domäner) visar "Menade du …?" som
  en KNAPP under fältet. ⛔ Den blockerar aldrig mer än EN gång: visas förslaget redan när "Skicka kod"
  trycks skickas adressen som den är — en ovanlig domän måste alltid gå att registrera. ⛔ `email.com` och
  `mail.com` står MED FLIT INTE i domänlistan (riktiga domäner, men i svensk trafik är gmail-typon långt
  vanligare och ett onödigt förslag kostar inget); Microsofts regionala domäner (hotmail.fr/.co.uk,
  outlook.dk …) står DÄR just för att de annars fått ett falskt förslag. ⛔ Oavgjort mellan två kandidater
  ⇒ inget förslag — ett myntkast i gränssnittet läser som ett påstående. Lokaldelen rörs aldrig (går inte
  att gissa), så kodsteget visar numera adressen i full kontrast med "Fel adress?" BREDVID sig i stället
  för en nedtonad "Ändra uppgifter" i sidfoten.
  **STUDS-DETEKTERING (2026-08-15, andra halvan)**: `sendMail` returnerar numera Resends meddelande-id,
  send-code skickar det till KLIENTEN, och kodsteget frågar `/api/auth/register/mail-status?id=…` vid
  8/20/45 s. `last_event: bounced|failed|suppressed` ⇒ röd ruta "Mejlet kom aldrig fram" + knapp till
  fältet. Det är den enda mekanism som fångar ett fel i adressens LOKALDEL.
  ⛔ **INGEN DB, INGEN MIGRATION, INGEN WEBHOOK.** Id:t bärs av klienten (det gavs till just den
  besökaren) ⇒ pollningen är ren HTTP mot Resend och väcker aldrig Neon, som debiteras per VAKEN TID.
  En kolumn på `SignupVerification` hade kostat en läsning per kontroll; en webhook hade dessutom krävt
  signaturverifiering och en publik skrivväg. Samma doktrin som restock-lanens källcache.
  ⛔ **`delivery_delayed` ÄR INTE EN STUDS** — Resend definierar det som ett TILLFÄLLIGT fel hos
  mottagarens server. Läses det som terminalt skickas någon som strax får sin kod tillbaka till
  formuläret. ⛔ **`complained` BETYDER ATT MEJLET KOM FRAM** (spamanmälan sker efter leverans) — koden
  ligger i skräpposten, och "adressen gick inte att nå" vore fel besked. ⛔ **Allt okänt är `pending`**:
  nya Resend-händelser, 404/429 från API:t, saknad nyckel i konsolläge. Ett falskt studsbesked avbryter
  en registrering som var på väg att lyckas. Domen är en ren funktion i `src/lib/mail-status.ts`, testad
  utan nätverk. ⚠️ Utan `RESEND_API_KEY` (dev/konsolläge) finns inget id ⇒ ingen pollning alls.
  **TYPO-FÖRSLAGET SITTER PÅ ALLA FYRA E-POSTFÄLT (2026-08-15)**: registrering, inloggning, glömt
  lösenord och begär-ny-länk delar `useEmailTypoHint` + `<EmailTypoHint>`
  (`src/components/features/email-typo-hint.tsx`) och nyckeln `Auth.didYouMean`. EN implementation —
  fyra kopior hade drivit isär vid nästa domän som läggs till.
  ⛔ **STUDS-DETEKTERING GÅR INTE ATT ÅTERANVÄNDA PÅ /glomt-losenord ELLER /verifiera.** Båda svarar
  MED FLIT likadant oavsett om kontot finns ("Om kontot finns skickar vi en återställningslänk") för
  att adresser inte ska gå att kartlägga. Ett `mailId` i svaret hade avslöjat att ett mejl FAKTISKT
  skickades, dvs. att kontot existerar — kartläggningsorakel. Typo-förslaget är därför enda varningen
  där, och det är också där det behövs mest: en felstavad adress matchar inget konto, så inget mejl
  skickas över huvud taget och användaren väntar för alltid på en länk som aldrig fanns.
  ⚠️ Inloggningen bromsar inte vid submit (ett misslyckat försök är omedelbart synligt); bara
  registreringen gör det, eftersom ett utskick till fel adress är svårt att ta tillbaka.
  **VÄNTRUMMET GALLRAS NATTLIGEN (2026-08-15)**: `SignupVerification`-raden raderas annars BARA vid
  lyckad registrering, så varje avbruten/utgången/studsad registrering lämnade en e-postadress i
  tabellen för alltid. `scripts/signup-verification-report.ts` (steg i scrape-all, `--apply`) städar
  rader som gått ut för mer än `GRACE_HOURS` (24) sedan. ⛔ **RAPPORTEN SKRIVS FÖRE RADERINGEN** —
  raderna är det ENDA spåret av misslyckade registreringar (ingen analytics, ingen adminvy), så
  fördelningen loggas varje natt även när raderna försvinner. ⛔ En rad vars adress redan är ett konto
  är INGEN avhoppare: raderingen i register-routen är nycklad på adressen som faktiskt användes, så
  den som rättade en felstavning lämnar kvar väntrumsraden för den gamla. Räknas den som "gav upp"
  blir tratten fel. ⛔ Karensen finns för MÄNNISKAN, inte för koden (som lever 15 min): den som skrev
  fel adress ska hinna komma tillbaka nästa morgon. Mätt 2026-08-15 före första körningen: 6 rader
  totalt, 2 städbara — problemet var principiellt, aldrig volymmässigt.
- **`fo_auth`-HINTEN MÅSTE SÄTTAS AV SERVERN (2026-08-06)**: inloggningen bärs av TVÅ cookies — NextAuths
  session (server-satt, HttpOnly, 30 dygn) och `fo_auth`, UI-hinten som klient-chrome läser i stället för att
  anropa `/api/auth/session`. Hinten skrevs av KLIENTEN med `document.cookie` och samma 30 dygn. ⛔ **WebKit kapar
  sedan Safari 13.1 ALLA cookies skapade via `document.cookie` till 7 dygn** — iPhone-Safari, Chrome på iOS OCH
  Capacitor-appen (allt är WKWebView); server-satta first-party-cookies kapas INTE. Och hinten är inte kosmetisk:
  `AuthHintGate` gör `router.replace("/logga-in")` när den saknas. Följden var att varje iOS-användare kastades ut
  ur appen senast var sjunde dygn med en fullt giltig session, aldrig på desktop-Chrome — därför läste det som
  slumpmässigt. `syncAuthHint()` i `src/middleware.ts` jämför nu hinten mot sessionscookiens NÄRVARO vid varje
  sidladdning och rättar den med `Set-Cookie` från servern (beslutet är en ren funktion i `src/lib/session-cookie.ts`).
  ⛔ JWT:n verifieras INTE där — hinten är en gissning servern ändå överprövar, och en HMAC per publik sidvisning
  vore att betala krypto för ett UI-tips. ⛔ Chunkade namn (`…session-token.0`) måste räknas med: en JWT > 4 kB har
  inget oindexerat namn alls, och synken hade rensat hinten för en inloggad.
  **Generellt: en cookie som JS skriver har inte den livslängd du anger.**
- **SESSIONEN ÄR GLIDANDE — `maxAge` ÄR ETT INAKTIVITETSFÖNSTER (2026-08-06)**: `session.maxAge` var 30 dygn och
  ingenting förnyade cookien, så ALLA loggades ut exakt 30 dygn efter login oavsett hur aktiva de var. NextAuth v4
  förnyar när sessionen LÄSES, men `getServerSession` får ingen `res` i App Router och kan inte sätta cookies — och
  appen anropar aldrig `/api/auth/session` (hela poängen med `fo_auth`). Det var andra halvan av "helt plötsligt
  utloggad": WebKit-kapen tog iOS var sjunde dygn, det här tog alla var trettionde. `renewSession()` i
  `src/middleware.ts` skriver nu om cookien med färsk utgång, utan en enda DB-fråga. Talet
  (`SESSION_MAX_AGE` = 365 dygn) bor i `src/lib/session-cookie.ts` och används av BÅDE `authOptions` och
  middleware — förnyelsen måste skriva samma livslängd som NextAuth utfärdade. ⛔ Ett år, inte "för alltid": en
  JWT-session går inte att återkalla (ingen sessionstabell att radera ur), så en stulen cookie lever tills den går
  ut. ⛔ Förnyas ÄVEN på publika sidor (annars loggas den som mest bläddrar i katalogen ut trots daglig
  användning), men `getToken` körs BARA när en sessionscookie finns → utloggade besökare och crawlers kostar noll
  krypto, och skrivningen sker högst var 24:e timme (`SESSION_RENEW_AFTER`). ⛔ Chunkade cookies (`…token.0`) rörs
  inte: en tillbakaskriven ensam cookie hade lämnat gamla chunkar kvar och två källor hade konkurrerat om samma
  session. ⛔ Ett fel i förnyelsen SVÄLJS — den gamla cookien är giltig, och att kasta hade gett 500 på varje sida
  för alla inloggade. Enhetstestet kör riktiga `encode`/`decode` och vaktar att nyttolasten
  (`id`/`role`/`planTier`/`refreshedAt`) överlever; tappades den hade varje inloggad förlorat sin roll efter ett
  dygn, tyst och bara i produktion.
