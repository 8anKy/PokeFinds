import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-gradient px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Foilio — startsida">
        <BrandLogo markSize={36} textClass="text-3xl font-extrabold" />
      </Link>
      <div className="card-surface w-full max-w-md p-6 shadow-card sm:p-8">{children}</div>
      <p className="mt-8 text-center text-xs text-ink-faint">
        © Foilio · Sveriges marknadsplats för Pokémon TCG
      </p>
    </div>
  );
}
