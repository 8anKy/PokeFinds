/**
 * Forumets grupper heter det de heter i DATABASEN — på svenska ("Allmänt").
 * Forumet är tvåspråkigt, så namn och beskrivning slås upp i messages
 * (`ForumGroups.<slug>.name` / `.description`) med DB-värdet som fallback för en
 * grupp som saknar översättning. Slugarna är kurerade (skapas av migration), så
 * nyckelmängden är känd och `t.has` avgör om det finns en översättning — ingen
 * dubbel lista att hålla i synk. Ett slug innehåller aldrig punkt, så det kan
 * stå som nyckelsegment.
 */

/** Minsta gemensamma nämnare för `useTranslations("ForumGroups")` och server-varianten. */
export interface GroupTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export function localizeGroupName(slug: string, fallback: string, t: GroupTranslator): string {
  const key = `${slug}.name`;
  return t.has(key) ? t(key) : fallback;
}

export function localizeGroup<G extends { slug: string; name: string; description: string }>(
  group: G,
  t: GroupTranslator
): G {
  const nameKey = `${group.slug}.name`;
  const descKey = `${group.slug}.description`;
  if (!t.has(nameKey)) return group;
  return {
    ...group,
    name: t(nameKey),
    description: t.has(descKey) ? t(descKey) : group.description,
  };
}
