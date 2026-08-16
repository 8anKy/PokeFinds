/**
 * SÖK + SORTERING I SAMLINGEN — REN logik, inga React-beroenden (testbar utan
 * next-intl), delad av BÅDA ytorna: desktoptabellen (`collection-client.tsx`)
 * och mobilrutnätet (`mobile-collection-grid.tsx`).
 *
 * ⛔ ALLT SKER KLIENT-SIDA på rader servern redan skickat. Ingen fetch, ingen
 * DB-läsning, ingen endpoint — samlingen är ett par hundra rader i minnet, och
 * en filtrering som väcker Neon kostar mer än hela funktionen är värd.
 *
 * ⛔ TILLSTÅNDET LIGGER ALDRIG I searchParams. Sidan får inte bli beroende av
 * URL:en (se Caching/ISR i CLAUDE.md) — mönstret är detsamma som de utfällda
 * gruppernas `openKeys`: lokalt state, dör med sidan.
 *
 * ORDNINGEN ÄR VIKTIG: FILTRERA POSTER → GRUPPERA → SORTERA GRUPPER.
 * Grupperingen bygger på POSTER (lots) via `lotKey`, aldrig på namnet — två köp
 * av samma vara till olika pris är två rader, och slås de ihop på namn kastas
 * det ena inköpspriset tyst (se .claude/rules/collection-portfolio.md). Ett
 * filter på namn/set träffar dessutom alltid ALLA poster i en grupp likadant
 * (de delar kort/produkt), så en grupp kan aldrig halveras av sökningen.
 */

export const COLLECTION_SORTS = ["recent", "value", "name", "quantity"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

/**
 * Standard = serverns ordning (createdAt desc, `listCollection`) — dvs "senast
 * tillagd". Den vyn hade användaren innan sorteringen fanns, så den som inte rör
 * kontrollen ser exakt samma samling som förut.
 */
export const DEFAULT_COLLECTION_SORT: CollectionSort = "recent";

export function isCollectionSort(value: string): value is CollectionSort {
  return (COLLECTION_SORTS as readonly string[]).includes(value);
}

/** Det sökningen läser. Bara text — värde/antal hör till sorteringen. */
export interface SearchableRow {
  name: string;
  setName?: string | null;
}

/**
 * Söktermen delas i ORD och alla måste träffa (AND). "charizard obsidian"
 * hittar alltså kortet i rätt set utan att användaren behöver veta i vilken
 * ordning namn och set står i strängen.
 */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(row: SearchableRow): string {
  return `${row.name} ${row.setName ?? ""}`.toLowerCase();
}

export function matchesCollectionQuery(row: SearchableRow, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = haystack(row);
  return tokens.every((token) => hay.includes(token));
}

/**
 * Filtrerar POSTERNA (inte grupperna) — resultatet grupperas efteråt, precis
 * som den ofiltrerade listan gör. Tom sökning returnerar samma array-referens,
 * så `useMemo` nedströms slipper räkna om något i normalfallet.
 */
export function filterCollectionRows<T extends SearchableRow>(
  rows: readonly T[],
  query: string
): readonly T[] {
  const tokens = tokenize(query.trim());
  if (tokens.length === 0) return rows;
  return rows.filter((row) => matchesCollectionQuery(row, tokens));
}

/** Det sorteringen behöver ur en post. */
export interface ValuedLot {
  name: string;
  quantity: number;
  /** Öre per styck, eller null när värdet är OKÄNT (aldrig 0 kr). */
  estimatedValue: number | null;
}

export interface SortableGroup {
  quantity: number;
  lots: readonly ValuedLot[];
}

/**
 * Gruppens TOTALA kända värde i öre — värdet per styck × antal, summerat över
 * de poster som HAR ett värde.
 *
 * ⛔ Poster utan värde bidrar med ingenting, de räknas inte som 0 kr. Har INGEN
 * post i gruppen ett värde är hela gruppens värde `null` = "vi vet inte", och
 * sorteringen lägger den SIST i stället för att låtsas att den är värd noll.
 */
export function groupTotalValue(lots: readonly ValuedLot[]): number | null {
  let total = 0;
  let known = 0;
  for (const lot of lots) {
    if (lot.estimatedValue == null) continue;
    known += 1;
    total += lot.estimatedValue * lot.quantity;
  }
  return known > 0 ? total : null;
}

/**
 * Sorterar de GRUPPERADE varorna. Sorteringen är STABIL: index in i listan är
 * alltid sista jämförelsenyckel, så två varor med samma värde (eller samma
 * antal) behåller serverns ordning i stället för att hoppa runt mellan
 * renderingar.
 *
 * ⛔ Okänt värde sorteras SIST i BÅDA riktningarna av "värde" — det är enda
 * sorteringen som har ett null-fall, och en okänd siffra får aldrig blandas in
 * bland de riktiga.
 */
export function sortCollectionGroups<G extends SortableGroup>(
  groups: readonly G[],
  sort: CollectionSort
): G[] {
  const decorated = groups.map((group, index) => ({ group, index }));
  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;

  decorated.sort((a, b) => {
    switch (sort) {
      case "value": {
        const va = groupTotalValue(a.group.lots);
        const vb = groupTotalValue(b.group.lots);
        if (va == null && vb == null) return byIndex(a, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va || byIndex(a, b);
      }
      case "name": {
        // Svensk kollation: å/ä/ö hamnar sist i alfabetet, inte bland a/o.
        const cmp = (a.group.lots[0]?.name ?? "").localeCompare(
          b.group.lots[0]?.name ?? "",
          "sv"
        );
        return cmp || byIndex(a, b);
      }
      case "quantity":
        return b.group.quantity - a.group.quantity || byIndex(a, b);
      case "recent":
      default:
        // Serverns ordning ÄR "senast tillagd" (createdAt desc) — ingen
        // omsortering behövs, och `purchaseDate` är fel fält: det är när kortet
        // KÖPTES, inte när posten lades in.
        return byIndex(a, b);
    }
  });

  return decorated.map((d) => d.group);
}
