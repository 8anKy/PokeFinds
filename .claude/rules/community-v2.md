---
paths:
  - "src/lib/community-v2-gate.ts"
  - "src/lib/community-v2-server.ts"
  - "src/lib/use-community-v2.ts"
  - "src/lib/chat-hub.ts"
  - "src/lib/chat-client.ts"
  - "src/lib/chat-rules.ts"
  - "src/lib/object-storage.ts"
  - "src/lib/push-to-user.ts"
  - "src/lib/listing-rules.ts"
  - "src/lib/discord-market.ts"
  - "src/lib/tradera-seller-items.ts"
  - "src/services/community*.ts"
  - "src/services/chat.ts"
  - "src/services/blocks.ts"
  - "src/app/api/community/**"
  - "src/app/api/chat/**"
  - "src/app/[locale]/(marketing)/forum/**"
  - "src/app/[locale]/(marketing)/community/**"
  - "src/app/[locale]/(app)/meddelanden/**"
  - "src/app/[locale]/(marketing)/profil/**"
  - "src/components/community/**"
  - "src/components/chat/**"
  - "capacitor.config.ts"
---
# Community v2: forum, Köp/Sälj/Byt, meddelanden, Tradera-annonser på profilen (byggt 2026-09-03)

- **⛔ GRINDAT TILLS ÄGAREN TESTAT I TESTFLIGHT (ägarbeslut 2026-09-03).** Domen är EN ren funktion,
  `communityV2Allowed()` i `src/lib/community-v2-gate.ts`: släpper in (1) alla när `COMMUNITY_V2_PUBLIC=1`,
  (2) ADMIN/SUPERADMIN, (3) en native-byggnad vars User-Agent bär `FoilioApp/<version>` (`appendUserAgent` i
  `capacitor.config.ts`, med sedan 1.2 — ingen tidigare byggnad har taggen, så "taggen finns" = "ny byggnad").
  Middleware omdirigerar `/forum*` och `/meddelanden*` till `/community` ("snart här") för alla andra och speglar
  domen i cookien `fo_beta` (icke-httpOnly, som `fo_auth`) som bottenflikar/sidomeny/`/mer` läser via
  `useCommunityV2()`. API-rutter grindar SJÄLVA med `assertCommunityV2(role)` (middleware täcker inte `/api`).
  ⛔ Det är en LANSERINGSGRIND, inte säkerhet — en UA går att förfalska; auth på varje rutt är skyddet.
  **LANSERING = TVÅ STEG**: släpp 1.2 i App Store (appanvändarna får funktionerna automatiskt via taggen) OCH sätt
  `COMMUNITY_V2_PUBLIC=1` i Railway (webben; bakas in vid BYGGET ⇒ deploy). Då börjar `/community` och
  `/community/[id]` omdirigera till `/forum` resp. `/forum/t/[id]`, och sitemapen tar med forumet.
  ⛔ MODERATOR räknas INTE som admin här — bara ägaren/admin ska se ofärdiga funktioner.
- **EN FEED + KURERADE GRUPPER, INTE FACEBOOK-RUM (ägarbeslut 2026-09-03).** Sex grupper seedas av migrationen
  (`grp_allmant`, `grp_kop_salj_byt` [isMarketplace], `grp_samlingar_pulls`, `grp_sealed_slapp`,
  `grp_skanning_gradering`, `grp_nyborjare`) och skapas av admin/migration, aldrig av användare — en community på
  ~100 medlemmar tål inte åtta tomma rum. Startflödet visar ALLT; grupperna är filter man kan gå med i.
  Datamodellen är den riktiga gruppmodellen: att öppna för användarskapade grupper och ett "dina grupper"-flöde
  är två defaults, ingen ombyggnad. `CommunityPost.category` är nullable och bara en etikett på gamla inlägg.
- **KÖP/SÄLJ/BYT ÄR EN ANSLAGSTAVLA — FOILIO ÄR ALDRIG PART.** `listingKind`/`priceOre`/`condition`/`productId`/
  `traderaUrl`/`listingStatus` bor på tråden; reglerna är rena (`src/lib/listing-rules.ts`): SELL kräver pris,
  TRADE får inget pris, marknadsfält bara i marknadsgruppen. Säljaren sätter själv Såld/Avslutad; vi verifierar
  inget, håller inga pengar. Villkoren §21 säger exakt det. Alla inloggade får sälja (ägarbeslut, ingen ålders-/
  Pro-grind) — tilliten visas som SIGNALER på säljarkortet (medlem sedan, Tradera-/Discord-kopplad,
  försäljningar via Foilio) i stället för att stängas ute. Nya marknadstrådar korspostas till Discord via
  bot-token + `DISCORD_MARKET_CHANNEL_ID` (tomt = av, aldrig ett fel).
- **⛔ CHATTEN POLLAR ALDRIG NEON.** Leverans = SSE-ström (`/api/chat/stream`, hålls av Railway-processen) +
  in-memory-nav (`src/lib/chat-hub.ts`); ett meddelande = EN skrivning + `publish()`, och push
  (`pushToUser`) BARA när mottagaren inte är ansluten (`isConnected`). Att öppna en konversation är en fråga.
  Ingen timer rör databasen — det var pollningen som gav ~$45/mån-kalkylen 2026-08-29, inte chatten.
  Hjärtslag var 25 s håller proxyn öppen; minnesåtervinningen bryter strömmar 3–5 ggr/dygn och EventSource
  återansluter själv — klienten hämtar `?after=<sista id>` vid återanslutning, inget tappas (sparat FÖRE publish).
  ⛔ Navet lever i EN process: kör Foilio någonsin på två replikor måste publiceringen gå via Redis pub/sub.
  ⛔ Ingen "senast sedd"/närvaro som skrivs — det hade kostat en skrivning per session.
  EN konversation per par (`pairKey` = sorterade id:n); `Message.senderId` är SetNull så GDPR-radering lämnar
  motpartens kopia ("Raderat konto"). Moderator läser BARA anmälda konversationer (`ChatReport`) — villkoren
  lovar det. Blockering (`UserBlock`) är App Store-krav 1.2 och stoppar både chatt och synlighet.
- **BILDER = RAILWAY BUCKET (privat S3, ams), $0,015/GB-mån, egress gratis.** `src/lib/object-storage.ts`:
  uppladdning går genom `/api/community/upload` (klienten skalar ner till ≤1600 px JPEG — EXIF/GPS försvinner),
  visning via SIGNERADE läs-URL:er (7 dygn, deterministiska per timme så webbläsarcachen träffar) — ⛔ aldrig en
  lagrad URL, bara nyckeln `forum/<userId>/<uuid>.<ext>` (prefixet gör GDPR-radering till ett list+delete-anrop).
  ⛔ Ingen presignerad PUT från webbläsaren: CORS står inte bland bucketens stödda funktioner. Utan `S3_*`-env
  svarar `storageEnabled()` falskt och bildvalet döljs — forumet fungerar utan bilder.
- **TRADERA-ANNONSER PÅ PROFILEN = EGEN SPAK (`User.showTraderaListings`, default av).** Kopplingen gavs för att
  SÄLJA från samlingen; att publicera annonserna är ett annat samtycke. Hämtas med `GetSellerItems` (Tradera
  PublicService, per Pokémon-kategori, ingen användartoken) via `cachedRead` 1 h — noll DB, ~4 Tradera-anrop per
  profil och timme mot 10 000/dygn. Tradera nere ⇒ tom lista, aldrig 500. Frånkoppling nollar spaken.
- **Publika forumsidor är ISR (`revalidate = 300`) + `revalidatePath` efter skrivningar**; personligt tillstånd
  (gillat/sparat/gått med/blockerade) hämtas klient-sida från `/api/community/me`. `/meddelanden` är dynamisk
  (auth). Profilsidan var redan `force-dynamic`. Sitemap/robots: forumets läsvyer indexeras (när publikt),
  `/meddelanden` + `/forum/ny` är disallow.
- **POLERINGSRUNDA EFTER ÄGARENS TESTFLIGHT-TEST (2026-09-03, samma kväll)** — tre ägarbeslut:
  (1) **INGA EMOJIS I FORUMET** — `CommunityGroup.emoji` finns kvar i modellen men RITAS INTE (chips, kort,
  trådhuvud, gruppsida, composer). Forumets ingress ("Pulls, samlingar…") är BORTTAGEN — bara rubriken.
  (2) **SPARA/GILLA LEDER NÅGONSTANS**: `/forum/sparade` (dynamisk, kräver konto — `PROTECTED_PREFIXES`) med
  två svepbara flikar Sparade/Gillade (`getSavedFeed`/`getLikedFeed`, `/api/community/saved?kind=`), bokmärkes-
  ikon i forumhuvudet, och Spara-toasten säger vart tråden tog vägen.
  (3) **PROFILEN = HUVUD + TRE FLIKAR** (Inlägg · Portfölj · Tradera) i `ui/swipe-tabs.tsx`. Inlägg = `ThreadList`
  med `author=` (även sålda/avslutade — det är personens historik; `hrefBase="/community"` utanför grinden),
  Portfölj = `portfolio-pane.tsx` (topp 20 via `computeCollectionValue(id, { topItems })`, andra ser aldrig
  belopp), Tradera = `tradera-listings-pane.tsx` (fliken finns bara bakom grinden och när spaken är på — eller
  på EGEN profil, då med väg till inställningen).
  **SVEP-KONVENTIONERNA** (`src/lib/swipe-gesture.ts`, rena beslut, testade): `SwipeTabs` sveper mellan flikar,
  `SwipeBack` (`ui/swipe-back.tsx`) = kant-svep tillbaka på tråd/grupp/profil/sparade (router.back, fallback vid
  djuplänk). Kantzonen (28 px från vänster) tillhör ALLTID SwipeBack — SwipeTabs rör den inte. ⛔ Ytor som äger
  sitt eget vågräta drag (grupp-chips, filterrader, grafer) MÅSTE bära `data-swipe-ignore`, annars kapar
  bakåt-svepet en scroll som börjar vid kanten. Touch-events + `preventDefault` på vågrätt touchmove, av samma
  skäl som produkt-overlayn (WKWebView:s systemgest). ⛔ Sätt aldrig `allowsBackForwardNavigationGestures` i
  Capacitor — då dubbelfyrar bakåt. Hooks bor i `src/hooks/` (`use-keyboard-height.ts` delas av ark/modal/chatt).
- **Legal (publicerat 2026-09-03, ej juristgranskat)**: villkor §21 (innehållslicens, anslagstavla/ingen part,
  anmälan + motivering + invändning [DSA], moderatorläsning av ANMÄLDA samtal, blockering, förbjudet innehåll),
  integritetspolicy (meddelanden, forumbilder, Railway Buckets, hämtning av publika Tradera-annonser).
