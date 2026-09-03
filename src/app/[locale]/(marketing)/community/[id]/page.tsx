import { redirect } from "next/navigation";

// ponytail: community är pausad → djuplänkar till inlägg går till "snart här"-sidan.
// Inläggssidans kod finns kvar i git-historiken.
// Sedan 2026-09-03 lever inläggen vidare som forumtrådar på /forum/t/[id] (samma
// id — CommunityPost-raden är densamma). När forumet är lanserat
// (`COMMUNITY_V2_PUBLIC=1`, inbakad vid bygget) pekar gamla länkar dit i stället.
export default function CommunityPostPage({ params }: { params: { id: string } }) {
  if (process.env.NEXT_PUBLIC_COMMUNITY_V2_PUBLIC === "1") redirect(`/forum/t/${params.id}`);
  redirect("/community");
}
