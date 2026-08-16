# Kända begränsningar & roadmap

> ⚠️ **Uppdaterad 2026-08-16.** Filen var kvar i MVP-läge och beskrev en app som inte
> längre finns (mock-OCR, avstängd Stripe, inga riktiga adapters). Punkter som är
> verifierat levererade är strukna eller flyttade till "Levererat" nedan.
> ⛔ Skriv inte in en status du inte kan verifiera i koden — skriv "overifierad".

## Levererat sedan MVP (verifierat i kod 2026-08-16)
- **Riktiga datakälle-adapters** — adapter-mönstret i `src/scrapers/` kör 42 svenska
  butiker i prod. Mock-källan är historik.
- **Riktig vision** — skanning (`OCR_PROVIDER=gemini`) och AI-gradering
  (`GRADING_PROVIDER=gemini`), avläst i Railway 2026-08-14. Mock gäller bara lokalt.
- **Live-kamerascanning** — `/skanna` kör getUserMedia-strömmen; gradering är kvar som
  foto-/uppladdningsflöde med flit.
- **Stripe** — `src/lib/stripe.ts` + `/api/billing/checkout`, `/api/billing/portal`,
  `/api/webhooks/stripe` finns och är kompletta. Spakens VÄRDE i prod (`STRIPE_ENABLED`)
  bor i Railway och går inte att verifiera ur repot.
- **Native push** — APNs (`src/lib/apns.ts`) + Capacitor-klienten (`src/lib/push-client.ts`).
- **Restock-alerts** — 42 bevakade butiker, larm + Discord-lane i drift.
- **i18n (SV/EN)** — `next-intl`, `messages/sv.json` + `messages/en.json`.

## Kända begränsningar (nuläge)
- **Bilduppladdningar lagras inte** (scanner: inline; community: `imageUrl`-fält finns men
  ingen uppladdningsbackend) — S3-kompatibel lagring är produktionsvägen
- **WEBB-push ej aktiv** — `public/sw.js` finns, men det finns NOLL VAPID-referenser i
  `src/` (kontrollerat 2026-08-16), dvs. ingen browser-push-prenumeration. PUSH-kanalen
  i alerts går i dag bara via NATIVE push (APNs/Capacitor), inte via webbläsaren.
- **Samlingsvärdets 7d-förändring** approximeras (inga dagliga collection-snapshots)
- E-post i dev loggas till konsolen (`EMAIL_MODE=console`)
- In-memory rate limiting utan Redis (ok för en instans). Se även
  `docs/LAUNCH-CHECKLIST.md` Section 0.3: limitern är påsatt på 21 av 94 API-router.

## Nästa version
1. S3-bildlagring (scanner + community + avatarer)
2. Webb-push (VAPID + service worker) för restock-notiser i webbläsaren
3. Dagliga snapshots av samlingsvärde per användare
4. SSE/WebSocket för live-prisuppdateringar i UI
5. Admin review-queue för låg-confidence produktmatchningar (UI finns delvis via jobs)
6. Blogg/nyhetssektion för TCG-guider (SEO)
7. 2FA (arkitekturen är förberedd via NextAuth)
8. Heatmaps i marknadsanalysen

---

## Att åtgärda — backlog (uppdaterad 2026-06-14)

### Buggar / datakvalitet
- [ ] **Sealed CM-trendpriser ibland uppblåsta** pga felmappad `idProduct` (t.ex. Brilliant Stars box €795). Headline-"lägsta pris" är ändå rätt (butik vinner), men CM-raden i offer-tabellen kan vara fel. Kräver bättre sealed→idProduct-mappning. (Se [[issue_cm_reprints_no_mapping]] i minnet.)
- [ ] **~1300 reprints saknar CM-mappning** (Celebrations Classic Collection m.fl.) → inget pris/länk. TCGdex eller manuell idProduct-tabell senare.
- [x] **LÖST via RapidAPI (TCGGO) sedan 2026-07** — vi publicerar numera `lowest_near_mint`, dvs det engelska
  NM-"From"-priset. Punkten nedan är historik. ⚠️ Två saker i den är RÄTTADE 2026-08-02: (a) domänen är
  `apiv2.cardmarket.com` sedan 2026-01-30, den gamla ger 410 Gone; (b) vägen är inte bara "kräver ansökan" utan
  STÄNGD — CM tar inte emot ansökningar, begränsar till professionella säljare, och förbjuder uttryckligen
  återkommande dygnsvis massfrågning av pris-resurser, vilket är exakt vårt mönster. Se CLAUDE.md.
- [ ] **CM singelpris = trend, inte engelska "From"** användaren ser på cardmarket.com. **Utrett 2026-06-14** (`scripts/inspect-cm-prices.ts`): alla gratiskällor (pokemontcg.io, CM-prisguide, TCGdex) ger bara **all-språk-aggregat** — `lowPrice` (inkl. skadade), `lowPriceExPlus` (lägsta EX+, men fortf. all-språk → för vintage €0,05 vs trend €5), `trendPrice`. Engelska "From" = en **live marketplace-fråga** som inget aggregat innehåller. **Enda legitima vägen = Cardmarkets officiella Marketplace-API** (`api.cardmarket.com`, OAuth 1.0a): `GET /products/{idProduct}/articles?idLanguage=1&minCondition=2` sorterat på pris → billigaste = From. Kräver: (1) CM-konto + registrerad API-app (OAuth1.0a-nycklar, ev. begära "dedicated app"), (2) idProduct per kort (har för de flesta singlar; ~1300 reprints saknar), (3) hantering av dygnskvot (~5000 req/dygn → rotera populära/bevakade kort, cacha resten), (4) ToS-granskning för aggregering/visning. Eget delprojekt. Tills dess = `trendPrice` (matchar grafen, inga absurda golv). Scraping av cardmarket.com är uteslutet (403+ToS). (Se [[issue_cm_single_price_source]].)
- [ ] **~17 445 Tradera-offers är fortf. sök-länkar** (dolda av `isDirectOfferUrl`) tills Tradera-svepet hittar `/item/`-länkar. (Adresseras av Tradera-API-systemet, se nedan.)
- [ ] **favicon.ico fortf. gammal palett** (binär ico, ej regenererad till teal som `icon.svg`/PNG:erna). Regenerera via designverktyg → ersätt `public/favicon.ico`.

### Funktionella luckor
- [x] **Skanner + AI-gradering kör riktig vision** — prod har `OCR_PROVIDER=gemini` och `GRADING_PROVIDER=gemini` (avläst i Railway 2026-08-14). Mock gäller bara lokalt/utan variabler. ⚠️ `SCANNER_MODEL_PRECISE` defaultar till `gemini-3.5-flash`, som är STRIKT DOMINERAD av `gemini-3.6-flash` (samma inpris, 20 % billigare ut, nyare) — graderingen bytte 08-05, skannern glömdes.
- [ ] **Skan-/graderingsbilder lagras inte** (`imageUrl="inline-upload"`) → S3-kompatibel objektlagring för historik-thumbnails + omgradering.
- [ ] **HEIC/ovanliga bildformat avvisas** (iOS fotobibliotek ger ofta HEIC) i gradering/skanning → klient-sidig konvertering till JPEG, eller bredda stödet.
- [ ] **Samlingens `valueOverTime`** = NUvärde bucketat på inköpsmånad (ej historiskt korrekt). Kräver dagliga samlingsvärde-snapshots per användare för en riktig kurva.
- [ ] **WEBB-push ej aktiv** — `public/sw.js` finns, men VAPID-nycklar + push-prenumeration saknas (noll VAPID-träffar i `src/`, kontrollerat 2026-08-16). NATIVE push (APNs/Capacitor) är däremot i drift, så PUSH-kanalen i alerts fungerar i app:en men inte i webbläsaren.
- [x] **Stripe är BYGGT och komplett** — `stripeEnabled()` i `src/lib/stripe.ts`, checkout/portal/webhook-routerna finns. ⛔ Spakens värde i prod (`STRIPE_ENABLED`) bor i Railways miljövariabler och går INTE att verifiera ur repot; enligt CLAUDE.md är webbens Pro live och provköp end-to-end är det som återstår. ⛔ Stripe skriver ALDRIG `planTier` — entitlement läses via `proUserWhere()`/`isPro()`.

### Teknisk skuld / underhåll
- [ ] **npm audit** (ommätt 2026-08-16): `npm audit` = 20 sårbarheter (4 moderate, 14 high, 2 critical) — men merparten är DEV/BYGG-kedjan (`xcode`/`uuid` via Capacitor-verktygen m.fl.), som aldrig körs i prod. `npm audit --omit=dev` = **4 high**, samtliga `postcss` under `next`, med enda fixen `next@16` (brytande — se Next 14→16 i LAUNCH-CHECKLIST). CI kör därför `npm audit --omit=dev` INFORMATIVT, utan att blockera. `npm audit fix --force` kan bryta — granska manuellt.
- [ ] **Prisma v5 → v6** uppgradering finns tillgänglig.
- [ ] **Byggvarningar** `mailer.ts`/`queue.ts` "Critical dependency" (bullmq/nodemailer dynamiska require) — kosmetiskt, hanteras av `serverComponentsExternalPackages`.
- [ ] **Graderingskvot** är UTC-dygn (återställs ~01–02 lokal tid) + liten TOCTOU-race vid samtidiga anrop. Acceptabelt; byt till lokal tidszon + transaktionsräkning vid behov.

---

## Befintligt system: Tradera-API-databerikning
Ett system använder Traderas officiella API (`runTraderaSweep()` i `src/jobs/tradera-sweep.ts`, CLI `scripts/tradera-full-sweep.ts`) för att berika produkter som saknar direktlänk: det söker Tradera, matchar mot våra produkter (`matchProduct` + rimlighetsvakt) och **uppdaterar offern in-place med en exakt `/item/`-länk om det hittas en lägre, köpbar listning** än vad vi har. Sök-länk-offers förblir dolda tills svepet ersätter dem. Körs dagligen (BullMQ `0 4 * * *` + no-Redis-fallback 1×/kalenderdygn). 6 SOAP-kvoter = 600 anrop/dygn. → När detta körts regelbundet minskar antalet dolda Tradera-offers (se backlog ovan).

---

## ✅ LEVERERAT: Restock-alerts (sealed) — avsnittet nedan är HISTORIK

> Funktionen är i drift: `runRestockScan()` i `src/scrapers/runner.ts` bevakar 42 butiker,
> larmar via IN_APP/EMAIL/PUSH och matas dessutom till Discord-lanen. Läs avsnittet som
> designmotiv, inte som en att-göra-lista. Gällande regler: `.claude/rules/scraping-restock.md`
> och `.claude/rules/alerts-setwatch.md`.

**Mål (användarens ord):** alerta **Pro-prenumeranter** (`PlanTier.PREMIUM`) när en **restock** skett hos Webhallen och andra butiker som säljer **sealed** (boxar, bundles, ETB, paket osv.).

**Befintlig infrastruktur att återanvända (mesta finns redan):**
- `RestockEvent` (productId, retailerId, oldStatus→newStatus, price) skapas av skrapan (`src/scrapers/runner.ts` / `scripts/run-scrapers.ts` / tradera-svepet) vid OUT_OF_STOCK→IN_STOCK.
- `WatchlistItem` har `restockAlert: Boolean` + `channels` (JSON, default `["IN_APP","EMAIL"]`) + `isPaused`.
- `AlertType.RESTOCK`, `AlertChannel` (IN_APP/EMAIL/PUSH), `Alert`-kö, `Notification` (in-app).
- `src/services/alerts.ts` + `src/services/notifications.ts` (in-app + nodemailer; console-transport i dev). E-postmallar i `src/emails/`.
- Sealed-kategorier = `ProductCategory` utom `SINGLE_CARD`/`GRADED_CARD`: `BOOSTER_BOX, BOOSTER_PACK, ETB, COLLECTION_BOX, TIN, BLISTER, BUNDLE`.

**Att bygga:**
1. **Pro-gate**: restock-alerts blir en premium-förmån. Vid utskick: hoppa över mottagare vars `user.planTier !== PREMIUM`. (Gör det till en delad guard så pris-alerts kan förbli gratis om så önskas.)
2. **Trigger**: ny/utbyggd jobbsteg (t.ex. i `src/jobs/`, körs efter skrap) som läser nya `RestockEvent` (newStatus=IN_STOCK) för **sealed**-produkter och skapar `Alert`(type=RESTOCK) + `Notification` för berörda Pro-användare.
3. **Vem alertas? — ÖPPET BESLUT (fråga användaren):**
   - (a) *Per bevakning*: bara Pro-användare som bevakar produkten (`WatchlistItem.restockAlert`), ELLER
   - (b) *Broadcast/prenumeration*: Pro-användare kan abonnera på "alla sealed-restocks" (ev. per butik, t.ex. "Webhallen") utan att bevaka varje produkt → kräver ny prenumerationsmodell (`RestockSubscription` med retailerId/kategori-filter).
   - Sannolikt en kombination: per-produkt-bevakning för alla + "bevaka hela butiken/kategorin" som Pro-förmån.
4. **Kanaler**: IN_APP + EMAIL nu (finns); PUSH när VAPID/web-push är på (se backlog). Respektera `WatchlistItem.channels` + `isPaused`.
5. **Avstudsning/dedupe**: skicka inte dubletter för samma `RestockEvent`; throttla per produkt/användare (en restock kan flagga flera butiker).
6. **Retailer-täckning**: säkerställ att butiksskraparna (Webhallen, Spelexperten, Dragon's Lair, Alphaspel) faktiskt registrerar IN_STOCK-övergångar för sealed (annars inga RestockEvents att alerta på).
7. **UI**: visa "Restock-alert (Pro)" i bevakningsflödet + ev. en "Bevaka restock för hela Webhallen"-knapp; tydlig Pro-upsell för gratisanvändare.
8. **Test**: sätt en testanvändare till PREMIUM manuellt (Stripe är av), seeda ett RestockEvent, kör jobbet, verifiera notis + mejl (console-transport).

---

## ✅ LEVERERAT: Live-kamerascanning — avsnittet nedan är HISTORIK

> `/skanna` kör live-kameran i prod och graderingen är kvar som foto-/uppladdningsflöde,
> precis som beslutet nedan säger. ⛔ Raden "Beror på: riktig OCR/vision (idag mock)" är
> ÖVERSPELAD — prod kör `OCR_PROVIDER=gemini`. **LÄS `docs/SCANNER-STATUS.md` före varje
> ändring i skannern**; den här texten är designmotiv, inte nuläge.

**Mål (användarens ord + beslut 2026-06-14):** **identifiering/pris** ska kunna ske **live** — öppna kameran (live-video), kortet scannas i realtid, identifieras och visar pris, med möjlighet att lägga till i portföljen (inget foto behövs). **Gradering ska INTE vara live — den förblir foto-/uppladdning** (kräver skarp fram-/baksida). Foto-/uppladdningsvägen finns kvar även för identifiering som fallback.

**Teknik / krav:**
- **`getUserMedia`** (live `<video>`-ström) istället för `<input capture>`. OBS: getUserMedia kräver **secure context (HTTPS)** — fungerar på `localhost` och HTTPS, men INTE över vanlig LAN-http (telefon-test kräver tunnel/HTTPS, se mobil-preview).
- **Realtidsanalys**: fånga frames från videoströmmen (throttlat, t.ex. var 500–1000 ms eller på "stabil bild"-heuristik), skicka till identifiering/gradering. Visa overlay/ram som vägleder kortplacering.
- **Kortdetektering** (önskvärt): hitta/auto-beskär kortet i frame (kant-/rektangeldetektering, ev. deskew) innan analys → bättre träff och billigare anrop. Kan göras klient-sida (canvas/edge-detection) eller skicka hela frames.
- **Beror på**: riktig OCR/vision för identifiering (idag mock — se backlog "Skanner kör mock-OCR"). **Gradering är uttryckligen INTE live** — `/gradera` behåller foto-/uppladdning (fram + bak).
- **Flöde (identifiering)**: öppna kamera → auto-identifiera i realtid → visa kort + Marknadstrend → knappar "Lägg till i samling" / "Gradera (öppnar foto-uppladdning)".
- **Prestanda/kostnad**: throttla vision-anrop hårt (varje frame till en betal-modell är dyrt) — analysera bara när bilden är stabil/skarp; debounce; avbryt vid byte.
- **Fallback**: behåll nuvarande foto/upp­laddnings-UI för enheter utan kamera eller där getUserMedia nekas.
