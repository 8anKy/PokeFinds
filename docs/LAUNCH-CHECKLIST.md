# Foilio — Launch-readiness & cost-at-scale checklist

> Living tracker. Tick `- [x]` when verified. Items marked **VERIFY** are unconfirmed —
> don't trust the checkbox until someone actually tests it. Conventions/facts live in CLAUDE.md.
>
> The thing the user cares about most: **costs must not balloon when many people use the
> site at once** (clicking offers, browsing, scanning). That is **Section 0** — read it first.
> Everything below it is the generic launch checklist, kept for completeness.

---

## 0. Cost hotspots under concurrent load (PROJECT-SPECIFIC — the priority)

Every item here is "what costs money per user action". Free-tier ceilings: Vercel Fluid
Active CPU (4h/mo), Vercel Function Invocations (1M/mo), Neon CU-hrs + 5 GB/mo transfer.

**Done**
- [x] Public catalog pages cached (ISR) — `/`, `/marknad`, `/sets` static; `/sets/[id]`,
      `/produkter/[slug]` on-demand ISR (`revalidate=3600` + `generateStaticParams`). A cached
      page view = **0 functions, 0 Neon queries**. Verified live (`X-Vercel-Cache: HIT`). 2026-06-20.
- [x] Chrome reads session client-side (no server `auth()` in root/marketing layout or header)
      so caching isn't defeated. See CLAUDE.md "Caching/ISR".
- [x] `restock-watch` cron 2h → 4h (was keeping Neon compute from scaling to zero).
- [x] In-process scrape/restock loops OFF on Vercel; all batch jobs run on GitHub Actions (free).
- [x] Heavy chart lib (recharts) lazy-loaded (`PriceChartLazy`); product page price-period
      filtered in-browser from one payload (no per-period API call).

**Open — each is a Neon read and/or function call PER user action**
- [ ] **Offers refetch on every product-page view** — `LivePricingProvider` fires one
      `/api/products/[slug]/offers` (→ Neon) on mount, even on cached pages. Prices change ~daily;
      cached page is ≤1h fresh. Option: drop the auto-refetch, rely on ISR data (loses the live
      price "flash"). **Biggest remaining per-view cost on the busiest page type.**
- [ ] **`/produkter` is dynamic** (reads `searchParams`) — every filtered/sorted/paged view =
      1 function + Neon query. Unavoidable for arbitrary filters, but the *default* unfiltered
      view (most bots/first hits) could be special-cased to a cached variant. **VERIFY** worth it.
- [ ] **All `/api/*` routes are `force-dynamic`** — every call = function invocation + Neon.
      Hot ones: `/api/products/feed` (infinite-scroll), `/api/products/[slug]/offers`,
      `/api/market/*`, `/api/collection/value`. Add short `Cache-Control: s-maxage` to the
      *public, non-personalized* ones (feed, market, prices) so repeat/bot hits serve from CDN.
- [ ] **Rate limiting** — none in front of expensive endpoints (scanner, grading, feed, offers).
      One abusive client or crawler can burn Vercel functions + Neon + Claude API budget. Add
      per-IP limits on `/api/scanner/*`, `/api/grading/*`, and the feed.
- [ ] **Claude API cost** — `/skanna` (vision OCR) and `/gradera` cost real $ per call. FREE tier
      daily limit exists (`GRADING_FREE_DAILY_LIMIT`); confirm the scanner has an equivalent cap
      and that limits are enforced server-side, not just UI. **VERIFY**.
- [ ] **RapidAPI (Cardmarket) quota** — 3000/day; full refresh ~1100 + hot-card 800. Known and
      bounded by cron, not user traffic. Watch it doesn't get exceeded (see price-history memory).
- [ ] **Neon 5 GB/mo transfer cap** — caching should cut egress a lot; re-check the meter in a
      few days before changing plan. (docs/HOSTING.md)
- [ ] **Collection value live-compute** (`/samling`, `/dashboard`) — recomputes value across many
      items per load (CPU + N Neon reads). Personalized so can't ISR; consider memoizing per-user
      for a few minutes if it shows up in the CU graph. **VERIFY** cost.
- [ ] **Image egress** — product/set images: confirm they're served from a CDN / external host,
      not proxied through Vercel functions or Neon. **VERIFY**.
- [ ] **Load test** before any real launch push — hit `/produkter` feed + a product page +
      `/api/products/[slug]/offers` concurrently and watch which meter moves first.

---

## 1. Product readiness
- [x] Sign up / login / logout (NextAuth credentials + JWT)
- [x] Password reset / recovery (`/glomt-losenord`, `/aterstall-losenord`, forgot/reset routes)
- [ ] Checkout / payments — **N/A** (Stripe disabled `STRIPE_ENABLED=false`)
- [x] Search, filters, forms, uploads (catalog filters, scanner upload)
- [ ] **Emails actually deliver in prod** — currently console/JSON mode, no SMTP. Restock/alert
      email is coded but **not sent** until Resend is wired (see memory `project_resend_email_setup`). **BLOCKER for any email-dependent flow.**
- [x] Empty / loading / error states (`EmptyState`, lazy loaders)
- [x] Mobile / tablet / desktop layouts (responsive + bottom tabs on mobile)
- [ ] Cross-browser: Chrome / Safari / Firefox / Edge — **VERIFY**
- [x] Onboarding (`/onboarding`)
- [x] Terms / privacy / cookie banner (`/villkor`, `/integritetspolicy`, `/cookies`, `CookieBanner`)

## 2. Performance
- [x] Caching + CDN (Vercel edge + ISR — Section 0)
- [x] Lazy loading where it matters (charts, images `loading="lazy"`)
- [x] Bundle: recharts code-split
- [ ] API response times under load — **VERIFY** (load test)
- [ ] DB query performance / N+1 audit on hot pages — **VERIFY**
- [ ] Image/video optimization (sizes, formats) — **VERIFY**
- [ ] Mobile performance on slow networks — **VERIFY**

## 3. Reliability & uptime
- [ ] Uptime monitoring — **VERIFY** (none known)
- [ ] Error monitoring (e.g. Sentry) — **VERIFY** (none known)
- [ ] Alerts (outage, high latency, high error rate) — **VERIFY**
- [x] Graceful third-party degradation (Redis optional, email self-heals, jobs guard on missing secrets)
- [x] Backups — Neon automatic; **VERIFY** restore actually works
- [x] Rollback plan — `vercel` keeps previous deployments; redeploy/promote prior build
- [ ] Staging environment mirroring prod — **VERIFY** (none known; only local + prod)

## 4. Security
- [x] HTTPS everywhere (Vercel)
- [x] Secure auth + sessions (NextAuth JWT)
- [x] Input validation (Zod on API boundaries)
- [x] SQL injection safe (Prisma parameterized)
- [x] Secrets not in Git; env separated per environment
- [x] Admin routes role-gated (RBAC `role`, `requireRole`)
- [ ] **Authorization / IDOR test** — can User A read User B's data by changing an ID? Test
      `/api/collection/[id]`, `/api/watchlist/[id]`, etc. **VERIFY — do this carefully.**
- [ ] Rate limiting / brute-force protection — **MISSING** (see Section 0)
- [ ] File upload restrictions (scanner) — type/size limits enforced? **VERIFY**
- [ ] Dependency vulnerability scan (`npm audit`) — **VERIFY**
- [ ] CSRF / XSS review — **VERIFY** (NextAuth + React give baseline; audit custom forms)

## 5. Data & database
- [x] Prisma migrations tested (local + prod)
- [x] GDPR export + delete (`/api/users/me/export`, deletion path — required to work)
- [x] No live test data in prod (seed passwords rotated)
- [ ] Indexes on frequently-queried fields — **VERIFY** (review schema vs hot queries)
- [x] Backups automated (Neon); **VERIFY** restore drill
- [ ] Audit logs for sensitive actions — **VERIFY**

## 6. Infrastructure & deployment
- [x] Prod deploy process (`vercel --prod`, author = milostheboss123@gmail.com)
- [x] Domain / DNS / SSL (foilio.se aliased, HTTPS)
- [x] CDN (Vercel)
- [x] Env vars set per environment
- [x] Reproducible build (`npm run build` green)
- [x] Quick rollback (previous Vercel deployments)
- [ ] CI/CD pipeline (auto build/test on push) — **VERIFY** (only scheduled jobs in Actions today)
- [ ] Feature flags for risky features — partial (env toggles like `STRIPE_ENABLED`)
- [ ] Staging separated from prod — **VERIFY**

## 7. Observability
- [ ] Request volume / error rate / latency dashboards — **VERIFY** (Vercel + Neon dashboards exist; no app-level APM)
- [ ] DB load / CU graph watched — partly (manual Neon dashboard checks)
- [ ] Failed jobs / queue depth visibility — **VERIFY**
- [ ] Email delivery failures — blocked on email setup
- [ ] Signup / conversion funnel analytics — **VERIFY** (see Section 13)

## 8. Payments, billing, legal
- [ ] Payments — **N/A** (Stripe off). Revisit all sub-items when enabling Stripe.
- [x] Privacy policy / Terms / Cookie policy pages
- [x] GDPR: export + delete + data minimization (project rule)
- [ ] Data processing agreements with vendors (Neon, Vercel, RapidAPI, Anthropic, Resend) — **VERIFY**
- [ ] Email marketing consent — **VERIFY** when email goes live

## 9. Accessibility
- [x] Form labels, focus states, semantic nav (aria-labels present in header/tabs/tables)
- [ ] Keyboard navigation full pass — **VERIFY**
- [ ] Color contrast audit (dark theme) — **VERIFY**
- [ ] Alt text on meaningful images — **VERIFY**
- [ ] Screen reader pass — **VERIFY**
- [ ] No hover-only critical interactions — **VERIFY**

## 10. SEO & discoverability
- [x] Page titles + meta descriptions (per-page `metadata` / `generateMetadata`)
- [x] Open Graph / social images (root + product OG)
- [x] Sitemap (`sitemap.ts`) + robots.txt
- [x] SSR/prerender for SEO (now ISR-cached, fast)
- [x] 404 handling (`notFound()`)
- [ ] Canonical URLs — **VERIFY**
- [ ] Structured data (JSON-LD) — partial (product `AggregateOffer` present); extend if useful
- [ ] Confirm preview/staging not indexable, prod indexable — **VERIFY**

## 11. Content & brand polish
- [ ] Typos / placeholder text / outdated screenshots pass — **VERIFY**
- [ ] Broken links — **VERIFY**
- [x] Favicon + social preview image (manifest + icons configured)
- [ ] Pricing clarity (`/priser`) — **VERIFY** (esp. since Stripe is off)
- [x] FAQ / help (landing FAQ)
- [ ] Contact / support info visible (`/kontakt`) — **VERIFY** it routes somewhere real

## 12. Support & operations
- [ ] Where users report bugs + who responds — **DEFINE**
- [ ] Incident response owner + runbook — **DEFINE**
- [x] Admin tools for user/account support (admin panel: users, offers, sources, reports)
- [ ] Status page — optional

## 13. Analytics & business metrics
- [ ] Core funnel tracked (visitors → signup → activation → retention) — **VERIFY** (no analytics known)
- [ ] Feature usage / drop-off — **VERIFY**
- [ ] Events tested before launch — **VERIFY**

## 14. Scalability
- [x] Stateless app (JWT sessions, no server-side session store needed)
- [x] Background jobs separated from web (GitHub Actions)
- [x] Reads cacheable / cached (ISR — Section 0)
- [x] Static assets via CDN (Vercel)
- [x] Bottleneck known (Neon CU + transfer; Vercel Active CPU)
- [ ] File uploads in object storage, not local disk — **VERIFY** (scanner)
- [ ] Rate limits + per-user quotas (uploads, scans, requests) — **MISSING** (Section 0)
- [x] Third-party API limits understood (RapidAPI 3000/day, Claude tiered)
- [ ] Horizontal scaling validated (Vercel scales functions; Neon compute autoscales .25–8 CU) — **VERIFY** under load

## 15. Pre-launch test plan
- [x] Smoke test after deploy (done 2026-06-20 for caching change)
- [ ] Regression test (old features still work) — **VERIFY**
- [ ] Cross-browser + mobile test — **VERIFY**
- [ ] Payment test — N/A (Stripe off)
- [ ] Email test — blocked on email setup
- [ ] Security / authorization test — **VERIFY** (Section 4 IDOR)
- [ ] Accessibility test — **VERIFY**
- [ ] Load test — **VERIFY** (Section 0)
- [ ] Backup restore test — **VERIFY**
- [ ] Rollback test — **VERIFY**
- [ ] Real-user beta test — **VERIFY**

## 16. Launch-day checklist
- [ ] Freeze risky changes
- [ ] Confirm monitoring dashboards + alerts (needs Section 3/7 first)
- [ ] Confirm backup completed
- [ ] Confirm support contact visible
- [ ] Confirm analytics working (needs Section 13)
- [ ] Confirm DNS / domain / SSL (currently OK)
- [ ] Confirm rollback command ready (`vercel` redeploy prior)
- [ ] Someone watching logs + error monitoring during launch
