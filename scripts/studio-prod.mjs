/**
 * Öppnar Prisma Studio (visuell DB-editor) mot PRODUKTIONS-databasen (Neon).
 * Läser NEON_DATABASE_URL ur .env och startar studio på http://localhost:5555.
 *   npm run db:studio:prod
 * Bläddra i t.ex. tabellen "Offer", sök, och radera felaktiga rader med en klick.
 * OBS: detta är SKARP data — ändringar slår igenom direkt på foilio.se.
 */
import { spawnSync } from "child_process";
import fs from "fs";

const env = { ...process.env };
for (const line of fs.readFileSync(".env", "utf-8").split("\n")) {
  const m = line.match(/^\s*NEON_DATABASE_URL\s*=\s*(.+?)\s*$/);
  if (m) env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
}
if (!env.DATABASE_URL || !env.DATABASE_URL.includes("neon")) {
  console.error("NEON_DATABASE_URL saknas/ogiltig i .env");
  process.exit(1);
}
console.log("⚠  Öppnar Prisma Studio mot PROD (Neon) → http://localhost:5555");
console.log("   Ändringar slår igenom direkt på foilio.se. Stäng med Ctrl+C.\n");
spawnSync("npx", ["prisma", "studio"], { stdio: "inherit", env, shell: true });
