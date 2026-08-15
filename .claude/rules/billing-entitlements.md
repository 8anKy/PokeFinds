---
paths:
  - "src/lib/stripe.ts"
  - "src/lib/entitlements*"
  - "src/app/api/billing/**"
  - "src/app/api/webhooks/**"
  - "src/lib/discord*.ts"
  - "src/jobs/discord-*.ts"
  - "src/components/features/upgrade-button.tsx"
---
# Betalning, Pro-behörighet och Discord-roller

- **STRIPE SKRIVER ALDRIG `planTier` (2026-08-06)**: webbens Pro bor i EGNA kolumner
  (`stripeCustomerId`/`stripeSubscriptionId`/`stripeProUntil`) och blir en FJÄRDE gren i `isPro()` och
  `proUserWhere()` — exakt samma mönster som referral-bonusens `bonusProUntil`, av exakt samma skäl:
  `planTier` ägs av RevenueCat-webhooken, vars `EXPIRATION` sätter FREE OVILLKORLIGT. En utgången
  Apple-sandbox hade annars sagt upp en kund som betalar oss med kort — och det felet är tyst (2026-07-08
  tystade just den mekanismen alla restock-larm i fyra dygn). ⛔ **Glöms grenen i `proUserWhere()` får
  webbkunden Pro i gränssnittet men INGA larm**: mottagarfrågorna går enbart via det filtret. ⛔ Varje
  DB-`select` som matar `isPro()` måste välja `stripeProUntil` — ett ovalt fält blir `undefined` och vakten
  failar ÖPPET (samma familj som `variantLabel` 07-28). Rättade vid bygget: `users/me` (BÅDA selecten) och
  `installningar/page.tsx`. Sessionsvägen bär fältet genom JWT:n (authorize → jwt → session).
  ⛔ **`subscription.current_period_end` FINNS INTE** i den API-version SDK:n (v22) pinnar — fältet flyttade
  till `items.data[].current_period_end`. En läsning på toppnivån ger `undefined` ⇒ INGEN får någonsin Pro,
  tyst och bara i drift. Enda vägen är `subscriptionPeriodEnd()` i `src/lib/stripe.ts` (tar senaste posten,
  faller tillbaka på toppnivån för äldre versioner). Verifierat mot node_modules, vaktat av test.
  ⛔ **Webhooken litar aldrig på eventets objekt** — den hämtar prenumerationen FÄRSK. Stripe garanterar inte
  leveransordning, och ett försenat `updated` med gammal status hade sagt upp en aktiv kund. Ett absolut datum
  (inte en boolean) gör skrivningen idempotent och självläkande: missas uppsägningen löper Pro ut ändå.
  Nåd = `GRACE_DAYS` 3 — avvägningen är osymmetrisk (för kort = betalande kund tappar larm, för lång = en
  avhoppare behåller Pro några dygn). `past_due` behåller Pro: ett nekat kort är inte en uppsägning.
  ⛔ **Bara webben.** Apple förbjuder egen checkout för digitala varor i app:en; `purchasesAvailable()` i
  `upgrade-button.tsx` är gränsen, och checkout-routen blockerar dubbeldebitering (`planTier=PREMIUM` = köpt
  via Apple). Uppsägning sker där köpet gjordes — webbkunder får Stripes kundportal, app-kunder App Store.
  ⛔ Klienten måste kalla `session.update()` efter återkomsten från Checkout: jwt-callbacken läser annars om
  planen först efter `TOKEN_REFRESH_MS` (30 min) och en betalande kund väntar en halvtimme utan att något felar.
  Moms via Stripe Tax (`automatic_tax`), priset sätts inkl. moms. Plan/kvot-namnet `PREMIUM` är oförändrat.
- **DISCORD-ROLLEN FÖLJER `isPro()`, OCH AVSTÄMNINGEN ÄR INTE VALFRI (2026-08-07)**: användaren länkar sitt
  Discord-konto i /installningar, går med i servern (`guilds.join`) och får rollen `Verifierad`; har hen Pro
  sätts även `Pro`. EN definition av Pro — `isPro()` — aldrig en egen regel för Discord.
  ⛔ **SYNKEN SKER PÅ TRE STÄLLEN OCH ALLA TRE BEHÖVS**: (1) vid länkningen, (2) i Stripe- OCH
  RevenueCat-webhookarna, (3) i en NATTLIG avstämning (`src/jobs/discord-reconcile.ts`, körs sist i
  scrape-all). Punkt 3 är den som folk tar bort för att den ser redundant ut: `bonusProUntil` och
  `stripeProUntil` är DATUM som löper ut UTAN att någon webhook fyras — utan avstämningen sitter Pro-rollen
  kvar i evighet hos den som slutade betala. Den ligger i scrape-alls fönster (inte egen cron) för att Neon
  debiteras per VAKEN TID.
  ⛔ **VI RÖR BARA KONTON VI SJÄLVA LÄNKAT** (`User.discordUserId`), aldrig serverns medlemslista. Ägaren hade
  redan delat ut `Pro` för hand till 3 medlemmar; ett jobb som utgick från Discord-sidan hade strippat dem vid
  första körningen. Vi tar aldrig bort en roll vi inte satt, och vi KICKAR ALDRIG — frånkoppling och
  kontoradering tar bort rollerna, medlemskapet är personens eget.
  ⛔ **INGEN OAuth-TOKEN LAGRAS** (till skillnad från `traderaToken`): användartoken behövs EN gång för
  `guilds.join` och slängs; all rollhantering går via bot-token. Scopes är exakt `identify guilds.join` —
  INTE `email`, INTE `guilds` (den läser varje server personen är med i). Vaktat av
  `tests/unit/discord-link.test.ts`, som är en regressionsvakt mot scope-krypning: allt vi hämtar måste
  deklareras i integritetspolicyn.
  ⛔ **BOT- OCH OAuth-KONFIGURATIONEN ÄR SKILDA** (`discordBotConfig()` / `discordOAuthConfig()`): nattjobbet
  gör aldrig ett OAuth-utbyte och ska därför inte kräva client secret i GitHub Actions. Färre kopior av en
  hemlighet = färre ställen att glömma vid rotation (jfr APNs-nyckeln, som lever i tre filer).
  ⛔ **DISCORD-ROLLHIERARKIN**: botens egen roll måste ligga ÖVER `Pro`/`Verifierad` i serverns rollista,
  annars svarar Discord 403 och rollen sätts tyst aldrig. Och serverns ÄGARE kan sannolikt inte få roller av
  en bot alls — testa med ett andra konto, annars går det inte att skilja konfigfel från hierarki.
  ⛔ **`guilds.join` returnerar 204 (inte 201) när personen REDAN är medlem, och applicerar då INTE `roles`
  i kroppen** — rollerna måste alltid sättas separat efteråt.
  **GDPR**: `discordUserId`/`discordUsername`/`discordLinkedAt` är personuppgifter; exporten fick
  `connectedAccounts` (och `traderaUserId`, som SAKNATS i exporten sedan Tradera-kopplingen byggdes).
  Kontoradering tar bort rollerna FÖRE raderingen — efteråt finns ingen rad att läsa id:t ur, och en Pro-roll
  utan konto är just en sådan kvarleva art. 17 handlar om.
  ⚠️ **`DISCORD_ENABLED` ÄR PÅ (avläst 2026-08-14) — spaken finns kvar som nödstopp.** Utkast + de tre ANDRA
  odeklarerade leverantörerna (Stripe, Google/Gemini, Tradera) ligger i `../PokeFinds-private/docs/
  PRIVACY-DISCORD-DRAFT.md`. ⛔ Discord får INTE bara läggas i `Privacy.s7Items`: den listan påstår att varje
  post är ett personuppgiftsbiträde bundet av biträdesavtal, och Discord är självständigt personuppgifts-
  ansvarig som aldrig tecknar ett sådant. Samma sak gäller Tradera.
  ⛔ **MIGRATIONEN MÅSTE LIGGA FÖRE KODEN**: `/installningar`, GDPR-exporten och kontoraderingen `select`:ar
  Discord-kolumnerna, så koden mot en omigrerad databas ger 500 för ALLA användare, inte bara Discord-användare.
  Dockerfilens `migrate deploy || true` är avsiktligt icke-blockerande och kan alltså tiga ihjäl felet — kör
  `node scripts/with-prod-db.mjs npx prisma migrate deploy` MANUELLT före push vid schemaändringar.
- **GRATISKONTOTS BEVAKNINGSTAK = 5 (ägarbeslut 2026-08-06, var 10)**: `FREE_PLAN_WATCHLIST_LIMIT`. Sänkningen RADERAR
  ingenting — befintliga poster ligger kvar, taket bromsar bara nya tillägg. ⛔ **TALET ÄR PUBLICERAT** på sex ställen i
  två språk (prissidans `freeFeatures`, startsidans FAQ, nedgraderings-FAQ:n, klientens "listan är full") som fri text
  utan koppling till konstanten. `tests/unit/watchlist-limit-copy-sync.test.ts` failar om de glider isär — lös det ALDRIG
  genom att interpolera konstanten in i översättningarna: poängen är att någon TVINGAS läsa meningarna när talet ändras.
  ⚠️ Nedgraderings-FAQ:n lovade tidigare "bara de 10 senaste är aktiva" — en funktion som ALDRIG byggts (varken
  `watchlist.ts` eller RevenueCat-webhooken rör poster vid nedgradering). Texten säger nu vad koden faktiskt gör.
