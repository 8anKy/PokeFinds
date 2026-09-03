import { revalidatePath } from "next/cache";

/**
 * Forumsidorna är ISR-cachade (5 min) och renderas om LAT efter en skrivning i
 * stället för att ha kort TTL — kostnadsdoktrinen: invalidera vid skrivning,
 * aldrig polla. Mönstret `/[locale]/…` + "page" är det repot redan använder
 * (`/api/revalidate`) och träffar båda språken på en gång.
 *
 * ⚠️ Grupp- och trådmönstren är BREDA: alla gruppsidor resp. alla trådsidor
 * kastas. Det är medvetet — en specifik sökväg måste gissa next-intls interna
 * rewrite (`/sv/forum/…`), och ett fel där hade varit tyst. Sidor ingen besöker
 * renderas ändå aldrig om.
 */
export function revalidateForum(opts: { group?: boolean; thread?: boolean } = {}) {
  revalidatePath("/[locale]/forum", "page");
  if (opts.group) revalidatePath("/[locale]/forum/g/[slug]", "page");
  if (opts.thread) revalidatePath("/[locale]/forum/t/[id]", "page");
}
