// Railways projektkonfiguration (Infrastructure as Code) — ersätter railway.json, som
// Railway slutar läsa 2026-12-01. Importerad med `railway config pull` 2026-09-02;
// env-värdena är preserve() = "behåll det som ligger i Railway", inga hemligheter här.
//
// Ändra → förhandsgranska → applicera (från PowerShell — i Git Bash pekar $_ på en
// MSYS-sökväg som SDK:ns versionskoll inte kan köra):
//   $env:PATH = "C:/Users/<du>/AppData/Roaming/npm/node_modules/@railway/cli/bin;" + $env:PATH
//   railway config plan   # läser bara
//   railway config apply  # skriver till tjänstens inställningar efter bekräftelse
// Filen är sanningen för tjänstens inställningar; dashboard-ändringar syns som drift i plan.
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const pokefindsVolume = volume("pokefinds-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const PokeFinds = service("PokeFinds", {
    source: github("8anKy/PokeFinds", { checkSuites: false }),
    replicas: { "europe-west4-drams3a": 1 },
    // ⛔ ALWAYS, aldrig ON_FAILURE med retry-tal: självåtervinningen (src/lib/memory-recycle.ts)
    // avslutar processen med exit(1) flera gånger per dygn, och ett retry-tal som inte
    // nollställs lämnade sajten nere 6,5 h 2026-08-31. App Sleeping ska vara AV (Railways
    // default; lagras som null, så `sleepApplication: false` här ger evig drift i plan) —
    // det hade kastat ISR-cachen i minnet vid varje väckning.
    deploy: { restartPolicyType: "ALWAYS" },
    // Pushar som bara rör workflows, docs, tester, agentregler, native-mapparna eller
    // Markdown skapar ingen deploy — varje deploy nollar FETCH-cachen (BUILD_ID) och
    // kostar kalla Neon-läsningar (9 deployer/dygn mätt 2026-09-01). gitignore-syntax:
    // en inkluderande regel MÅSTE stå före !-reglerna, annars deployar inget alls.
    build: {
      watchPatterns: ["**", "!/.github/**", "!/.claude/**", "!/docs/**", "!/tests/**", "!/ios/**", "!/android/**", "!/**/*.md"],
    },
    domains: ["foilio.se"],
    networking: { privateNetworkEndpoint: "pokefinds" },
    volumeMounts: { "/data": pokefindsVolume },
    env: { ANTHROPIC_API_KEY: preserve(), APNS_BUNDLE_ID: preserve(), APNS_KEY: preserve(), APNS_KEY_ID: preserve(), APNS_PRODUCTION: preserve(), APNS_TEAM_ID: preserve(), APPLE_CLIENT_ID: preserve(), APPLE_KEY_ID: preserve(), APPLE_PRIVATE_KEY: preserve(), APPLE_TEAM_ID: preserve(), CARDMARKET_RAPIDAPI_HOST: preserve(), CARDMARKET_RAPIDAPI_KEY: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), DISCORD_BOT_TOKEN: preserve(), DISCORD_CLIENT_ID: preserve(), DISCORD_CLIENT_SECRET: preserve(), DISCORD_ENABLED: preserve(), DISCORD_GUILD_ID: preserve(), DISCORD_ROLE_PRO: preserve(), DISCORD_ROLE_VERIFIED: preserve(), EMAIL_FROM: preserve(), EMAIL_MODE: preserve(), GEMINI_API_KEY: preserve(), GOOGLE_CLIENT_ID: preserve(), GOOGLE_CLIENT_SECRET: preserve(), GOOGLE_IOS_CLIENT_ID: preserve(), GRADING_PROVIDER: preserve(), LEGAL_ENTITY_ADDRESS: preserve(), LEGAL_ENTITY_EMAIL: preserve(), LEGAL_ENTITY_NAME: preserve(), LEGAL_ENTITY_VAT: preserve(), MEMORY_RECYCLE_EMERGENCY_MB: preserve(), NEON_DATABASE_URL: preserve(), NEXTAUTH_SECRET: preserve(), NEXTAUTH_URL: preserve(), NEXT_PUBLIC_APP_NAME: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_RC_IOS_KEY: preserve(), NEXT_PUBLIC_SIGNUP_BONUS_MONTHS: preserve(), NEXT_PUBLIC_SIGNUP_BONUS_UNTIL: preserve(), NIXPACKS_INSTALL_CMD: preserve(), NPM_CONFIG_LEGACY_PEER_DEPS: preserve(), OCR_API_KEY: preserve(), OCR_PROVIDER: preserve(), RESEND_API_KEY: preserve(), RESTOCK_WATCH_MINUTES: preserve(), REVENUECAT_WEBHOOK_AUTH: preserve(), SCRAPE_INTERVAL_MINUTES: preserve(), SENTRY_DSN: preserve(), SMTP_HOST: preserve(), SMTP_PASS: preserve(), SMTP_PORT: preserve(), SMTP_SECURE: preserve(), SMTP_USER: preserve(), STRIPE_ENABLED: preserve(), STRIPE_PRICE_ID_PRO_MONTHLY: preserve(), STRIPE_SECRET_KEY: preserve(), STRIPE_WEBHOOK_SECRET: preserve(), TRADERA_APP_ID: preserve(), TRADERA_APP_KEY: preserve(), TRADERA_PUBLIC_KEY: preserve(), UNSUBSCRIBE_SECRET: preserve(), UNSUBSCRIBE_SECRET_PREVIOUS: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve() },
  });

  return project("divine-reflection", {
    resources: [PokeFinds, pokefindsVolume],
  });
});
