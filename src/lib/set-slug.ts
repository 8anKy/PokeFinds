/**
 * LÄSBARA SET-ADRESSER (2026-10-07): `/sets/30th-celebration` i stället för
 * `/sets/cms68t7hc0000aw9sr3ocbldn`. Ordet i URL:en är en (liten) rankningssignal och
 * syns i sökresultatet; ett cuid säger ingenting.
 *
 * ⛔ SLUGEN ÄR EN ADRESS, INTE EN IDENTITET. All logik (completion-API, bevakning,
 * katalogfiltret `?set=`) går fortfarande på `CardSet.id`. Setsidan tar emot BÅDA och
 * 308:ar id-adressen till slugen, så gamla länkar (Discord, Google, appen) lever.
 * ⛔ En slug ändras ALDRIG när den väl satts (backfillen fyller bara NULL) — en ändrad
 * slug är en ny URL och kastar sidans historik i Google.
 */

/** Gemener, diakriter bort, allt utom a–z/0–9 blir bindestreck. */
export function slugifySetName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Förstahandsförslaget: namnet, plus `-jp` för japanska set (som produkternas slugs). */
export function baseSetSlug(name: string, language: string): string {
  const base = slugifySetName(name);
  if (!base) return "";
  return language === "JP" ? `${base}-jp` : base;
}

/**
 * Unika slugs för en lista set. Kollision ⇒ seriens namn läggs till, sedan släppåret,
 * sist id:ts sista sex tecken. `taken` = slugs som redan finns i databasen.
 */
export function assignSetSlugs(
  sets: { id: string; name: string; series: string; language: string; releaseDate: Date | null }[],
  taken: Set<string>
): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set(taken);
  // Äldst först: originalsetet får det korta namnet, en senare namne får tillägget.
  const ordered = [...sets].sort(
    (a, b) => (a.releaseDate?.getTime() ?? Infinity) - (b.releaseDate?.getTime() ?? Infinity) || a.id.localeCompare(b.id)
  );
  for (const s of ordered) {
    const base = baseSetSlug(s.name, s.language) || `set-${s.id.slice(-6)}`;
    const series = slugifySetName(s.series);
    const year = s.releaseDate ? String(s.releaseDate.getUTCFullYear()) : "";
    const candidates = [
      base,
      series && !base.startsWith(series) ? `${base}-${series}` : "",
      year ? `${base}-${year}` : "",
      `${base}-${s.id.slice(-6)}`,
    ].filter(Boolean);
    const slug = candidates.find((c) => !used.has(c)) ?? `${base}-${s.id}`;
    used.add(slug);
    out.set(s.id, slug);
  }
  return out;
}

/** Setsidans väg — slugen när den finns, annars id:t (sidan 308:ar då själv vidare). */
export function setPath(set: { id: string; slug?: string | null }): string {
  return `/sets/${encodeURIComponent(set.slug || set.id)}`;
}
