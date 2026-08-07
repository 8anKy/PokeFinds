/**
 * Laddar `.env` in i process.env. Importeras FÖRST i ett CLI-skript:
 *
 *   import "./load-env";          // måste stå före övriga imports
 *   import { prisma } from "../src/lib/db";
 *
 * VARFÖR DET BEHÖVS: `tsx` auto-laddar inte .env, och `scripts/with-prod-db.mjs`
 * skickar med ENDAST `DATABASE_URL` (den läser .env för att slippa materialisera
 * lösenordet på kommandoraden — inte för att exportera resten). Allt annat en körning
 * behöver är alltså OSATT om skriptet inte laddar det själv.
 *
 * ⛔ DET FELAR TYST. `ANTHROPIC_API_KEY` saknades i en Wave 4-provimport 2026-08-07:
 *    `judgeSameProduct` returnerar null utan nyckel, vilket är exakt samma svar som
 *    "kvoten är slut", och HELA 0,55–0,85-bandet blev nya produkter i stället för
 *    länkar. Inget felmeddelande, bara dubbletter.
 *
 * ⛔ REDAN SATTA VÄRDEN VINNER. `DATABASE_URL` från with-prod-db måste överleva att
 *    .env innehåller en LOKAL `DATABASE_URL` — annars skriver ett "prod"-kommando mot
 *    utvecklingsdatabasen, tyst och med rätt utskrift överst.
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Kastar om en nyckel körningen är beroende av saknas — hellre stopp än tyst fel. */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Saknade miljövariabler: ${missing.join(", ")} — lägg dem i .env.`);
    process.exit(1);
  }
}
