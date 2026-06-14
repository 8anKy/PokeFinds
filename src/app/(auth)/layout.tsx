import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-gradient px-4 py-12">
      <Link
        href="/"
        className="mb-8 font-display text-3xl font-extrabold tracking-tight text-ink"
      >
        Poke<span className="holo-text">Finds</span>
      </Link>
      <div className="card-surface w-full max-w-md p-6 shadow-card sm:p-8">{children}</div>
      <p className="mt-8 text-center text-xs text-ink-faint">
        © PokeFinds · Sveriges marknadsplats för Pokémon TCG
      </p>
    </div>
  );
}
