"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { IconMessage } from "@/components/ui/icons";
import { conversationPath, relativeLabelFor } from "@/lib/chat-rules";
import type { ConversationRowDto } from "@/lib/chat-client";
import { ChatAvatar } from "./chat-avatar";

export function localeTag(locale: string): string {
  return locale === "en" ? "en-GB" : "sv-SE";
}

function RelativeTime({ iso }: { iso: string }) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const label = relativeLabelFor(iso);
  let text: string;
  switch (label.kind) {
    case "now":
      text = t("relNow");
      break;
    case "minutes":
      text = t("relMinutes", { count: label.count });
      break;
    case "hours":
      text = t("relHours", { count: label.count });
      break;
    case "days":
      text = t("relDays", { count: label.count });
      break;
    default:
      text = new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short" }).format(
        label.date
      );
  }
  // Servern och klienten renderar med varsin klocka — bucketen kan hinna byta.
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

export function ConversationList({ rows }: { rows: ConversationRowDto[] }) {
  const t = useTranslations("Chat");

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconMessage size={36} />}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          <LinkButton href="/forum" variant="outline">
            {t("emptyCta")}
          </LinkButton>
        }
      />
    );
  }

  return (
    <ul className="card-surface divide-y divide-surface-border overflow-hidden">
      {rows.map((row) => {
        const unread = row.unread > 0;
        const name = row.other?.name ?? t("deletedAccount");
        return (
          <li key={row.id}>
            <Link
              href={conversationPath(row.id)}
              className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-overlay/50 sm:px-4"
            >
              <ChatAvatar name={row.other?.name ?? null} avatarUrl={row.other?.avatarUrl ?? null} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-sm",
                      unread ? "font-semibold text-ink" : "font-medium text-ink",
                      !row.other && "italic text-ink-muted"
                    )}
                  >
                    {name}
                  </p>
                  {row.lastMessageAt && (
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        unread ? "text-holo-cyan" : "text-ink-faint"
                      )}
                    >
                      <RelativeTime iso={row.lastMessageAt} />
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "truncate text-sm",
                    unread ? "font-medium text-ink" : "text-ink-muted"
                  )}
                >
                  {row.lastPreview ?? t("noMessages")}
                </p>
                {row.post && (
                  <p className="truncate text-xs text-ink-faint">
                    {t("about", { title: row.post.title })}
                  </p>
                )}
              </div>
              {unread && (
                <span
                  aria-label={t("unreadCount", { count: row.unread })}
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-holo-cyan"
                />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
