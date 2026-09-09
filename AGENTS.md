# AGENTS.md — så arbetar du i Foilio

Foilio är en SaaS för svenska Pokémon TCG-samlare: prisbevakning, restock-larm, marknadsdata,
samlingsvärde, kortskanning och community. Eget varumärke, egen design, svensk copy.
**LIVE på https://foilio.se.** En `git push origin main` DEPLOYAR direkt till produktion.

## Läs det här först

1. **`CLAUDE.md` i reporoten är KANONISK.** Den håller nuläget, de durabla tvärgående besluten och vad
   som är kvar. Läs den innan du rör något. Filen här beskriver hur du *arbetar*; CLAUDE.md beskriver
   vad som *gäller*. ⛔ Duplicera inte innehåll mellan dem — när de säger olika saker vinner CLAUDE.md.
2. **`.claude/rules/*.md` är delsystemens regler.** Varje fil har en `paths:`-lista i frontmatter.
   Claude Code laddar dem automatiskt när man rör en matchande fil; **andra agenter måste öppna dem
   själva**. Tabellen längst ned i den här filen säger vilken du ska läsa när.
3. Git-historiken är sessionsdagboken. Commit-meddelandena förklarar VARFÖR — läs dem när något ser
   udda ut i stället för att anta att det är slarv.

## Kommentarerna i koden är dokumentation, inte brus

Kodbasen är tät på långa svenska kommentarer som börjar med **⛔** eller **⚠️**. De är inte
utsmyckning: nästan varje sådan rad är en incident någon har betalat för — nedtid, felaktiga larm,
en faktura. **Läs dem innan du ändrar raden de sitter på, och ta aldrig bort en utan att veta varför
den skrevs.** Skriver du ny kod som fångar en icke-uppenbar fälla: skriv en likadan kommentar, på
svenska, som förklarar konsekvensen — inte mekaniken.

## Kostnadsdoktrinen styr VARJE designbeslut

Det här är projektets viktigaste invariant. Läs hela avsnittet i CLAUDE.md innan du föreslår något
som rör data.

- **Neons nota är VAKEN TID — räkna väckningar, aldrig rader.** Compute är ~95 % av notan och varje
  väckning köper **minst 300 s debiterad tid**. En funktion som gör en billig SQL-fråga varannan
  minut är dyrare än en som gör tusen frågor en gång per natt.
- **Nya bakgrundsjobb läggs som ETT STEG i ett befintligt nattjobb**, aldrig som egen cron. Neon är
  redan vaken i det fönstret.
- **Nattkedjan får ALDRIG bli längre än tre led** (`workflow_run`): GitHub fyrar max tre nivåer från
  roten, det fjärde ledet fyrar aldrig — tyst.
- **En läsning per jobb, aldrig per varv.** Ett DB-uppslag i en loop med tusentals varv räckte en
  gång för att hålla computen vaken dygnet runt.
- **Publika sidor får inte röra databasen i onödan.** Produktsidan är ett DB-fritt skal; nyhetsflödet
  är en JSON-fil på Railway-volymen. Frågan "kan den här ytan läsas utan att väcka Neon?" ska ställas
  varje gång.
- **Kostar något pengar — lägg fram siffran och invänta ägarens OK innan du bygger.**

## Caching och ISR är kvot-kritiskt

- Publika läs-sidor är ISR-cachade (`revalidate = 3600`), **aldrig `force-dynamic`** — det var
  orsaken till hög CPU och Neon-CU en gång och får inte återinföras.
- **Rot-layouten, marketing-layouten och `SiteHeader` får ALDRIG kalla `auth()` eller `cookies()`** —
  då blir HELA appen dynamisk. Session läses klientsidigt.
- En routes färskhet blir det **lägsta** värdet bland alla cachade läsningar i renderingen. En
  `cachedRead` med kort TTL kapar alltså sidans `revalidate` utan att någon märker det.
- `unstable_cache` JSON-serialiserar: `Date` blir sträng och ett `Set` blir `{}` vid cache-TRÄFF.
  Returnera arrayer och wrappa datum i `new Date(...)`.
- En serverrenderad `Link` från `@/i18n/navigation` läser locale ur **headers** och fäller statisk
  rendering ("Page changed from static to dynamic at runtime") ⇒ HTTP 500. Använd `<a>` med
  locale-prefix i serverkomponenter; i klientkomponenter är `Link` oproblematisk.

## Hårda invarianter (bryt dem inte)

- **Priser lagras i öre** (heltal) + `currency`. Visa via `formatPrice()`. Aldrig float.
- **0 kr är inget pris.** `priceOreFromEur()` är enda vägen EUR→öre och ger `null` när resultatet
  inte är positivt. "–" betyder "vi vet inte", "0 kr" betyder "gratis".
- **Dygnsnyckel är UTC**, aldrig lokal midnatt (`utcToday()` / `utcDaysAgo()`).
- **Inga fabricerade priser eller data.** Bara verifierade källor. Ingen påhittad strukturerad data,
  inga `aggregateRating` vi inte har.
- **All copy på svenska**, premium men lekfull ton, mörkt tema. Engelska finns som andraspråk —
  ny användarvänd feltext kräver en rad i `src/lib/api-error-i18n.ts` **och** båda språkfilerna.
- **Nämn ALDRIG inspirations- eller konkurrentsidor** i kod, copy eller docs.
- **Migrationen måste ligga före koden.** Ny kod som läser nya kolumner mot en omigrerad databas ger
  500 för alla, och Dockerfilens `migrate deploy || true` tiger ihjäl felet. Kör
  `node scripts/with-prod-db.mjs npx prisma migrate deploy` manuellt före push vid schemaändring.
- **Prod-DB från CLI körs ALLTID via `node scripts/with-prod-db.mjs <cmd>`.** ⛔ Gräv aldrig fram
  hemligheten i skalet — det materialiserar lösenordet i kommandoraden, terminalhistoriken och
  agent-transkriptet.
- **Inga hårdkodade hemligheter.** GDPR: dataminimering, export och radering måste alltid fungera.
- **Designtokens, inte hex.** Svart yta, turkos signaturaccent (`holo.cyan`). `surface-overlay` är en
  interaktiv fyllning, inte en bakgrund. Sidans vågräta luft är 10 px på mobil (`px-2.5 sm:px-6`) och
  delas av allt som möter kanten.
- **`NEXT_PUBLIC_*`-flaggor bakas in VID BYGGET.** De måste speglas i `next.config.mjs` **och** stå
  som `ARG` + `ENV` i Dockerfile, annars bakas defaultvärdet in oavsett vad som står i Railway. Ett
  påslag kräver därför en ny deploy, inte bara en variabel.

## Så verifierar du innan du säger att något är klart

Kör allt tre; ingen av dem är valfri när du rört kod:

```bash
npx tsc --noEmit      # typerna
npx vitest run        # hela enhetssviten (~2 500 tester, ~20 s)
npm run build         # produktionsbygget — fångar det de andra två missar
```

Har du rört en publik rutt: starta `npx next start` och begär sidan på riktigt. Flera fel i det här
projektet (500 på en död slug, tom lista trots data) syntes varken i typerna eller i testerna.

Rör du ett jobb: kör det med `--dry` först. Alla jobbskript har det läget.

**Rapportera utfall ärligt.** Misslyckas ett test, säg det med utdata. Hoppade du över ett steg, säg
det. Skriv aldrig "verifierat" om du bara läst koden.

## Kommandon

```bash
npm install                                     # --legacy-peer-deps vid peer-konflikt
npm run dev                                     # utveckling
npm run build && npx next start                 # produktionsbygge lokalt
npx vitest run tests/unit/<fil>.test.ts         # ett testfilspaket
node scripts/with-prod-db.mjs npx tsx scripts/<x>.ts   # ETT skript mot prod-DB
```

DEV-databasen är en lokal PostgreSQL 18 som Windows-tjänst (`postgresql-x64-18`, db `pokefinds`) —
ingen Docker behövs. PROD är Neon (Frankfurt).

## Git och deploy

- **`git push origin main` deployar till produktion.** Verifiera först. Är du på main och osäker —
  gör en gren.
- Railways `build.watchPatterns` hoppar över `.github/`, `.claude/`, `docs/`, `tests/`, `ios/`,
  `android/` och `*.md`. En push som bara rör dem deployar alltså INTE (varje deploy nollar cachen).
- Commit-meddelanden är på svenska och förklarar **varför**, inte vad diffen redan visar. Mät om du
  påstår något ("mätt 2026-09-09: 0 av 18").
- Ägaren har gett stående tillåtelse att commita och pusha utan att fråga — men bara efter
  verifiering, och aldrig för något ofärdigt som blir synligt för användare.

## Gränser du inte överskrider utan att fråga

- Ändra inte `.railway/railway.ts`, `Dockerfile`-taken eller autosuspend-inställningar utan att lägga
  fram konsekvensen. Ett fel där har kostat 6,5 timmars nedtid.
- Slå inte på pausade funktioner (restock-larm, prislarm) — de är pausade av mätta skäl.
- Lansera inte grindat innehåll (community v2, nyhetsflödet). Grindarna är ägarbeslut.
- Radera aldrig produktrader för att "städa" — `hiddenAt` är normalvägen; en radering tystar
  Discord-lanen permanent.

## Regelverk per delsystem — läs rätt fil

`.claude/rules/*.md`. Öppna den som matchar filerna du rör.

| Fil | Gäller | Hårdaste regeln |
|---|---|---|
| `scraping-restock.md` | `src/scrapers/**` | Shopifys `available` ≠ köpbar; frånvaro ur feeden kollas, tolkas inte |
| `discord-restock.md` | Discord-lanen | Lanen är gratis på villkor — den når ALDRIG databasen |
| `matching-import.md` | katalogimport, matchning | `OTHER` var det enda som höll skräpet ute — härda vakterna före en vidgning |
| `catalog-curation.md` | katalogstädning | Denylist FÖRE apply; identiteten måste överleva normaliseringen |
| `cm-pricing.md` | Cardmarket-priser | Singlar = CM engelska NM-"From" rakt av; guiden är INTE CM:s From |
| `base-printings.md` | tryckningsvarianter | Tryckningen är identitet, inte en prisnivå |
| `jp-sets.md` | japanska set | Namnuppslag MÅSTE filtrera på `language` |
| `scanner.md` | `src/services/scanner/**` | Numret är identiteten; läs `docs/SCANNER-STATUS.md` först |
| `grading.md` | AI-gradering | `maxOutputTokens` är taket för TÄNKANDE + SVAR på Gemini 3 |
| `auth-accounts.md` | inloggning, konton | En cookie som JS skriver har inte den livslängd du anger |
| `billing-entitlements.md` | Pro, Stripe, RevenueCat | Glöms grenen i `proUserWhere()` får kunden Pro i UI:t men inga larm |
| `alerts-setwatch.md` | larm, set-bevakning | Regeln utvärderas vid LARMTILLFÄLLET, i BÅDA vägarna |
| `marketplace-tradera.md` | Tradera, graderat | Graderat är en EGEN vara — domen tas på annonsen, aldrig på kategorin |
| `catalog-browse.md` | `/produkter`, sök | Ofiltrerad katalog personaliseras ALDRIG |
| `collection-portfolio.md` | samling, portfölj | Poster (lots), aldrig ett snitt i databasen; TRE set-tal som aldrig blandas |
| `ui-shell.md` | `src/components/**`, layouter | Porträttlås; bredd ensam ≠ desktop; min-height drar av spacer + safe-area |
| `admin-ops.md` | admin | Tre utfall, aldrig två: kostnadsförd / gratis / OMÄTT |
| `legal-copy.md` | villkor, policy | Ångerrätten är den PROPORTIONELLA modellen |
| `community-v2.md` | forum, meddelanden | Grindat tills ägaren testat; chatten pollar ALDRIG Neon |
| `news-events.md` | `/nyheter`, `/evenemang` | Flödet är en fil på volymen, aldrig en tabell; artikeltext återges aldrig |

## Var saker bor

```
src/app/[locale]/          rutter (routegrupper: (marketing) (app) (mer) (scan) (auth) (portfolio))
src/components/            features/ · layout/ · ui/
src/lib/                   ren logik och domar — testbart, inga sidoeffekter
src/services/              DB-nära affärslogik
src/scrapers/              butiksadaptrar + runner
scripts/                   engångs- och jobbskript (kör med `npx tsx`, alla har --dry)
prisma/schema.prisma       datamodellen
tests/unit/                vitest — vakterna som fångar återfall
.claude/rules/             delsystemsreglerna
.github/workflows/         all automatik
docs/                      SETUP.md, LAUNCH-CHECKLIST.md, TODO.md, SCANNER-STATUS.md
```

## Arbetssätt

- **Gör det som efterfrågas, hela vägen.** Krymp inte uppdraget, vidga det inte. Blir en del blockerad
  — gör resten klart och säg tydligt vad du lämnade och varför.
- **Mät i stället för att gissa.** Det här projektet har en lång rad beslut som vändes när någon
  faktiskt mätte. Har du ett antagande som styr designen: verifiera det, och skriv talet i koden.
- **En sanning, ett ställe.** Två ställen som räknar samma sak blir förr eller senare två svar. Domar
  bor i `src/lib/`, delas av jobbet och appen, och testas.
- **Fail-safe åt rätt håll.** En osatt variabel ska ge det säkra läget: pausat, dolt, "vi vet inte".
