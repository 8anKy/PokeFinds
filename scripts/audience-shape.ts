/**
 * READ-ONLY: hur stor är publiken för ett utskick, och hur många kan vi faktiskt
 * mejla? Underlag inför Discord-inbjudan (2026-08-14). Skriver ingenting.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/audience-shape.ts
 */
import { prisma } from "@/lib/db";
import { parseNotificationSettings } from "@/lib/notification-settings";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      discordUserId: true,
      notificationSettings: true,
      planTier: true,
      role: true,
    },
  });

  const mailable = users.filter(
    (u) => !!u.email && parseNotificationSettings(u.notificationSettings).email
  );
  const verified = mailable.filter((u) => u.emailVerifiedAt);
  const linked = users.filter((u) => u.discordUserId);
  const seen7 = users.filter(
    (u) => u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < 7 * 864e5
  );

  console.log(`Konton totalt:            ${users.length}`);
  console.log(`  varav e-postverifierade: ${users.filter((u) => u.emailVerifiedAt).length}`);
  console.log(`  varav Discord-länkade:   ${linked.length}`);
  console.log(`  aktiva senaste 7 dygn:   ${seen7.length} (lastSeenAt, ungefärlig)`);
  console.log(`Mejlbara (email-toggle på): ${mailable.length}`);
  console.log(`  varav verifierade:        ${verified.length}`);
  console.log(
    `Plan: ${users.filter((u) => u.planTier === "PREMIUM").length} PREMIUM · ${
      users.filter((u) => u.planTier !== "PREMIUM").length
    } övriga`
  );

  const domains = new Map<string, number>();
  for (const u of mailable) {
    const d = (u.email ?? "").split("@")[1]?.toLowerCase() ?? "?";
    domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  console.log(
    "Domäner:",
    [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}=${n}`).join(" ")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
