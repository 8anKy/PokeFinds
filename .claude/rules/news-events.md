---
paths:
  - "src/lib/feed.ts"
  - "src/lib/feed-store.ts"
  - "src/lib/rss.ts"
  - "src/lib/event-format.ts"
  - "src/components/features/feed/**"
  - "src/app/**/nyheter/**"
  - "src/app/**/evenemang/**"
  - "src/app/api/cron/feed-publish/**"
  - "scripts/feed-build.ts"
  - "scripts/feed-foilio.ts"
  - ".github/feed/**"
  - ".github/workflows/news-feed.yml"
---
# Nyheter & evenemang (`/nyheter`, `/evenemang`)

- ⛔ **FLÖDET ÄR EN FIL PÅ VOLYMEN, ALDRIG EN TABELL.** `$RAILWAY_VOLUME_MOUNT_PATH/feed/feed.json`
  (`src/lib/feed-store.ts`), skriven av `POST /api/cron/feed-publish` med `x-cron-secret`. Skälet är
  kostnadsdoktrinen: nyhetslistan öppnas av varje besökare, och en Neon-väckning köper minst 300 s
  debiterad tid — en nyhetstabell hade varit en av de dyraste ytorna i appen. Sidorna läser filen bakom
  `cachedRead` med **egen tagg** (`FEED_CACHE_TAG = "flode"`); publiceringsrutten `revalidateTag`:ar den så
  en ny nyhet syns direkt i stället för att vänta ut ISR-timmen. ⛔ Lägg ALDRIG en `prisma`-import i
  sidorna, i rutten eller i `src/lib/feed.ts`.
- ⛔ **TVÅ PRODUCENTER, EN LANE VAR** (`NewsItem.lane`). `rss` = `news-feed.yml`, DB-fritt, 3 ggr/dygn,
  bygger ur `.github/feed/sources.json`. `foilio` = `scripts/feed-foilio.ts`, ett **STEG i `scrape-all.yml`**
  (aldrig egen cron — Neon är redan vaken där). Rutten ersätter EN lane i taget och behåller den andras
  poster; utan `lane` hade det jobb som körde sist raderat det andras nyheter. `events` skickas bara av
  rss-lanen — `null` betyder "rör dem inte", så ett jobb utan åsikt kan inte tömma evenemangslistan.
- ⛔ **RSS ENSAMT RÄCKER INTE, OCH DET ÄR MÄTT (2026-09-09).** PokéBeach har stängt sin feed ("No feed
  available", HTTP 500 på varje väg), pokeguardian/serebii/limitless har ingen, och de två flöden som
  svarar (pokemonblog.com, nintendoeverything.com) är tv-spelsbloggar: relevansgrinden släppte igenom
  **0 av 18** poster. Därför är **vår egen katalog huvudkällan** — setsläpp och nytt i katalogen är saker
  ingen annan svensk sajt vet. ⛔ Sänk inte grinden för att fylla listan; lägg till en KÄLLA i stället, och
  probea den först med `npx tsx scripts/feed-build.ts --dry`.
- ⛔ **VI ÅTERGER ALDRIG EN ARTIKELS TEXT.** En HÄMTAD post är rubrik + klippt ingress + källans namn +
  länk UT, och får därför **aldrig en `slug`** — den raden går rakt till källan. En post vi SJÄLVA skrivit
  text om (`slug` + `body` i `news.json`) får en egen sida på `/nyheter/<slug>`: vår sammanfattning, och
  **längst ned länken till originalet** med källans namn. Det är hela villkoret för att få sammanfatta
  någon annans nyhet. Bilden HOTLÄNKAS (`referrerPolicy="no-referrer"`), laddas aldrig ned.
- **EVENEMANGENS AFFISCH HÄMTAS UR BILJETTSIDAN** (`fillEventCovers`): arrangörens `og:image` är
  evenemangets egen nyckelbild — Tickster serverar den i 960×540, alltså exakt ett omslag. ⛔ Biljettsidan
  FÖRE info-sidan: biljettsidan visar DET HÄR evenemanget, medan arrangörens startsida ofta visar deras
  logotyp eller nästa evenemang.
- **VÅRA EGNA NYHETER FÅR ETT RITAT OMSLAG** (`scripts/make-feed-cover.ts`): stor rubrik på en tonad
  märkesyta, kategoripill, logotyp — och valfri skärmbild till höger. ⛔ Bilden genereras EN GÅNG på en
  utvecklarmaskin och checkas in i `public/news/`. Den renderas medvetet INTE i drift: `next/og` hade
  dragit in satori + en wasm-renderare i processen, och Railway-minnet är redan kapat (heap 384 MB,
  självåtervinning vid 550 MB). Texten sätts dessutom med systemets Arial via librsvg — en ubuntu-runner
  hade tyst bytt typsnitt. ⛔ `ACCENT` i scriptet och `PILL`/`TINT` i `feed-chrome.tsx` måste hållas i takt:
  omslaget och pillret bredvid det ska ha samma färg.
- **OMSLAGEN, i tre steg.** (1) Posten anger `imageUrl` själv — en väg under `public/` eller en extern
  bild. (2) Saknas den för en EXTERN post hämtar byggjobbet sidans egen `og:image` (`extractOgImage`,
  en hämtning per post och körning). (3) Finns ingen bild målas kategorins ikon som vattenstämpel på den
  tonade plattan — ⛔ aldrig en tom ruta, den läser som ett fel.
  ⛔ **`imageFit: "contain"` FÖR LOGOTYPER OCH SKÄRMBILDER.** Setloggan är en bred genomskinlig PNG och
  en skärmbild är stående; med `cover` beskärs båda till en suddig färgklick — precis vad setsläppen
  visade sitt första dygn.
  ⛔ **EN ARTIKELSIDA MÅSTE BEGÄRAS SOM HTML.** Med flödets `Accept` svarade psacard.com **403**; det såg
  ut som blockering men var vårt eget huvud (`ACCEPT_PAGE` i feed-build.ts). Vissa sidor ger ändå ingen
  bild — pokemon.com renderar sin og:image med JS — och då är vattenstämpeln svaret, inte UA-spoofing.
- ⛔ **INTERNT ÖPPNAS INTERNT.** `NewsItem.internal` styr `Link` (samma vy) mot `<a target="_blank">`.
  Schemat fäller `//annan.sajt` och `javascript:` — utan den grinden hade "intern" länk varit en öppen
  omdirigering. Vaktat av `tests/unit/feed.test.ts`.
- ⛔ **INGEN "PÅMINN MIG" PÅ EVENEMANG** (ägarbeslut 2026-09-09). Ett evenemang är ett datum, inte ett
  lager som tar slut. Vill man ha en påminnelse finns arrangörens egen sida bakom knappen.
- ⛔ **INGEN GODKÄNNANDEKÖ** (ägarbeslut 2026-09-09): flödet publicerar sig självt. Följden är att
  RELEVANSGRINDEN och kategorireglerna är det enda som står mellan källan och läsaren — de är alltså
  korrekthetskod, inte finputs.
- **TRE FILER I `.github/feed/`, ALLA UTANFÖR `watchPatterns`** ⇒ en ändring i dem kostar varken deploy
  eller databas: `sources.json` (RSS-källor), `news.json` (handskrivna nyheter — marknadsnyheter och
  "nytt i Foilio", kategori `APP`) och `events.json`. Kurerade poster går in i rss-lanen och sorteras
  in bland de hämtade på `publishedAt`, som ska vara **när nyheten bröt** — inte när den skrevs in.
- ⛔ **"NYTT I KATALOGEN" ÄR BORTTAGET UR FOILIO-LANEN (ägarbeslut 2026-09-09).** Lanen postade en nyhet
  per ny katalogprodukt; katalogen är inte kurerad, och första körningen mot prod gav bland annat
  "Ny i katalogen: … B Grade – RIPPED SEAL". Setsläpp är kvar — de är få, daterade och angår alla.
  ⛔ Bygg inte tillbaka det utan en kvalitetsgrind mätt mot verklig kataloginförsel.
- **Evenemang skrivs in i `.github/feed/events.json`.** Det finns ingen gratis maskinläsbar källa för
  svenska Pokémon-mässor (Play! Pokémons event-API svarar inte publikt, Facebook har inget gratis API).
  Filen ligger under `.github/` MED FLIT: Railways `watchPatterns` hoppar över mappen, så ett nytt
  evenemang kostar **ingen deploy**. `slug` är valfri (härleds ur titeln), `startsAt` är ISO med tidszon.
  Ett evenemang städas bort av sig självt dagen efter att det slutat (`EVENT_KEEP_DAYS`).
- **Ingången är headerns knapp** (`news-link.tsx`), som **ersatte Discord-knappen** 2026-09-09 — Discord
  finns kvar på `/mer` och i sidfoten. ⛔ Headern har plats för EN sak bredvid kontot; två ikoner gör raden
  till en verktygsrad. Knappen får aldrig kalla `auth()`/`cookies()` (då blir hela appen dynamisk).
- **Detaljsidan är produktvyns "hjälte"**: scen med flytande `BackCircle` + dela-cirkel, rundat ark över.
  ⛔ Rutten står därför i `lib/subpage-routes.ts` (`/evenemang/`) — annars ligger logotyphuvudet kvar
  ovanför cirkeln på mobil. Nedräkningen (`EventCountdown`) renderas BARA på klienten: sidan är ISR-cachad
  en timme och ett serverrenderat "om 24 dagar" hade kunnat vara ett dygn fel.
- ⛔ **DETALJSIDAN ANROPAR ALDRIG `notFound()` — MÄTT 2026-09-09.** Rutten renderas statiskt
  (`revalidate` + tom `generateStaticParams`, som `/produkter/[slug]` och `/sets/[id]`), och rotens
  `not-found.tsx` hämtar sin copy med `getTranslations()` UTAN locale, dvs ur HEADERS. Under statisk
  rendering fäller Next då hela svaret — "Page changed from static to dynamic at runtime, reason: headers"
  ⇒ **HTTP 500** på varje död slug, varje gång (ingenting cachas). Sidan renderar i stället en egen mjuk
  404 med `noindex`, alltså 200 — samma beteende som syskonrutterna redan har och som CLAUDE.md dokumenterar
  under "MJUK 404 PÅ ISR-RUTTERNA". ⏭️ Testa om vid nästa Next-uppgradering.
- **Kartan öppnas hos kartleverantören** (`mapUrl`), aldrig inbäddad — en inbäddad karta kostar pengar och
  spårar besökaren.
- **`src/lib/rss.ts` är avsiktligt en dum läsare**, inte en XML-parser: fem fält per post, tolerant mot
  skräp, kastar aldrig. Behövs mer är svaret ett riktigt bibliotek i JOBBET, inte fler regexar där.
