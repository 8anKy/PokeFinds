"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";

/**
 * Auth-sidornas logotyp. Normalt en länk till startsidan, MEN på
 * lösenordsåterställningen (nås via mejllänk i Safari) är den bara en bild —
 * inget som lockar användaren att browsa webben i stället för appen.
 */
export function AuthBrand() {
  const pathname = usePathname();
  const locked =
    pathname === "/aterstall-losenord" || pathname?.startsWith("/aterstall-losenord/");
  const logo = <BrandLogo markSize={44} textClass="text-3xl font-extrabold" />;
  if (locked) return <div className="mb-8">{logo}</div>;
  return (
    <Link href="/" className="mb-8" aria-label="Foilio — startsida">
      {logo}
    </Link>
  );
}
