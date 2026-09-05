/**
 * UTMÄRKELSER — hela listan, klara som oklara.
 *
 * ⛔ **DE OKLARA ÄR HELA POÄNGEN.** Först visades bara de upplåsta som en rad
 * chips i /mer, och då gick det varken att se vad som fanns kvar eller hur man
 * når dit. En utmärkelselista utan mål är en dekoration.
 *
 * ⛔ **FRAMSTEGSTALEN DELAR INTE UT NÅGOT.** Utdelningen sker i nattsvepet
 * (`src/jobs/achievement-sweep.ts`) och `UserAchievement` är facit. Talen här är
 * bara "var står jag" — därför kan raden säga "100 av 100" en stund innan märket
 * faktiskt syns som upplåst. Det är avsiktligt: ett märke som olika vyer räknar
 * fram på var sitt sätt är värre än ett som kommer en natt sent.
 *
 * Sidan är dynamisk (den kallar `auth()`) och ligger under `(app)`-skalet, som
 * äger sidluften och bottenflikarnas spacer — lägg ingen egen här.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  listUserAchievements,
  loadUserStats,
  buildAchievementProgress,
} from "@/services/achievements";
import { ACHIEVEMENT_ICONS } from "@/components/features/achievement-badges";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PageBackButton } from "@/components/layout/page-back-button";
import { IconCheck } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Achievements");
  return { title: t("title") };
}

export default async function AchievementsPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const userId = session.user.id;

  // ⛔ Parallellt: tre sekventiella await är tre rundturer mot Frankfurt för en
  // sida som redan är dynamisk.
  const [earned, stats, t, locale] = await Promise.all([
    listUserAchievements(userId),
    loadUserStats(userId),
    getTranslations("Achievements"),
    getLocale(),
  ]);

  const rows = buildAchievementProgress(earned, stats);
  const unlockedLevels = rows.reduce((n, r) => n + r.earnedTier, 0);
  const totalLevels = rows.reduce((n, r) => n + r.tierCount, 0);
  const overall = totalLevels > 0 ? Math.round((unlockedLevels / totalLevels) * 100) : 0;

  // Klara först — det man redan gjort är kvittot, det oklara är kartan.
  const done = rows.filter((r) => r.earnedTier > 0);
  const todo = rows.filter((r) => r.earnedTier === 0);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <header className="flex items-center gap-2">
        <PageBackButton />
        <h1 className="font-display text-2xl font-bold text-ink">{t("title")}</h1>
      </header>

      <section className="rounded-2xl border border-surface-border bg-surface-raised/40 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-muted">{t("subtitle")}</p>
          <span className="shrink-0 font-display text-lg font-bold tabular-nums text-ink">
            {t("progress", { count: unlockedLevels, total: totalLevels })}
          </span>
        </div>
        <ProgressBar
          percent={overall}
          label={t("progress", { count: unlockedLevels, total: totalLevels })}
          className="mt-3"
        />
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("sectionUnlocked")}
          </h2>
          <ul className="card-surface divide-y divide-surface-border">
            {done.map((r) => (
              <AchievementRow key={r.key} row={r} t={t} locale={locale} />
            ))}
          </ul>
        </section>
      )}

      {todo.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("sectionLocked")}
          </h2>
          <ul className="card-surface divide-y divide-surface-border">
            {todo.map((r) => (
              <AchievementRow key={r.key} row={r} t={t} locale={locale} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type Row = ReturnType<typeof buildAchievementProgress>[number];
type T = Awaited<ReturnType<typeof getTranslations<"Achievements">>>;

function AchievementRow({ row, t, locale }: { row: Row; t: T; locale: string }) {
  const Icon = ACHIEVEMENT_ICONS[row.icon];
  const unlocked = row.earnedTier > 0;

  return (
    <li className="flex items-start gap-3 px-3 py-3 sm:px-4">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          unlocked
            ? "bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30"
            : "bg-surface-overlay text-ink-faint"
        }`}
      >
        {Icon ? <Icon size={17} /> : null}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm font-semibold ${unlocked ? "text-ink" : "text-ink-muted"}`}
          >
            {t(`${row.key}.name`)}
            {row.tiered && unlocked && (
              <span className="font-normal text-ink-faint">
                {" · "}
                {t("tierLabel", { tier: row.earnedTier })}
              </span>
            )}
          </span>
          {row.done ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-rise">
              <IconCheck size={13} aria-hidden="true" />
              {t("allDone")}
            </span>
          ) : (
            /* ⛔ Talet står ALLTID bredvid stapeln. En stapel utan siffror går
               inte att kontrollera, och för ja/nej-märken finns ingen stapel. */
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {t("progress", { count: Math.min(row.current, row.threshold), total: row.threshold })}
            </span>
          )}
        </div>

        {/* Beskrivningen ÄR instruktionen: "100 poster i samlingen." Den visar
            nästa nivås tröskel, inte den man redan klarat. */}
        <p className="mt-0.5 text-xs text-ink-muted">
          {t(`${row.key}.desc`, { count: row.threshold })}
        </p>

        {row.percent != null && (
          <ProgressBar
            percent={row.percent}
            label={t("progress", { count: row.current, total: row.threshold })}
            tone={unlocked ? "cyan" : "muted"}
            className="mt-2"
          />
        )}

        {row.unlockedAt && (
          <p className="mt-1 text-xs text-ink-faint">
            {t("unlockedOn", { date: formatDate(row.unlockedAt, locale) })}
          </p>
        )}
      </div>
    </li>
  );
}
