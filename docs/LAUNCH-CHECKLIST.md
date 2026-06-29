# Foilio — Launch-readiness checklist

> Rewritten 2026-06-29 after a full pre-release audit. Reflects CURRENT reality
> (Railway host, Resend email live, Redis + Sentry wired). Tick `- [x]` when verified.
> Durable facts live in CLAUDE.md; audit context in memory `project_launch_readiness_audit`.

## ✅ Done & verified
- **Security headers** — HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (`next.config.mjs`).
- **Image-optimizer locked** — `images.remotePatterns` = `images.pokemontcg.io` only (no `next/image` used anyway).
- **Login brute-force throttle** — `rateLimit(login:email, 10/5min)` in NextAuth `authorize`.
- **Distributed rate-limit** — Upstash Redis (Frankfurt) via `REDIS_URL`; limiter auto-uses it. Verified (Upstash Commands counter moves).
- **Error monitoring** — Sentry server+edge via `SENTRY_DSN` (EU region). No client SDK → 0 bundle cost.
- **Next.js 14.2.35** — latest stable 14.x with security backports.
- **Privacy policy** — names sub-processors (Neon/EU, Railway, Resend/US, Anthropic/US) + AI image disclosure.
- **nodemailer removed** — prod sends via Resend HTTP; cleared 6 SMTP CVEs.
- **IDOR** — collection/watchlist/community services check ownership before mutate.
- **Auth** — bcrypt hashing, JWT sessions, admin routes role-gated (RBAC).
- **Validation** — Zod on all API boundaries; Prisma (no SQLi).
- **GDPR** — export (`/api/users/me/export`) + account delete cascades; data minimization.
- **Analytics** — first-party only, strips userId/email/ip. "No third-party tracking" claim is TRUE.
- **Caching** — ISR on public pages, CDN-cached public GET APIs.
- **Tests** — 138 unit tests green; `npm run build` green.
- **Spend caps** — Anthropic / Neon / Railway set in dashboards (the hard budget backstop).
- **Health endpoint** — `/api/health` (liveness only, no DB ping → doesn't keep Neon awake).

## 🧑 Owner action before launch
- [ ] **Uptime monitor** — point UptimeRobot/BetterStack at `https://www.foilio.se/api/health`.
- [ ] **Confirm a real alert email delivers** in prod (Resend) — end-to-end, to a real inbox.
- [ ] **Cross-browser / real-device** — Safari, Chrome, Firefox; iOS + Android app shells.
- [ ] **Neon backup-restore drill** — confirm a restore actually works.
- [ ] **Load test** — `node scripts/load-test.mjs https://www.foilio.se` while watching Neon CU + Railway metrics.

## 🟡 Deferred decisions / nice-to-have
- [ ] **Next 14 → 16 migration** — npm's advisory DB only marks the Next CVEs fixed in v16 (breaking). 14.2.35 carries backports and most flagged CVEs don't apply (no i18n, no WebSocket upgrades, no `next/image`). Recommendation: **defer**, do post-launch as its own task.
- [ ] **Funnel analytics** (signup → activation → retention) — none yet; first-party events table exists to build on.
- [ ] **Remaining npm audit highs** — node-forge (via push/node-apn), tar/glob/esbuild (dev/transitive). Lower priority.
- [ ] **a11y pass** — keyboard nav, contrast, alt text, screen reader.
- [ ] **Strict CSP** — current headers omit a script/style CSP (needs nonces; own task).

## N/A
- Payments / Stripe — disabled (`STRIPE_ENABLED=false`). Revisit all billing/legal sub-items if enabled.
