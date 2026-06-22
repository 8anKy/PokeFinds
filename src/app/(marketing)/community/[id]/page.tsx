import { redirect } from "next/navigation";

// ponytail: community är pausad → djuplänkar till inlägg går till "snart här"-sidan.
// Inläggssidans kod finns kvar i git-historiken.
export default function CommunityPostPage() {
  redirect("/community");
}
