import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { IconLock, IconMessage } from "@/components/ui/icons";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Community" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/community"),
  };
}

// ponytail: community är pausad → statisk "snart här"-skärm (ingen DB-hämtning).
// Flödeskoden finns kvar i git-historiken när det är dags att öppna igen.
//
// SEDAN 2026-09-03 FINNS EFTERTRÄDAREN: forumet på /forum (community v2), grindat
// tills ägaren testat (lib/community-v2-gate.ts). Den här sidan är vad alla ANDRA
// ser under tiden. När lanseringsspaken `COMMUNITY_V2_PUBLIC=1` sätts (bakas in
// vid bygget, därför läsbar här utan att sidan blir dynamisk) skickas alla vidare
// till forumet — länkar till /community i appar, mejl och Discord fortsätter fungera.
export default async function CommunityPage({
  params,
}: {
  params: { locale: string };
}) {
  if (process.env.NEXT_PUBLIC_COMMUNITY_V2_PUBLIC === "1") redirect("/forum");
  setRequestLocale(params.locale);
  const t = await getTranslations("Community");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-2.5 py-20 text-center">
      <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-holo-cyan/10 text-holo-cyan ring-1 ring-holo-cyan/30">
        <IconMessage size={30} />
        <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-surface bg-surface-raised text-ink-muted">
          <IconLock size={14} />
        </span>
      </span>

      <h1 className="mt-6 font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-holo-cyan/30 bg-holo-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-holo-cyan">
        {t("comingSoon")}
      </span>

      <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
        {t("placeholderBody")}
      </p>
    </div>
  );
}
