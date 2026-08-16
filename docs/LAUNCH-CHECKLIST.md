# Foilio — Launch-readiness checklist

> Skriven 2026-06-29 efter en pre-release-revision, **uppdaterad 2026-08-16** (sajten är
> LIVE på foilio.se sedan dess; iOS-appen är släppt). Bocka `- [x]` när något är
> VERIFIERAT. Durabla fakta bor i CLAUDE.md; revisionskontext i minnesfilerna.
>
> ⛔ **Skriv aldrig en status du inte kan verifiera.** Värden som bara finns i Railways
> miljövariabler går inte att läsa ur repot — skriv "overifierad" i stället för att gissa.

---

## Section 0 — Hetspunkter vid samtidig trafik

De fyra punkterna nedan är de kända ställen där kostnaden eller stabiliteten skalar med
ANTALET SAMTIDIGA BESÖKARE i stället för med datamängden. De är inte buggar — tre av dem
är medvetna avvägningar — men de är det som ger vika först vid en trafikspik, och de är
den lista CLAUDE.md och `src/app/api/scanner/identify/route.ts` hänvisar till.

### 0.1 Offers-refetch per produktvisning — ÖPPET ÄGARBESLUT (kostnad)
Offer-tabellens lagerstatus kan släpa upp till 1 h. `LivePricingProvider` hämtar **aldrig**
själv; `refresh` är adminens knapp. Att stänga glappet betyder en fetch per produktvisning,
dvs. en Neon-väckning som annars aldrig hade skett — och en väckning kostar minst 300 s
debiterad tid. **Frågan är ställd till ägaren, inte avgjord.** Fixa inte "i förbifarten".

### 0.2 `force-dynamic` på API-routerna
79 av 94 `route.ts` under `src/app/api/` deklarerar `force-dynamic` (mätt 2026-08-16).
Varje anrop går då förbi CDN-cachen och når appen — och de som rör DB:n väcker Neon.
⚠️ Flera av dem MÅSTE vara dynamiska (auth, mutationer, webhooks). Det som saknas är en
genomgång av vilka som är publika GET-svar och kunde ha cache-headers i stället.
⛔ Gäller INTE sidorna: publika läs-sidor är ISR (`revalidate=3600`) och `force-dynamic`
får aldrig tillbaka dit.

### 0.3 Ingen generell rate limiting
21 av 94 API-router kallar `rateLimit()` (mätt 2026-08-16) — inloggning, registrering,
skanner, gradering, community, klick-spårning. Resten är ogrindade: det finns ingen
plattformsbred gräns, bara punktinsatser på de dyra vägarna. En bot som hamrar en
ogrindad, DB-rörande route kan hålla Neon vaken utan att någon larmar.
Limitern är distribuerad när `REDIS_URL` är satt (Upstash, Frankfurt), annars in-memory
per instans.

### 0.4 Samlingsvärde räknas live
`computeCollectionValue()` (`src/services/collection.ts`) räknar om vid **varje** anrop —
ingen `unstable_cache`, ingen lagrad summa. Den anropas från `/dashboard`, `/samling`,
publika profilsidor och `/api/collection/value`. En användare med stor samling som laddar
om ofta betalar i vaken Neon-tid. (Personaliserade svar cachas 60 s i `services/products.ts`;
samlingsvärdet gör det inte.)

---

## ✅ Klart & verifierat
- **Security headers** — HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy (`next.config.mjs`).
- **Image-optimizer låst** — `images.remotePatterns` = `images.pokemontcg.io` (appen
  använder ändå inte `next/image`).
- **Brute-force-broms på inloggning** — `rateLimit(login:email, 10/5min)` i NextAuth
  `authorize`.
- **Distribuerad rate-limit** — Upstash Redis (Frankfurt) via `REDIS_URL`. Se dock 0.3:
  limitern finns, den är inte påsatt överallt.
- **Felövervakning** — Sentry server+edge via `SENTRY_DSN` (EU). Ingen klient-SDK → 0
  bundle-kostnad. ⚠️ Hänger på att `next.config.mjs` följer med i runner-imagen.
- **Next.js 14.2.x** — senaste stabila 14.x med säkerhetsbackports.
- **Integritetspolicy** — namnger underbiträden (Neon/EU, Railway, Resend/US,
  Anthropic/US) + AI-bilddeklaration. ⛔ **Inte juristgranskad**, och Stripe, Google/Gemini
  och Tradera behandlar personuppgifter i prod utan att stå i policyn (se CLAUDE.md).
- **nodemailer borta** — prod skickar via Resends HTTP-API; rensade 6 SMTP-CVE:er.
- **IDOR** — collection/watchlist/community-tjänsterna kontrollerar ägarskap före mutation.
- **Auth** — bcrypt, JWT-sessioner, admin-routerna rollgrindade (RBAC).
- **Validering** — Zod på alla API-gränser; Prisma (ingen SQLi).
- **GDPR** — export (`/api/users/me/export`) + kontoradering med kaskad; dataminimering.
- **Analys** — enbart förstapart, strippar userId/email/ip. Påståendet "ingen
  tredjepartsspårning" är SANT.
- **Cachning** — ISR på publika sidor, CDN-cachade publika GET-API:er (se 0.2).
- **Neon-kostnadsrunda (2026-07-07)** — computeChanges aggregerar i SQL + delad 1h-cache;
  startsidans showcase-groupBy cachad 24h; `/produkter`-facetter cachade 1h; restock-lanen
  läser källistan ur en diskcache; robots.txt blockerar facett-crawling; sitemap med
  veckovis changefreq.
- **Skankostnad** — uppladdningar nedskalas klientsidan till 1280 px. Uppmätt 2026-08-15:
  0,7–0,96 öre/skan, ~90 % bild-input. Optimera inte vidare utan ny mätning.
- **Tester** — **134 testfiler, 1624 enhetstester, alla gröna** (mätt 2026-08-16 med
  `npx vitest run`). Den gamla siffran "215 unit tests" var från juni.
- **CI-grind** — `.github/workflows/ci.yml` kör vitest + lint + `next build` på Node 22
  (samma major som Dockerfilen) mot en riktig migrerad Postgres, plus ett separat
  Playwright-smoke-jobb.
- **Utgiftstak** — Anthropic / Neon / Railway satta i respektive dashboard.
- **Health-endpoint** — `/api/health` (bara liveness, ingen DB-ping → väcker inte Neon).
- **Domän** — apex `foilio.se` kanonisk; `www` är en Cloudflare-301. ⛔ Maskinella URL:er
  (Stripe-webhook, OAuth-redirects, `/api/revalidate`) måste peka på apex — en 301 är
  gratis bara för webbläsare.

## 🧑 Ägaråtgärd
- [ ] **Uptime-monitor** — peka UptimeRobot/BetterStack på `https://foilio.se/api/health`
      (apex, inte www — annars övervakas redirecten, inte appen).
- [ ] **Bekräfta att ett riktigt larmmejl levereras** i prod (Resend) — end-to-end.
- [ ] **Stripe: provköp end-to-end** — koden är komplett och testad, men ett skarpt köp
      hela vägen genom webhooken är fortfarande inte gjort (CLAUDE.md).
- [ ] **Rotera APNs-nyckeln.**
- [ ] **Cross-browser / riktiga enheter** — Safari, Chrome, Firefox; iOS- och Android-skalen.
- [ ] **Neon backup-restore-övning** — bekräfta att en återställning faktiskt fungerar.
- [ ] **Lasttest** — `node scripts/load-test.mjs https://foilio.se` med Neon CU +
      Railway-metrics uppe. Titta särskilt på Section 0.

## 🟡 Uppskjutna beslut / nice-to-have
- [ ] **Next 14 → 16** — npm:s advisory-DB markerar bara Next-CVE:erna som fixade i v16
      (brytande). 14.2.x bär backports och de flesta flaggade CVE:erna gäller inte oss
      (ingen i18n-router, inga WebSocket-uppgraderingar, inget `next/image`). Rekommendation:
      **skjut upp**, gör som eget uppdrag.
- [ ] **Funnel-analys** (signup → aktivering → retention) — finns inte; förstaparts
      event-tabell finns att bygga på.
- [ ] **Kvarvarande npm audit-highs** — node-forge (via push/node-apn), tar/glob/esbuild
      (dev/transitiva). CI kör `npm audit` informativt, det blockerar inte.
- [ ] **a11y-runda** — tangentbordsnavigering, kontrast, alt-texter, skärmläsare.
- [ ] **Strikt CSP** — nuvarande headers saknar script/style-CSP (kräver nonces; eget jobb).
- [ ] **`traderaToken`-kryptering** — kvar sedan publik-launch-revisionen 2026-08-09.

## 💳 Betalningar — Stripe
⚠️ **Inte längre "N/A".** Stripe web-Pro finns i koden och är komplett: `src/lib/stripe.ts`
(`stripeEnabled()`), `/api/billing/checkout`, `/api/billing/portal` och
`/api/webhooks/stripe`. Prenumerationen är 49 kr/mån.

- `STRIPE_ENABLED` läses **både vid bygget och i runtime** — `/priser` är statiskt
  genererad, så knappens utseende kräver en OMBYGGNAD, medan checkout-routen läser spaken
  i runtime (nödstoppet är alltså omedelbart).
- ⛔ **Spakens värde i prod går inte att verifiera ur repot** — det bor i Railways
  miljövariabler. Enligt CLAUDE.md/minnet är webbens Pro LIVE; bekräfta i Railway innan
  du agerar på det.
- ⛔ **Stripe skriver ALDRIG `planTier`** — entitlement läses via `proUserWhere()`/`isPro()`.
  Glöms en gren där får kunden Pro i UI:t men INGA larm (`.claude/rules/billing-entitlements.md`).
- Öppet: provköp end-to-end (se Ägaråtgärd), och Stripe saknas i integritetspolicyns
  underbiträdeslista.
