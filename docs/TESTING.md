# Test-guide

## Unit-tester (vitest)
```bash
npm test            # kör alla
npm run test:watch  # watch-läge
```
71 tester i `tests/unit/`: prisformatering, normalisering, fuzzy-matchning, samlingsvärde, CSV import/export, alert-logik (mockad Prisma), e-postmallar. Ingen databas krävs.

## E2E-tester (Playwright)
Kräver: databas igång + seedad (`npx prisma db seed`).
```bash
npx playwright install chromium   # första gången
npm run test:e2e
```
- `tests/e2e/smoke.spec.ts` — landningssida, katalog, inloggningssida, priser
- `tests/e2e/auth.spec.ts` — inloggning med demo@pokefinds.se → dashboard

Playwright startar dev-servern automatiskt (`playwright.config.ts`).

## Manuell testning
Se README "Testa appen" — demokonton, flöden för bevakning, restock-simulering via admin → "Kör nu".
