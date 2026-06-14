import { EmptyState } from "@/components/ui/empty-state";
import { IconLock } from "@/components/ui/icons";

/** Visas för moderatorer på sidor som kräver ADMIN-behörighet. */
export function AdminRequired() {
  return (
    <EmptyState
      icon={<IconLock size={32} />}
      title="Kräver adminbehörighet"
      description="Den här sidan är endast tillgänglig för administratörer. Som moderator kan du hantera rapporter under fliken Rapporter."
    />
  );
}
