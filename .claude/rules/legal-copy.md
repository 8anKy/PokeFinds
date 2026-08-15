---
paths:
  - "src/translations/**"
  - "src/app/villkor/**"
  - "src/app/integritetspolicy/**"
  - "src/app/cookies/**"
  - "src/app/om/**"
  - "src/app/kontakt/**"
  - "src/app/api/billing/checkout/**"
---
# Legaltexter, villkor och rankningstransparens
- **HELA LEGALPAKETET OMSKRIVET OCH PUBLICERAT 2026-08-08 — juristgranskning återstår**: nya villkor
  (20 avsnitt: AI-utfall, larm-förbehåll, Tradera-sälj, Discord, rankningstransparens, ångerrätt,
  ansvarstak, inbjudningsvillkor, språkföreträde), omskriven integritetspolicy (alla mottagare
  deklarerade: Stripe, Google/Gemini, RevenueCat, Railway; sektion 7b för självständigt ansvariga —
  ⛔ Discord/Tradera/appbutikerna får ALDRIG in i biträdeslistan, den påstår biträdesavtal), rättad
  cookiepolicy (samtyckesvalet ligger i localStorage, inte i en cookie), "Så rankar vi" på /om
  (länkad från sorteringsarket per EU:s omnibusregler), företagsblock på /kontakt.
  Gamla villkoren PÅSTOD att annonslänkar finns och är märkta (falskt — affiliate är inte aktivt,
  ägarbeslut 2026-08-08: inte planerat heller) och att listan alltid sorteras på lägsta pris (falskt).
  ⛔ **ODR-hänvisningen är BORTTAGEN med flit** — EU-plattformen lades ner 2025-07-20 (förordning (EU)
  2024/3228). Lägg aldrig tillbaka den. ⛔ **Ångerrätten är den PROPORTIONELLA modellen** (pro rata vid
  ånger, digital tjänst-tolkningen) och checkout-samtyckestexten i `billing/checkout` säger SAMMA sak —
  de är en mekanism, ändra dem tillsammans. ⛔ Skäligt bruk-nyckeln heter nu `Terms.s11FairUse` (f.d.
  s6FairUse), vaktad mot `PREMIUM_FAIR_USE` av `tests/unit/terms-fair-use-sync.test.ts`.
  Sponsring (ägarbeslut): märkta placeringar som ALDRIG påverkar rangordningen — löftet står i både
  villkor §8 och /om. Status + assistentbeslut att pröva med jurist: `../PokeFinds-private/docs/
  TERMS-GAP.md` (statusblocket överst). Kvar: F2 (datalicenser, egen utredning) och community-klausulen
  (publiceras först när community lanseras — utkast §13 i TERMS-DRAFT-CLAUSES.md).
