import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { communityV2Request } from "@/lib/community-v2-server";
import { getConversationForUser, listMessages } from "@/services/chat";
import { blockStatus } from "@/services/blocks";
import { MESSAGES_PAGE_MAX } from "@/lib/chat-rules";
import { ConversationScreen } from "@/components/chat/conversation-screen";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { ConversationView } from "@/components/chat/conversation-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations("Chat");
  const session = await auth();
  if (!session?.user) return { title: t("metaTitle") };
  const conv = await getConversationForUser(params.id, session.user.id);
  return { title: conv?.other ? t("metaWith", { name: conv.other.name }) : t("metaTitle") };
}

export default async function ConversationPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  if (!(await communityV2Request(session.user.role))) notFound();
  const me = session.user.id;

  // Deltagarkollen ligger i tjänsten: utomstående får 404, aldrig en tom vy.
  const conv = await getConversationForUser(params.id, me);
  if (!conv) notFound();

  const [t, messages, blocks] = await Promise.all([
    getTranslations("Chat"),
    listMessages(conv.id, { limit: MESSAGES_PAGE_MAX }),
    conv.other ? blockStatus(me, conv.other.id) : Promise.resolve({ byMe: false, byThem: false }),
  ]);

  // Beskedet i stället för skrivfältet. Den som är blockerad får ett neutralt
  // besked — vi säger aldrig "hen har blockerat dig".
  const composerNotice = !conv.other
    ? t("deletedNotice")
    : blocks.byMe
      ? t("blockedByYou", { name: conv.other.name })
      : blocks.byThem
        ? t("blockedNotice")
        : null;

  const otherDto = conv.other
    ? { id: conv.other.id, name: conv.other.name, avatarUrl: conv.other.avatarUrl }
    : null;

  return (
    // ⛔ HEADERN LIGGER UTANFÖR ConversationScreen. Skalet förskjuter allt sitt
    // innehåll uppåt när tangentbordet öppnas (transform, se komponenten) — låg
    // headern inuti gled den upp ur bild och kom tillbaka först när tangentbordet
    // stängdes. Utanför står den still och listan glider upp under den.
    <>
      <ConversationHeader
        conversationId={conv.id}
        other={otherDto}
        post={conv.post}
        blockedByMe={blocks.byMe}
      />
      <ConversationScreen>
        <ConversationView
          conversationId={conv.id}
          meId={me}
          other={otherDto}
          initialMessages={messages}
          initialOtherReadAt={conv.other?.lastReadAt ? conv.other.lastReadAt.toISOString() : null}
          composerNotice={composerNotice}
        />
      </ConversationScreen>
    </>
  );
}
