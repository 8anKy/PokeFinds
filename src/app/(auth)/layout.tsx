import type { ReactNode } from "react";
import { AuthBrand } from "@/components/layout/auth-brand";
import { AuthKeyboardScroll } from "@/components/layout/auth-keyboard-scroll";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-start overflow-y-auto bg-surface-gradient px-4 pb-24 mt-[calc(env(safe-area-inset-top)*-1)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <AuthKeyboardScroll />
      <AuthBrand />
      <div className="card-surface w-full max-w-md p-6 shadow-card sm:p-8">{children}</div>
      <p className="mt-8 text-center text-xs text-ink-faint">
        © Foilio · Sveriges marknadsplats för Pokémon TCG
      </p>
    </div>
  );
}
