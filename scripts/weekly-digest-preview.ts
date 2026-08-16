/**
 * Renderar veckobrevet till en HTML-fil UTAN att skicka något.
 *
 * Kör:
 *   node scripts/with-prod-db.mjs npx tsx scripts/weekly-digest-preview.ts <fil.html> [adress]
 *
 * ⛔ VARFÖR DET HÄR SKRIPTET FINNS. 2026-08-16 gick ett skarpt veckobrev ut med
 * trasig logotyp och länkar som pekade på `http:///produkter` — och det gick inte
 * att upptäcka förrän brevet låg i en inkorg. En torrkörning räknade mottagare och
 * rapporterade "1 brev", men sa ingenting om hur brevet SÅG UT. Ett massutskick
 * som bara går att granska genom att skicka det är inte granskningsbart.
 *
 * Skriptet bygger brevet via `runWeeklyDigest` i torrkörning, så det som hamnar i
 * filen är EXAKT samma HTML som hade skickats — aldrig en rekonstruktion.
 *
 * ⛔ Skickar aldrig: `dryRun: true` är hårdkodat, inte en flagga.
 */
import fs from "node:fs";
import path from "node:path";
import { runWeeklyDigest } from "../src/jobs/weekly-digest";

const outPath = process.argv[2];
const onlyEmail = process.argv[3];

if (!outPath) {
  console.error("Användning: … scripts/weekly-digest-preview.ts <fil.html> [adress]");
  process.exit(1);
}

let saved = 0;

runWeeklyDigest(new Date(), {
  force: true,
  dryRun: true,
  onlyEmail,
  onBuilt: (email, mail) => {
    // Bara det FÖRSTA brevet skrivs till filen; utan adress är det ändå en
    // representativ mottagare, och att skriva över filen 47 gånger vore bara
    // förvirrande.
    if (saved === 0) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(outPath, mail.html, "utf8");
      console.log(`\nSkrev ${outPath}`);
      console.log(`  mottagare : ${email}`);
      console.log(`  ämne      : ${mail.subject}`);
      console.log(`  storlek   : ${(mail.html.length / 1024).toFixed(1)} kB`);
    }
    saved++;
  },
})
  .then(() => {
    if (saved === 0) {
      console.log("\nInget brev byggdes — ingen mottagare matchade.");
      process.exit(1);
    }
    console.log(`  byggda    : ${saved}\n`);
    // ⛔ Explicit exit: jobbet håller en Prisma-anslutning som annars kan hålla
    // processen vid liv (samma fälla som one-shot-körningen 2026-08-11).
    process.exit(0);
  })
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  });
