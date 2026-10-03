import { BackCircle } from "@/components/ui/back-circle";

export function ProfileHeader({ name, fallback }: { name: string; fallback: string }) {
  // ⛔ SwipeBacks scrollbehållare har redan safe-area-padding. En andra inset
  // på sticky-top gav 118 px i stället för 59 px på en telefon med urklipp.
  return <header data-profile-header className="sticky top-0 z-40 border-b border-surface-border bg-surface/95 backdrop-blur-md lg:top-16 before:absolute before:inset-x-0 before:bottom-full before:h-[env(safe-area-inset-top)] before:bg-surface before:content-[''] lg:before:hidden">
    <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-2.5 sm:px-6">
      <div className="lg:hidden"><BackCircle fallback={fallback} /></div>
      <span className="truncate text-base font-semibold text-ink">{name}</span>
    </div>
  </header>;
}
