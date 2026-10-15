/**
 * SLAB-FÖRHANDSVISNINGEN FÖR GRATISKONTOT (ägarbeslut 2026-10-15): den som graderar
 * ett kort — i exemplararket, "+"-arket, på produktsidan eller i skannern — och inte
 * har Pro får paywall-arket med SITT kort i slabben. Samma ark, samma köpknapp
 * (`openPaywallOrNavigate`), bara bilden högst upp byts.
 */
import { collectionGrading } from "@/lib/graded-slab";
import { getSharedSession } from "@/lib/client-session";
import { openPaywallOrNavigate, type PaywallOpenOptions } from "@/lib/paywall";

export interface SlabPreviewSource {
  name: string;
  imageUrl: string | null;
  gradingCompany: string | null | undefined;
  grade: string | null | undefined;
}

/** Arkets alternativ — med förhandsvisning när posten är (fullständigt) graderad. */
export function slabPaywallOptions(row: SlabPreviewSource): PaywallOpenOptions {
  const g = collectionGrading(row.gradingCompany, row.grade);
  return {
    source: "collection-slab",
    ...(g
      ? { preview: { kind: "slab", imageUrl: row.imageUrl, issuer: g.issuer, gradeTenths: g.gradeTenths, name: row.name } }
      : {}),
  };
}

/**
 * Efter ett lyckat tillägg: graderat + inte Pro ⇒ arket. Väntar ut tilläggsarkets
 * nedglidning (två ark på varandra läser som ett fel). Pro, ograderat eller okänd
 * session ⇒ ingenting.
 */
export async function previewSlabIfFree(
  router: { push: (href: string) => void },
  row: SlabPreviewSource
): Promise<void> {
  if (!collectionGrading(row.gradingCompany, row.grade)) return;
  const session = await getSharedSession().catch(() => null);
  if (!session?.user || session.user.isPro) return;
  window.setTimeout(() => openPaywallOrNavigate(router, slabPaywallOptions(row)), 350);
}
