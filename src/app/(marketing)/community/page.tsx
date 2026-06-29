import type { Metadata } from "next";
import { IconLock, IconMessage } from "@/components/ui/icons";
import { LockScroll } from "@/components/lock-scroll";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Community på Foilio — pulls, byten och marknadssnack för svenska Pokémon TCG-samlare. Snart här.",
};

// ponytail: community är pausad → statisk "snart här"-skärm (ingen DB-hämtning).
// Flödeskoden finns kvar i git-historiken när det är dags att öppna igen.
export default function CommunityPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-20 text-center">
      <LockScroll />
      <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-holo-cyan/10 text-holo-cyan ring-1 ring-holo-cyan/30">
        <IconMessage size={30} />
        <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-surface bg-surface-raised text-ink-muted">
          <IconLock size={14} />
        </span>
      </span>

      <h1 className="mt-6 font-display text-3xl font-bold text-ink">Community</h1>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-holo-cyan/30 bg-holo-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-holo-cyan">
        Snart här
      </span>

      <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
        Vi bygger en plats för pulls, byten och marknadssnack — av samlare, för
        samlare. Håll utkik, den öppnar snart.
      </p>
    </div>
  );
}
