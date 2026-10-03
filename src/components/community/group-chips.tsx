import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { localizeGroupName } from "@/lib/community-group-i18n";
import type { GroupSummary } from "@/services/community-groups";

/**
 * Gruppraden. Går KANT TILL KANT på mobil (-mx-2.5 mot sidans px-2.5, se
 * ui-shell.md) så sista chipet kan scrollas in från kanten; på desktop ligger
 * den i linje med innehållet. Ingen emoji framför namnen (ägarbeslut
 * 2026-09-03) — kolumnen finns kvar i modellen men ritas inte.
 * `data-swipe-ignore`: raden äger sitt vågräta drag, så SwipeBack på
 * gruppsidan inte kapar en scroll som börjar vid vänsterkanten.
 */
export function GroupChips({
  groups,
  activeSlug,
  onSelect,
}: {
  groups: Pick<GroupSummary, "slug" | "name">[];
  activeSlug?: string;
  onSelect?: (slug: string) => void;
}) {
  const t = useTranslations("Forum");
  const tGroups = useTranslations("ForumGroups");
  return (
    <nav aria-label={t("groups")} className="-mx-2.5 sm:mx-0">
      <ul
        data-swipe-ignore
        className="flex gap-2 overflow-x-auto overscroll-x-contain px-2.5 py-1 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {onSelect && <li className="shrink-0"><button type="button" onClick={() => onSelect("")} aria-pressed={!activeSlug} className={cn("h-9 rounded-full border px-3.5 text-sm font-medium", !activeSlug ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan" : "border-surface-border text-ink")}>{t("filterAll")}</button></li>}
        {groups.map((g) => {
          const active = g.slug === activeSlug;
          return (
            <li key={g.slug} className="shrink-0">
              {onSelect ? <button type="button" onClick={() => onSelect(g.slug)} aria-pressed={active} className={cn("h-9 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium", active ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan" : "border-surface-border text-ink")}>{localizeGroupName(g.slug, g.name, tGroups)}</button> :
              <Link
                href={`/forum/g/${g.slug}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
                  active
                    ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
                    : "border-surface-border bg-surface text-ink hover:bg-surface-overlay"
                )}
              >
                {localizeGroupName(g.slug, g.name, tGroups)}
              </Link>
              }
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
