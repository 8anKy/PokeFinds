/**
 * ENGÅNGSÅTGÄRD 2026-09-03 — slår ihop de TOMMA dubbelkonton som Apples
 * "Dölj min e-post" gav två befintliga användare när app 1.1 gick live 09-01.
 *
 * VAD SOM HÄNDE: relay-adressen (…@privaterelay.appleid.com) matchade inget
 * konto, så `findOrCreateOAuthUser` (src/services/oauth-account.ts) födde ett
 * NYTT tomt konto i stället för att landa i det användaren redan hade. Båda
 * övergav appen inom sekunder — ett dubbelkonto ser ut som "min samling är borta".
 *
 * ⛔ ATT BE ANVÄNDAREN AVMARKERA "DÖLJ MIN E-POST" LAGAR INGENTING. Uppslaget går
 * på `appleId` (Apples `sub`) FÖRE e-post, och dubbletten BÄR redan sub:en — varje
 * framtida Apple-inloggning landar där oavsett vilken adress Apple delar. Apple
 * frågar dessutom bara första gången per app. Fixen måste ske i DATABASEN.
 *
 * ÅTGÄRDEN, en transaktion per par:
 *   1. nolla `appleId` på dubbletten  (unikt index → måste släppas före flytten)
 *   2. sätt samma `appleId` på ursprungskontot
 *   3. peka om ev. `GuestDevice.userId` till ursprungskontot (gästskanningarna
 *      räknas som max(konto, enhet) — de ska följa med, inte nollas)
 *   4. radera dubbletten
 *
 * ⛔ RADERAR ALDRIG ETT KONTO MED INNEHÅLL. Varje relation räknas först; allt
 * utom AuditLog/Notification (rena spår av att kontot föddes) måste vara 0.
 * Betalningsspår (planTier, stripe-, rc- och bonusProUntil-fälten) fäller också
 * körningen.
 *
 * MEJLET går EFTERÅT, till den RIKTIGA adressen — ⛔ aldrig till relay-adressen:
 * den studsar om avsändardomänen inte är registrerad hos Apples relay-tjänst.
 * Driftbesked om eget konto ⇒ ingen avregistreringslänk.
 *
 * Kör:
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-apple-relay-duplicates.ts            # dry-run
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-apple-relay-duplicates.ts --apply
 *   (mejlet: .github/workflows/apple-relay-notice.yml — RESEND_API_KEY finns inte lokalt)
 */
import { prisma } from "@/lib/db";
import { providerFor, sendMail } from "@/lib/mailer";
import { appleRelayLinkedEmail } from "@/emails/templates";

const APPLY = process.argv.includes("--apply");
const SEND_MAIL = process.argv.includes("--send-mail");
const SEND_TO_ALL = process.argv.includes("--send-to-all");
const OWNER = "milostheking88@gmail.com";
const RELAY_SUFFIX = "@privaterelay.appleid.com";

/**
 * Paren är HÅRDKODADE med flit. Att para ihop dem på namnlikhet ("… 2") hade
 * varit en gissning, och den här körningen RADERAR konton — facit ska komma från
 * den manuella granskningen 2026-09-02, inte från en heuristik.
 */
const PAIRS = [
  {
    duplicateId: "cmtiwbgs9000rqbv4y2ny3e26",
    duplicateEmail: "z7t924sbnv@privaterelay.appleid.com",
    originalId: "cmsutct1x002e11uk1my02k51",
    originalEmail: "alhasan990127@icloud.com",
  },
  {
    duplicateId: "cmtitj7od0003qbv43hv4xn8n",
    duplicateEmail: "j6nz6p2fg4@privaterelay.appleid.com",
    originalId: "cmt7gpp4g00f1puabaqp3jgpr",
    originalEmail: "dennis.vonwalden@hotmail.com",
  },
] as const;

/** Allt som gör ett konto icke-tomt. AuditLog/Notification räknas men fäller inte. */
async function contentCounts(userId: string) {
  const [
    collectionItems,
    scannerJobs,
    gradingJobs,
    watchlistItems,
    setWatches,
    alerts,
    posts,
    comments,
    likes,
    savedPosts,
    sales,
    achievements,
    pushTokens,
    invitesSent,
    inviteUsed,
    reports,
    offerReports,
  ] = await Promise.all([
    prisma.collectionItem.count({ where: { userId } }),
    prisma.scannerJob.count({ where: { userId } }),
    prisma.gradingJob.count({ where: { userId } }),
    prisma.watchlistItem.count({ where: { userId } }),
    prisma.setWatch.count({ where: { userId } }),
    prisma.alert.count({ where: { userId } }),
    prisma.communityPost.count({ where: { userId } }),
    prisma.comment.count({ where: { userId } }),
    prisma.like.count({ where: { userId } }),
    prisma.savedPost.count({ where: { userId } }),
    prisma.sale.count({ where: { userId } }),
    prisma.userAchievement.count({ where: { userId } }),
    prisma.pushToken.count({ where: { userId } }),
    prisma.invite.count({ where: { inviterId: userId } }),
    prisma.invite.count({ where: { usedById: userId } }),
    prisma.report.count({ where: { reporterId: userId } }),
    prisma.offerReport.count({ where: { reporterId: userId } }),
  ]);
  return {
    collectionItems,
    scannerJobs,
    gradingJobs,
    watchlistItems,
    setWatches,
    alerts,
    posts,
    comments,
    likes,
    savedPosts,
    sales,
    achievements,
    pushTokens,
    invitesSent,
    inviteUsed,
    reports,
    offerReports,
  };
}

async function merge() {
  // Upptäcktspass: dyker det upp FLER relay-konton efter 09-01 är det inte en
  // engångsstädning längre utan ett återkommande fel — då ska ägaren se det.
  const allRelay = await prisma.user.findMany({
    where: { email: { endsWith: RELAY_SUFFIX } },
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const known = new Set<string>(PAIRS.map((p) => p.duplicateId));
  console.log(`Relay-konton i DB: ${allRelay.length}`);
  for (const u of allRelay) {
    const tag = known.has(u.id) ? "känt par" : "⚠️ OKÄNT — granska manuellt";
    console.log(
      `  ${u.id}  ${u.email}  "${u.name}"  ${u.createdAt.toISOString().slice(0, 10)}  [${tag}]`
    );
  }

  for (const pair of PAIRS) {
    console.log(`\n── ${pair.originalEmail} ──`);
    const [dup, original] = await Promise.all([
      prisma.user.findUnique({
        where: { id: pair.duplicateId },
        select: {
          id: true,
          email: true,
          name: true,
          appleId: true,
          googleId: true,
          passwordHash: true,
          planTier: true,
          bonusProUntil: true,
          stripeCustomerId: true,
          stripeProUntil: true,
          rcExpiresAt: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: pair.originalId },
        select: { id: true, email: true, name: true, appleId: true },
      }),
    ]);

    if (!dup) {
      console.log("  dubbletten finns inte längre — redan körd?");
      continue;
    }
    if (!original) {
      console.log("  ⛔ ursprungskontot saknas — hoppar över");
      continue;
    }
    if (dup.email !== pair.duplicateEmail || original.email !== pair.originalEmail) {
      console.log(`  ⛔ e-post stämmer inte (${dup.email} / ${original.email}) — hoppar över`);
      continue;
    }
    if (!dup.email.endsWith(RELAY_SUFFIX)) {
      console.log("  ⛔ dubbletten är ingen relay-adress — hoppar över");
      continue;
    }
    if (!dup.appleId) {
      console.log("  ⛔ dubbletten saknar appleId — inget att flytta");
      continue;
    }
    if (original.appleId && original.appleId !== dup.appleId) {
      console.log("  ⛔ ursprungskontot bär REDAN ett annat appleId — hoppar över");
      continue;
    }
    if (dup.passwordHash || dup.googleId) {
      console.log("  ⛔ dubbletten har lösenord/Google — inte det tomma kontot");
      continue;
    }
    if (
      dup.planTier !== "FREE" ||
      dup.bonusProUntil ||
      dup.stripeCustomerId ||
      dup.stripeProUntil ||
      dup.rcExpiresAt
    ) {
      console.log("  ⛔ dubbletten bär betalningsspår — RADERAS INTE");
      continue;
    }

    const counts = await contentCounts(dup.id);
    const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
    const [devices, auditLogs, notifications] = await Promise.all([
      prisma.guestDevice.findMany({
        where: { userId: dup.id },
        select: { id: true, guestScans: true, monthScans: true },
      }),
      prisma.auditLog.count({ where: { userId: dup.id } }),
      prisma.notification.count({ where: { userId: dup.id } }),
    ]);
    console.log(
      `  dubblett ${dup.id} "${dup.name}" — innehåll: ${
        nonEmpty.length ? nonEmpty.map(([k, n]) => `${k}=${n}`).join(", ") : "TOMT"
      }`
    );
    console.log(
      `  gästenheter: ${
        devices.length
          ? devices.map((d) => `${d.id} (${d.guestScans}/${d.monthScans})`).join(", ")
          : "inga"
      }; auditLog=${auditLogs}, notiser=${notifications}`
    );

    if (nonEmpty.length) {
      console.log("  ⛔ INTE tomt — hoppar över, ingen radering");
      continue;
    }

    if (!APPLY) {
      console.log(
        `  [dry-run] skulle flytta appleId → ${original.id} (${original.email}), peka om ${devices.length} gästenhet(er), radera ${dup.id}`
      );
      continue;
    }

    const appleId = dup.appleId;
    await prisma.$transaction(async (tx) => {
      // Det unika indexet på appleId släpps FÖRE flytten — annars krockar raderna.
      await tx.user.update({ where: { id: dup.id }, data: { appleId: null } });
      await tx.user.update({ where: { id: original.id }, data: { appleId } });
      if (devices.length) {
        await tx.guestDevice.updateMany({
          where: { userId: dup.id },
          data: { userId: original.id },
        });
      }
      await tx.user.delete({ where: { id: dup.id } });
    });
    console.log(`  ✅ klart — ${original.email} loggar nu in med Apple till sitt eget konto`);

    const after = await prisma.user.findUnique({
      where: { id: original.id },
      select: { appleId: true },
    });
    const gone = await prisma.user.findUnique({
      where: { id: pair.duplicateId },
      select: { id: true },
    });
    console.log(
      `  verifierat: original.appleId=${after?.appleId ? "satt" : "SAKNAS ⛔"}, dubblett=${
        gone ? "FINNS KVAR ⛔" : "borta"
      }`
    );
  }
}

async function mail() {
  // ⛔ KONSOLLÄGE ÄR INTE ETT UTSKICK. Utan nyckel loggar mailern och returnerar
  // utan fel — körningen blir grön och ingen får något.
  if (process.env.EMAIL_MODE === "console" || !providerFor({})) {
    throw new Error(
      "Mailern går i konsolläge (EMAIL_MODE=console eller RESEND_API_KEY saknas) — avbryter hellre " +
        "än rapporterar grönt utan att skicka. Kör via .github/workflows/apple-relay-notice.yml."
    );
  }
  // Mejlen är identiska så när som på namn och adress — förhandsgranskningen
  // skickar därför ETT, inte två likadana, till ägaren.
  const targets = SEND_TO_ALL ? PAIRS : PAIRS.slice(0, 1);
  for (const pair of targets) {
    const original = await prisma.user.findUnique({
      where: { id: pair.originalId },
      select: { name: true, email: true, appleId: true },
    });
    if (!original) {
      console.log(`  ⛔ ${pair.originalEmail}: kontot saknas — inget mejl`);
      continue;
    }
    // ⛔ Mejlet PÅSTÅR att sammanslagningen är gjord. Är den inte det ljuger vi —
    // därför grindas det SKARPA utskicket på att den faktiskt är körd.
    // Förhandsgranskningen till ägaren går ändå: den finns för att SE mejlet i en
    // riktig inkorg, och måste kunna köras innan sammanslagningen är gjord.
    const dupGone = !(await prisma.user.findUnique({
      where: { id: pair.duplicateId },
      select: { id: true },
    }));
    const merged = Boolean(original.appleId) && dupGone;
    if (!merged) {
      const state = `appleId=${original.appleId ? "ja" : "nej"}, dubblett borta=${dupGone}`;
      if (SEND_TO_ALL) {
        console.log(`  ⛔ ${pair.originalEmail}: sammanslagningen är INTE gjord (${state}) — inget mejl`);
        continue;
      }
      console.log(`  ⚠️  ${pair.originalEmail}: sammanslagningen är INTE gjord än (${state}) — förhandsgranskningen skickas ändå`);
    }
    const content = appleRelayLinkedEmail(original.name, original.email);
    const to = SEND_TO_ALL ? original.email : OWNER;
    await sendMail({ to, ...content });
    console.log(`  ✉️  ${SEND_TO_ALL ? "skickat" : "FÖRHANDSGRANSKNING"} → ${to}`);
  }
}

async function main() {
  if (SEND_MAIL) await mail();
  else await merge();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
