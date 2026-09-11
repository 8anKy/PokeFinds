import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { communityV2Request } from "@/lib/community-v2-server";
import { listConversations } from "@/services/chat";
import { ConversationList } from "@/components/chat/conversation-list";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { SwipeBack } from "@/components/ui/swipe-back";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat");
  return { title: t("metaTitle") };
}

export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  // Middleware omdirigerar redan den som inte ser funktionen — hängslen och
  // livrem: sidan får aldrig rendera en lista för någon utanför grinden.
  if (!(await communityV2Request(session.user.role))) notFound();

  const [t, rows] = await Promise.all([getTranslations("Chat"), listConversations(session.user.id)]);

  return (
    <SwipeBack fallback="/mer" coverViewport>
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <SubpageHeader title={t("h1")} fallback="/mer" mobileOnly />
      <h1 className="hidden font-display text-2xl font-bold text-ink lg:block">{t("h1")}</h1>
      <ConversationList rows={rows} />
    </div>
    </SwipeBack>
  );
}
