/**
 * PÅBÖRJADE REGISTRERINGAR — RAPPORT OCH STÄDNING.
 *
 * `SignupVerification` är väntrummet mellan "Skicka kod" och ett riktigt konto:
 * en rad per adress, med kodens hash, utgångstid och antal felgissningar. Raden
 * raderas BARA när registreringen lyckas (`register/route.ts`), så varje
 * avbruten, utgången, låst eller studsad registrering lämnar en adress kvar i
 * tabellen för alltid. Det är personuppgifter utan syfte och utan gallringstid.
 *
 * ⛔ RAPPORTEN KOMMER FÖRE STÄDNINGEN, OCH DET ÄR INTE ARTIGHET: raderna är det
 * ENDA spår som finns av misslyckade registreringar. Ingen analytics-händelse,
 * ingen adminvy. Raderar man dem utan att räkna dem först kastar man bort svaret
 * på varför folk inte blir användare. Därför skriver `--apply` alltid ut
 * fördelningen innan den tar bort något.
 *
 * ⛔ RÖR ALDRIG `User`. Skriptet läser och raderar uteslutande i
 * SignupVerification. En herrelös rad kan mycket väl tillhöra någon som ÄR
 * kund (rättade sin adress och registrerade sig på den andra) — att ta bort
 * väntrumsraden påverkar inte kontot på något sätt.
 *
 * ⛔ KARENS: bara rader som gått ut för mer än `GRACE_HOURS` sedan raderas. En
 * kod lever 15 minuter, men någon kan sitta mitt i flödet just nu, och en rad
 * som försvinner under fötterna på dem ger "koden är ogiltig" på en kod som
 * kom för två minuter sedan.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/signup-verification-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/signup-verification-report.ts --apply
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { classifySignupRows, GRACE_HOURS } from "../src/lib/signup-verification-audit";

async function main() {
  const apply = process.argv.includes("--apply");
  const now = new Date();

  // Adressen hämtas för att kunna avgöra om raden är en HERRELÖS rad efter en
  // rättad adress (personen finns som användare) eller en riktig avhoppare.
  const rows = await prisma.signupVerification.findMany({
    select: { email: true, expiresAt: true, attempts: true, createdAt: true },
  });

  const emails = await prisma.user.findMany({ select: { email: true } });
  const report = classifySignupRows(rows, new Set(emails.map((u) => u.email)), now);

  console.log(`\nPåbörjade registreringar i väntrummet: ${report.total}`);
  console.log(`  Aktiva just nu (koden gäller):        ${report.active}`);
  console.log(`  Inom karens (<${GRACE_HOURS} h sedan utgång):  ${report.withinGrace}`);
  console.log(`  Städbara (utgångna för länge sedan):  ${report.purgeable.length}\n`);

  console.log("Varför de inte blev användare (av de städbara):");
  console.log(`  Skrev ALDRIG in en kod (attempts=0):  ${report.buckets.neverTried}`);
  console.log(`    — mejlet kom inte fram, hamnade i skräpposten, eller öppnades aldrig`);
  console.log(`  Gissade fel 1–4 gånger, gav upp:      ${report.buckets.gaveUpTyping}`);
  console.log(`  Låstes ute (5 fel):                   ${report.buckets.lockedOut}`);
  console.log(`  Adress som REDAN är en användare:     ${report.buckets.alreadyUser}`);
  console.log(`    — rättad adress eller ett andra försök; personen ÄR kund\n`);

  if (report.oldest) {
    console.log(`Äldsta raden: ${report.oldest.toISOString().slice(0, 10)}`);
  }
  console.log(`Domäner med flest avhopp: ${report.topDomains.join(", ") || "—"}\n`);

  if (!apply) {
    console.log(`TORRKÖRNING. Kör med --apply för att radera de ${report.purgeable.length} städbara raderna.`);
    return;
  }

  if (report.purgeable.length === 0) {
    console.log("Inget att radera.");
    return;
  }

  const deleted = await prisma.signupVerification.deleteMany({
    where: { email: { in: report.purgeable } },
  });
  console.log(`Raderade ${deleted.count} rader ur SignupVerification. User rördes inte.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
