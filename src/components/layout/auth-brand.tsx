"use client";

import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { BrandLogo } from "@/components/layout/brand-logo";
import { isEmailLandingRoute } from "@/lib/auth-routes";

/**
 * Auth-sidornas logotyp. Normalt en länk till startsidan, MEN på sidor som nås via
 * mejllänk i Safari (återställ lösenord, verifiera e-post) är den bara en bild —
 * inget som lockar användaren att browsa webben i stället för appen.
 */
export function AuthBrand() {
  const pathname = usePathname();
  const locked = isEmailLandingRoute(pathname);
  const logo = <BrandLogo markSize={44} textClass="text-3xl font-extrabold" />;
  if (locked) return <div className="mb-8">{logo}</div>;
  return (
    <Link href="/" className="mb-8" aria-label="Foilio startsida">
      {logo}
    </Link>
  );
}
