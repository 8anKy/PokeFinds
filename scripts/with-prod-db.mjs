#!/usr/bin/env node
/**
 * Kör ett kommando mot PROD-databasen utan att någonsin exponera hemligheten.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/nagot.ts
 *
 * VARFÖR: mönstret `DATABASE_URL="$(grep NEON_DATABASE_URL .env | cut -d= -f2-)" npx tsx …`
 * materialiserar lösenordet i kommandoraden, och därmed i loggar, terminalhistorik och
 * agent-transkript. 2026-07-13 grep:ade en subagent fram connection-stringen och skrev ut
 * delar av den i sitt verktygsutdata (lösenordet nådde aldrig disk — men det var tur, inte
 * design). Här läses .env in i processen och skickas vidare som miljövariabel: värdet
 * passerar aldrig ett skal, en logg eller en kommandorad.
 *
 * Skriver ALDRIG ut connection-stringen. Bekräftar bara vilken databas som träffas.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (!fs.existsSync(envPath)) {
  console.error("[with-prod-db] .env saknas.");
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");
const match = /^NEON_DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m.exec(raw);
if (!match) {
  console.error("[with-prod-db] NEON_DATABASE_URL saknas i .env.");
  process.exit(1);
}
const url = match[1];

// Bekräfta MÅLET utan att avslöja hemligheten (host är inte känslig; lösenord/user är det).
let label = "okänd";
try {
  const u = new URL(url);
  label = `${u.hostname.split(".")[0]}${u.pathname}`;
} catch {
  /* strunt i det — vi skriver ändå aldrig ut värdet */
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Användning: node scripts/with-prod-db.mjs <kommando> [args…]");
  console.error("Exempel:    node scripts/with-prod-db.mjs npx tsx scripts/audit-links.ts");
  process.exit(1);
}

console.error(`[with-prod-db] → ${label} (PROD). Hemligheten skickas som env, aldrig via kommandoraden.`);

// INGET `shell: true` — då konkateneras argumenten oescapade (Node varnar för
// argument-injektion), olämpligt i just det skript som ska HÖJA säkerheten.
// På Windows är npx/npm .cmd-filer, och Node vägrar spawna dem utan skal (EINVAL,
// efter en CVE-fix). Lösning: anropa cmd.exe uttryckligen med argumenten som EGNA
// argv-poster — Node escapar dem åt oss, ingen skalkonkatenering.
const isWin = process.platform === "win32";
const child = isWin
  ? spawn("cmd.exe", ["/c", cmd, ...args], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    })
  : spawn(cmd, args, {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });
child.on("error", (err) => {
  console.error(`[with-prod-db] kunde inte starta "${exe}": ${err.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
