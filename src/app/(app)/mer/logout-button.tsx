"use client";

import { signOut } from "next-auth/react";
import { IconLogout } from "@/components/ui/icons";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-surface-border px-4 py-3 text-sm font-semibold text-fall transition-colors hover:bg-surface-overlay"
    >
      <IconLogout size={18} className="shrink-0" />
      Logga ut
    </button>
  );
}
