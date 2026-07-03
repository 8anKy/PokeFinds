import { Link } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-gradient px-4 text-center">
      <p className="holo-text font-display text-7xl font-bold">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">
        Sidan kunde inte hittas
      </h1>
      <p className="mt-2 max-w-md text-ink-muted">
        Sidan du letar efter har flyttats, bytt namn eller finns inte längre —
        ungefär som ett kort som försvunnit ur bindern.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">Till startsidan</LinkButton>
        <LinkButton href="/produkter" variant="outline">
          Utforska produkter
        </LinkButton>
      </div>
      <Link href="/marknad" className="mt-6 text-sm text-ink-muted hover:text-ink">
        Eller kolla läget på marknaden →
      </Link>
    </div>
  );
}
