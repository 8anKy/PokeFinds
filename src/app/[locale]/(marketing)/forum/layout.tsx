import type { ReactNode } from "react";
import { ForumRulesGate } from "@/components/community/forum-rules-gate";

/**
 * Forumets gemensamma skal: bara regeldialogen. Ingen auth()/headers() här —
 * sidorna under är ISR-cachade och dialogen är en klientkomponent som läser
 * fo_auth-hinten själv (se forum-rules-gate.tsx).
 */
export default function ForumLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ForumRulesGate />
    </>
  );
}
