"use client";

/**
 * Mobilens samlings-rutnät (app-känsla):
 *  - Tryck på ett objekt → öppna produktsidan (inspektera, precis som i Utforska).
 *  - Håll inne (long-press) ELLER tryck "Välj" → väljläge: bocka i flera objekt och
 *    radera dem på en gång. Radering går mot DELETE /api/collection/{id}.
 *  - Tryck på vinstraden (eller "Lägg till köppris") → sätt/ändra köppris. Mobilen är
 *    appens huvudyta men saknade helt redigering, så köppriset gick bara att sätta från
 *    desktop-tabellen — och utan köppris kan ingen vinst räknas.
 *
 * POSTER (LOTS): samma vara köpt flera gånger till olika pris ligger som FLERA rader i
 * databasen. Rutnätet visar EN ruta per vara med totalantal + snittpris och en
 * utfällare för de enskilda köpen. Grupper med ETT köp — den absoluta merparten —
 * renderas exakt som förut: ingen chevron, ingen snittrad, ingen extra krom.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { formatPrice, formatPercent, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { Input, Label, FieldError } from "@/components/ui/input";
import {
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconPackage,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import { openProductOverlay } from "@/lib/product-overlay-open";
import { planCopyEdits } from "@/lib/collection-lots";
import type { CollectionRow } from "./collection-client";
import { hapticTick } from "@/lib/haptics";
import { parseKronorToOre } from "@/lib/purchase-price";
// Traderas EGEN vokabulär för gradering (attribut 125/126, hämtad ur deras
// referensdata). Samlingen använder samma ord så att en senare annons kan bära
// värdet rakt av — utan översättning och utan att bli "Övriga" i onödan.
import { GRADES, GRADING_ISSUERS } from "@/lib/tradera-listing-options";
import {
  groupCollectionLots,
  groupProfit,
  groupUnitValue,
  oreToKr,
  profitToneClass,
  rowProfit,
} from "./profit";
import {
  DEFAULT_COLLECTION_SORT,
  filterCollectionRows,
  sortCollectionGroups,
  type CollectionSort,
} from "./collection-filter";
import { CollectionToolbar } from "./collection-toolbar";
import { SellButton } from "@/components/features/sell-sheet";
import { toSellItem } from "./sell-item";

const LONG_PRESS_MS = 450;

/**
 * Skicken samlingen känner — samma nycklar som `CardCondition` i schemat.
 * SEALED står sist: det gäller förseglade produkter, inte lösa kort, men båda
 * kan ligga i samma rutnät.
 */
const COLLECTION_CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "EXCELLENT",
  "GOOD",
  "PLAYED",
  "POOR",
  "SEALED",
] as const;

/**
 * ETT EXEMPLAR i exemplararket.
 *
 * ⛔ DATABASEN LAGRAR KÖP (lots) MED ANTAL, INTE EXEMPLAR. Ett köp av fyra kort
 * är EN rad med `quantity: 4` — de fyra exemplaren är oskiljaktiga där, och det
 * är rätt: de kostade samma sak samma dag och är i samma skick. Arket vecklar ut
 * dem så att man kan peka på ETT av dem, och `planCopyEdits` viker ihop dem
 * igen: ett exemplar som fått egna uppgifter bryts ut till ett EGET köp (samma
 * regel som lib/collection-lots.ts vilar på — två köp är två poster, aldrig ett
 * snitt).
 */
interface CopyRow {
  /** Köpet exemplaret kommer ur. Flera rader delar id när köpet hade quantity > 1. */
  lotId: string;
  /** Radens nyckel — stabil över renderingar. */
  key: string;
  /** Köppris i kronor som redigerbar sträng. Tomt = inget pris (≠ 0 kr). */
  price: string;
  condition: string;
  /** "" = ograderat. Traderas vokabulär, så att en senare annons kan bära den rakt av. */
  gradingCompany: string;
  grade: string;
  /** Ibockat = ska tas bort när man sparar. */
  remove: boolean;
}

/** De valda köpen → en rad per exemplar, i markeringens ordning. */
function expandCopies(lots: readonly CollectionRow[]): CopyRow[] {
  const out: CopyRow[] = [];
  for (const lot of lots) {
    for (let i = 0; i < lot.quantity; i++) {
      out.push({
        lotId: lot.id,
        key: `${lot.id}:${i}`,
        price: oreToKr(lot.purchasePrice),
        condition: lot.condition,
        gradingCompany: lot.gradingCompany ?? "",
        grade: lot.grade ?? "",
        remove: false,
      });
    }
  }
  return out;
}

/** Har exemplaret ändrats sedan arket öppnades? */
function copyDiffers(copy: CopyRow, lot: CollectionRow | undefined): boolean {
  if (!lot) return false;
  return (
    copy.price.trim() !== oreToKr(lot.purchasePrice).trim() ||
    copy.condition !== lot.condition ||
    copy.gradingCompany !== (lot.gradingCompany ?? "") ||
    copy.grade !== (lot.grade ?? "")
  );
}

/** Chip — samma form som säljarkets val (skick, gradering). */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
        active ? "bg-holo-cyan text-surface" : "bg-surface-overlay text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

/** Rubrik över en sektion i arket — samma form som säljarket. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </p>
  );
}

export function MobileCollectionGrid({ rows }: { rows: CollectionRow[] }) {
  const t = useTranslations("Collection");
  const locale = useLocale();
  const tc = useTranslations("Common");
  const tCond = useTranslations("Condition");
  const router = useRouter();
  const { toast } = useToast();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  /**
   * EXEMPLARARKET: de markerade KÖPEN och en rad per EXEMPLAR ur dem.
   *
   * ⛔ Var förut en modal med ett antalsfält ("hur många ska tas bort?") — den
   * kunde varken visa VILKA exemplar man har eller vad de kostade, och en pop-up
   * mitt på skärmen är inte appens form (ägarbeslut 2026-09-07).
   * ⛔ Och den tar FLERA VAROR, inte bara en: markerar man tre olika kort ska man
   * kunna gå igenom dem i remsan, rätta pris/skick/gradering på var och en och
   * bocka i just de som ska bort. Massraderingen finns kvar — den bor bara här
   * inne, där man ser vad man tar bort (ägaren 2026-09-07).
   */
  const [copyLots, setCopyLots] = useState<CollectionRow[] | null>(null);
  const [copies, setCopies] = useState<CopyRow[]>([]);
  /** Vilket exemplar i remsan man redigerar. */
  const [copyIndex, setCopyIndex] = useState(0);
  // Långtryck i remsan markerar exemplaret för borttagning — samma gest som i
  // rutnätet, så flera kan bockas i utan att man går in i vart och ett.
  const copyPressTimer = useRef<number | null>(null);
  const copyLongPressed = useRef(false);
  // Köppris-redigering (per post, i kronor — lagras i öre).
  const [priceTarget, setPriceTarget] = useState<CollectionRow | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);

  // Utfällda grupper (nyckel från groupLots). Rent lokalt state — INGA URL-parametrar:
  // sidan får inte bli beroende av searchParams (se Caching/ISR i CLAUDE.md).
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  // Sök + sortering. Samma regel: lokalt state, ingen URL, ingen ny hämtning —
  // raderna finns redan i minnet (se collection-filter.ts).
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CollectionSort>(DEFAULT_COLLECTION_SORT);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const panelIdBase = useId();

  // En ruta per VARA. Poster utan pris räknas aldrig in i snittet — groupLots
  // rapporterar costedQuantity så gränssnittet kan säga hur många snittet gäller.
  const allGroups = useMemo(() => groupCollectionLots(rows), [rows]);

  // FILTRERA POSTER → GRUPPERA → SORTERA GRUPPER. Grupperingen måste ske EFTER
  // filtreringen (den bygger på poster, aldrig på namn) och sorteringen på
  // grupperna (det är dem rutnätet ritar). Tom sökning återanvänder den redan
  // grupperade listan — filterCollectionRows returnerar då samma referens.
  const groups = useMemo(() => {
    const filtered = filterCollectionRows(rows, query);
    const base = filtered === rows ? allGroups : groupCollectionLots(filtered);
    return sortCollectionGroups(base, sort);
  }, [rows, allGroups, query, sort]);

  const filterActive = query.trim().length > 0;

  /** De markerade köpen, i rutnätets ordning. */
  const selectedLots = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );

  // Markeringen gäller alltid ENSKILDA poster (det är dem API:t raderar). En grupp
  // markeras genom att alla dess poster markeras — allt-eller-inget, så ett andra
  // tryck på rutan tömmer den igen i stället för att låsa sig i "delvis vald".
  const toggleMany = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const startPress = useCallback(
    (ids: readonly string[]) => {
      longPressed.current = false;
      pressTimer.current = window.setTimeout(() => {
        longPressed.current = true;
        // Taktil kvittens att långtrycket löste ut — samma som snabbtillägget
        // (collection-quick-add). Väljläget syns först när verktygsraden bytt ut
        // sig, så utan den känns gesten som att ingenting hände.
        hapticTick();
        setSelectMode(true);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
      }, LONG_PRESS_MS);
    },
    []
  );

  const cancelPress = useCallback(() => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(
    (lots: readonly CollectionRow[]) => {
      const row = lots[0];
      if (longPressed.current) {
        longPressed.current = false;
        return; // long-press hanterades redan (gick in i väljläge)
      }
      if (selectMode) {
        toggleMany(lots.map((l) => l.id));
        return;
      }
      if (row.slug) {
        // Öppna overlayn (svep-tillbaka funkar) — på touch. Faller tillbaka på
        // vanlig nav om overlayn inte är tillgänglig (desktop).
        if (!openProductOverlay(row.slug)) router.push(`/produkter/${row.slug}`);
      } else {
        toast({
          title: t("gridNoProductTitle"),
          description: t("gridNoProductDesc"),
          variant: "error",
        });
      }
    },
    [router, selectMode, toggleMany, toast, t]
  );

  /**
   * Verktygsradens knapp: öppna exemplararket för ALLT som är markerat.
   *
   * ⛔ INGEN EGEN MASSRADERINGSVÄG LÄNGRE (ägaren 2026-09-07). Flera markerade
   * kort gick förut rakt på `window.confirm("radera N?")` — man såg aldrig VAD
   * man tog bort, kunde inte rätta ett pris på vägen, och knappen hette därför
   * "Radera" fast en enskild vara öppnade en redigerare. Nu leder EN väg in:
   * arket visar varje exemplar ur markeringen, man bockar i det som ska bort
   * och sparar. Massraderingen finns kvar — den syns bara innan den sker.
   */
  function editSelected() {
    if (selectedLots.length === 0) return;
    openCopySheet(selectedLots);
  }

  /** Antal exemplar som är ibockade för borttagning. */
  const removeCount = copies.filter((c) => c.remove).length;
  /**
   * MARKERINGSLÄGET ÄR HÄRLETT, INTE ETT EGET STATE (ägaren 2026-09-07):
   * "är alla omarkerade är läget inte längre aktivt förrän man håller in igen".
   * Räknar man det ur markeringarna KAN de två aldrig gå isär.
   */
  const removeMode = removeCount > 0;
  /** Något ändrat på ett exemplar som INTE ska bort? */
  const copiesChanged = copies.some(
    (c) => !c.remove && copyDiffers(c, copyLots?.find((l) => l.id === c.lotId))
  );
  const activeCopy = copies[copyIndex] ?? null;

  /** Skriv ett fält på exemplaret man redigerar. */
  function patchCopy(patch: Partial<CopyRow>) {
    setCopies((prev) => prev.map((c, i) => (i === copyIndex ? { ...c, ...patch } : c)));
  }

  function openCopySheet(lots: readonly CollectionRow[]) {
    setCopies(expandCopies(lots));
    setCopyIndex(0);
    setCopyLots([...lots]);
  }

  function closeCopySheet() {
    cancelCopyPress();
    setCopyLots(null);
    setCopies([]);
  }

  /** Köpet ett exemplar kommer ur — bilden, namnet och setet ritas ur det. */
  function lotOf(copy: CopyRow | null): CollectionRow | undefined {
    return copy ? copyLots?.find((l) => l.id === copy.lotId) : undefined;
  }

  /** Växla borttagningsmarkeringen på ETT exemplar (index i remsan). */
  function toggleCopyRemove(index: number) {
    setCopies((prev) => prev.map((x, j) => (j === index ? { ...x, remove: !x.remove } : x)));
  }

  /**
   * HÅLL IN ETT EXEMPLAR I REMSAN = markera det för borttagning.
   *
   * ⛔ Utan den gick flera exemplar bara att bocka i ett i taget: välj i remsan,
   * scrolla ner till knappen, tryck, tillbaka upp, nästa (ägaren 2026-09-07).
   * Samma gest och samma taktila kvittens som långtrycket i rutnätet — den som
   * lärt sig den ena kan den andra.
   */
  function startCopyPress(index: number) {
    copyLongPressed.current = false;
    copyPressTimer.current = window.setTimeout(() => {
      copyLongPressed.current = true;
      hapticTick();
      toggleCopyRemove(index);
    }, LONG_PRESS_MS);
  }

  function cancelCopyPress() {
    if (copyPressTimer.current != null) {
      clearTimeout(copyPressTimer.current);
      copyPressTimer.current = null;
    }
  }

  /**
   * Ett vanligt tryck — men inte när långtrycket redan svarat.
   *
   * ⛔ I MARKERINGSLÄGET MARKERAR TRYCKET, det byter inte exemplar. Att behöva
   * hålla in vart och ett var hela klagomålet: håll in EN gång, tryck sedan på
   * resten (ägaren 2026-09-07). Ett andra tryck ångrar, och när det sista
   * markerade släpps faller läget bort av sig självt — se `removeMode`.
   */
  function pickCopy(index: number) {
    if (copyLongPressed.current) {
      copyLongPressed.current = false;
      return;
    }
    if (removeMode) toggleCopyRemove(index);
    else setCopyIndex(index);
  }

  /**
   * VECKAR IHOP EXEMPLAREN TILL KÖP IGEN och skriver skillnaden.
   *
   * Per köp: de överlevande exemplaren grupperas på sitt pris. Första gruppen
   * behåller köpets rad (PATCH antal + pris), övriga blir EGNA köp (POST) —
   * exakt vad två priser är i den här modellen. Överlever inga raderas köpet.
   * ⛔ Tomt fält betyder "vet inte", inte 0 kr, och skrivs som `null`.
   */
  async function applyCopyChanges() {
    const lots = copyLots;
    if (!lots) return;
    const total = copies.length;
    // Planen är REN och testad (lib/collection-lots.ts) — den här funktionen
    // gör bara skrivningarna, i den ordning planen anger.
    const plan = planCopyEdits(
      lots,
      copies.map((c) => {
        const parsed = parseKronorToOre(c.price);
        const lot = lots.find((l) => l.id === c.lotId);
        return {
          lotId: c.lotId,
          remove: c.remove,
          // Ogiltig inmatning behåller köpets nuvarande pris i stället för att
          // tyst nolla det; tomt fält betyder "vet inte" och skrivs som null.
          purchasePrice:
            parsed.kind === "ok"
              ? parsed.ore
              : parsed.kind === "empty"
                ? null
                : (lot?.purchasePrice ?? null),
          condition: c.condition,
          // ⛔ Bolag UTAN betyg säger ingenting om kortet — då är det ograderat.
          gradingCompany: c.gradingCompany && c.grade ? c.gradingCompany : null,
          grade: c.gradingCompany && c.grade ? c.grade : null,
        };
      })
    );

    setDeleting(true);
    let failed = 0;
    try {
      for (const lot of plan.deletes) {
        try {
          await apiFetch(`/api/collection/${lot.id}`, { method: "DELETE" });
        } catch {
          failed += 1;
        }
      }
      for (const { lot, quantity, purchasePrice, condition, gradingCompany, grade } of plan.patches) {
        try {
          await apiFetch(`/api/collection/${lot.id}`, {
            method: "PATCH",
            body: { quantity, purchasePrice, condition, gradingCompany, grade },
          });
        } catch {
          failed += 1;
        }
      }
      // ⛔ SIST — se `planCopyEdits`: en skapelse kan STAPLA på ett köp, och gör
      // den det innan köpet skrivits om försvinner exemplaren tyst.
      for (const { lot, quantity, purchasePrice, condition, gradingCompany, grade } of plan.creates) {
        try {
          await apiFetch("/api/collection", {
            method: "POST",
            body: {
              ...(lot.cardId ? { cardId: lot.cardId } : {}),
              ...(lot.productId ? { productId: lot.productId } : {}),
              quantity,
              condition,
              language: lot.language,
              ...(purchasePrice != null ? { purchasePrice } : {}),
              ...(lot.purchaseDate ? { purchaseDate: lot.purchaseDate } : {}),
              ...(gradingCompany ? { gradingCompany } : {}),
              ...(grade ? { grade } : {}),
            },
          });
        } catch {
          failed += 1;
        }
      }
      toast({
        title: failed > 0 ? t("gridPartialTitle") : t("gridDeletedTitle"),
        description:
          plan.removed > 0
            ? t("gridRemovedDesc", { count: plan.removed, total })
            : undefined,
        variant: failed > 0 ? "error" : "success",
      });
    } finally {
      setDeleting(false);
      closeCopySheet();
      exitSelect();
      router.refresh();
    }
  }

  function openPriceEditor(row: CollectionRow) {
    setPriceTarget(row);
    // Förifyll med befintligt köppris i kronor (komma som decimaltecken, som svenskar skriver).
    setPriceInput(oreToKr(row.purchasePrice));
    setPriceError(null);
  }

  // Sparar köppris i ÖRE. Tomt fält = nolla priset igen (posten faller då ur vinsten
  // i stället för att ligga kvar med ett felinmatat värde).
  async function savePurchasePrice() {
    if (!priceTarget) return;
    const parsed = parseKronorToOre(priceInput);
    if (parsed.kind === "invalid") {
      setPriceError(t("priceInvalidError"));
      return;
    }
    setSavingPrice(true);
    try {
      await apiFetch(`/api/collection/${priceTarget.id}`, {
        method: "PATCH",
        body: { purchasePrice: parsed.kind === "ok" ? parsed.ore : null },
      });
      toast({ title: t("updatedToast"), variant: "success" });
      setPriceTarget(null);
      router.refresh();
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSavingPrice(false);
    }
  }

  return (
    <section className="lg:hidden">
      {/* Sektionshuvud / väljlägets verktygsrad */}
      {/* ⛔ VERKTYGSRADEN MÅSTE FÖLJA MED I VÄLJLÄGET (ägaren 2026-09-07):
          markerade man ett kort långt ned fick man scrolla hela vägen upp igen
          för att komma åt knappen. Sticky BARA i väljläget — annars skulle
          sektionsrubriken ligga och klistra i vanlig bläddring. Bleedet
          (-mx-2.5 + px-2.5) är sidans egen vågräta luft, så bakgrunden når kant
          till kant i stället för att lämna två genomskinliga remsor. */}
      <div
        className={cn(
          "mb-3 flex items-center justify-between gap-2",
          selectMode &&
            "hairline-b sticky top-0 z-20 -mx-2.5 bg-surface px-2.5 pb-2 sm:-mx-6 sm:px-6"
        )}
        // ⛔ SAFE-AREAN LIGGER I PADDINGEN, INTE I `top` (ägaren 2026-09-07).
        // Sticky mäter mot vyportens kant och bryr sig inte om att body har
        // `padding-top: env(safe-area-inset-top)`. Med `top: <safe-area>` hamnade
        // raden rätt men lämnade en GENOMSKINLIG remsa ovanför sig, där korten
        // rullade förbi under klockan. Med `top: 0` + paddingen inuti spänner
        // elementets egen svarta bakgrund hela vägen upp. Inline style, inte ett
        // arbiträrt Tailwind-värde: `calc()` med mellanslag tappas TYST där.
        style={
          selectMode ? { paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" } : undefined
        }
      >
        {selectMode ? (
          <>
            <button
              type="button"
              onClick={exitSelect}
              className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <IconX size={16} /> {t("gridSelectCancel")}
            </button>
            <span className="text-sm font-semibold text-ink">{t("gridSelected", { count: selected.size })}</span>
            {/* ⛔ ALLTID "Redigera" — knappen öppnar en redigerare, aldrig en
                radering. Att ta bort görs inifrån arket, per exemplar. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={editSelected}
              loading={deleting}
              disabled={selected.size === 0}
            >
              <IconEdit size={16} /> {tc("edit")}
            </Button>
          </>
        ) : (
          <>
            <h2 className="font-display text-xl font-bold text-ink">{t("gridYourCollection")}</h2>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="text-sm font-semibold text-holo-cyan hover:underline"
            >
              {t("gridSelect")}
            </button>
          </>
        )}
      </div>

      {/* Sök + sortering. Göms i VÄLJLÄGET med flit: markeringen gäller poster,
          och ett filter som ändras mitt i ett urval hade dolt vad man raderar. */}
      {!selectMode && (
        <CollectionToolbar
          idPrefix="m-collection"
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          matchCount={groups.length}
          totalCount={allGroups.length}
          className="mb-3"
        />
      )}

      {/* Tomläge för filtret — samlingen är inte tom, sökningen träffade bara
          ingenting, så vägen ut är att rensa den (inte att lägga till kort). */}
      {filterActive && groups.length === 0 && (
        <div className="card-surface flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="text-ink-faint">
            <IconPackage size={26} />
          </span>
          <p className="text-sm font-medium text-ink">
            {t("filterNoMatchTitle", { query: query.trim() })}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
            {t("filterClear")}
          </Button>
        </div>
      )}

      {/* Rutnätet renderas alltid; är listan tom ritas ingenting (tomläget ovan
          bär beskedet), så resten av filen står kvar orörd. */}
      <div className="grid grid-cols-2 gap-3">
        {groups.map((g, index) => {
          const r = g.lots[0];
          const multi = g.lots.length > 1;
          const ids = g.lots.map((l) => l.id);
          const isSelected = ids.every((id) => selected.has(id));
          const anySelected = ids.some((id) => selected.has(id));
          // Ensam post → EXAKT dagens siffror (groupUnitValue/groupProfit reducerar
          // till rowProfit när gruppen bara har ett köp), så den vanliga rutan är
          // oförändrad. Flera köp → gruppens tal.
          const unitValue = groupUnitValue(g.lots);
          const profit = multi ? groupProfit(g.lots) : rowProfit(r);
          const quantity = multi ? g.quantity : r.quantity;
          // I väljläget vecklas grupper ALLTID ut: markeringen gäller enskilda poster
          // och en hopfälld grupp hade dolt vad man faktiskt raderar.
          const open = openKeys.has(g.key) || (multi && selectMode);
          const panelId = `${panelIdBase}-lots-${index}`;
          // Snittet får ALDRIG läsas som att det gäller alla exemplar. Täcker det bara
          // en del av dem säger etiketten det rakt ut ("snitt 400 kr · 1 av 4"), och
          // saknas pris helt står det att priset saknas — aldrig "0 kr".
          const avgLabel = !multi
            ? null
            : g.averagePaid == null
              ? t("lotAvgUnknown")
              : g.costedQuantity < g.quantity
                ? t("lotAvgPartial", {
                    price: formatPrice(g.averagePaid),
                    costed: g.costedQuantity,
                    total: g.quantity,
                  })
                : t("lotAvgPaid", { price: formatPrice(g.averagePaid) });
          return (
            <div
              key={g.key}
              role="button"
              tabIndex={0}
              onClick={() => handleClick(g.lots)}
              onPointerDown={() => startPress(ids)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              className={`card-surface relative flex flex-col gap-2 p-3 text-left transition-colors ${
                anySelected ? "border-holo-cyan ring-1 ring-holo-cyan" : ""
              }`}
            >
              {/* Markering i väljläget */}
              {selectMode && (
                <span
                  className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-holo-cyan bg-holo-cyan text-black"
                      : "border-surface-border bg-surface/80 text-transparent"
                  }`}
                >
                  <IconCheck size={14} />
                </span>
              )}
              {/* Bildbrunnen är SVART som resten av kortet — exakt samma behandling som
                  Utforska-kortet (product-card.tsx). `surface-overlay` är en INTERAKTIV
                  fyllning (hover, flikar, skeletons), inte en bakgrund: som brunn lyste
                  den som en grå ruta bakom varje bild och fick hela portföljen att läsa
                  som en annan yta än katalogen. Saknad bild → ikonen bär platshållaren. */}
              <div className="h-28 w-full overflow-hidden rounded-lg bg-surface">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <IconPackage size={26} />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                {r.setName && <p className="truncate text-xs text-ink-muted">{r.setName}</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {unitValue != null ? formatPrice(unitValue) : "–"}
                </span>
                {quantity > 1 && <span className="text-xs text-ink-muted">{t("pieces", { count: quantity })}</span>}
              </div>
              {/* Snittraden finns BARA när varan köpts flera gånger — en ensam post har
                  inget snitt att tala om, och kortet ska då se ut precis som förut. */}
              {avgLabel && !selectMode && (
                <p className="truncate text-xs text-ink-muted">{avgLabel}</p>
              )}
              {/* Vinst/förlust — belopp först, procent som stöd. Saknas köppris visas en
                  uppmaning i stället: det är enda sättet posten kan komma med i totalen.
                  Knappen stoppar bubblingen så kortets "öppna produkt"-tryck inte utlöses.
                  ⛔ För en GRUPP är knappen en ren text: "sätt köppris" är en åtgärd på
                  EN post, och gruppen vet inte vilken — köpen redigeras i utfällningen. */}
              {!selectMode && multi && profit && (
                <span
                  className={`text-xs font-semibold tabular-nums ${profitToneClass(profit.amount)}`}
                  title={
                    g.costedQuantity < g.quantity
                      ? t("lotProfitPartialHint", { costed: g.costedQuantity, total: g.quantity })
                      : undefined
                  }
                >
                  {profit.amount > 0 ? "+" : ""}
                  {formatPrice(profit.amount)}
                  {profit.percent != null && (
                    <span className="ml-1 font-normal opacity-80">({formatPercent(profit.percent)})</span>
                  )}
                </span>
              )}
              {!selectMode && !multi && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPriceEditor(r);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`-mx-1 rounded px-1 py-0.5 text-left text-xs font-semibold tabular-nums transition-colors hover:bg-surface-overlay/50 ${
                    profit ? profitToneClass(profit.amount) : "text-holo-cyan"
                  }`}
                >
                  {profit ? (
                    <>
                      {profit.amount > 0 ? "+" : ""}
                      {formatPrice(profit.amount)}
                      {profit.percent != null && (
                        <span className="ml-1 font-normal opacity-80">
                          ({formatPercent(profit.percent)})
                        </span>
                      )}
                    </>
                  ) : (
                    t("gridAddPurchasePrice")
                  )}
                </button>
              )}
              {/* Sälj-knappen gäller EN post (annonsen får ett köppris ur just den).
                  Med flera köp flyttar den därför in i utfällningen, en per post. */}
              {!selectMode && !multi && (
                <span
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <SellButton item={toSellItem(r)} className="w-full" />
                </span>
              )}

              {/* Utfällaren — bara flera köp får den. Riktig <button> med aria-expanded
                  /aria-controls så den går att nå och förstå med tangentbord och skärmläsare. */}
              {multi && !selectMode && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(g.key);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="-mx-1 flex items-center justify-between gap-1 rounded px-1 py-0.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-overlay/50 hover:text-ink"
                >
                  <span className="truncate">{t("lotCount", { count: g.lots.length })}</span>
                  <IconChevronDown
                    size={14}
                    className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
              )}

              {/* Köpen, ett per rad. Ligger kvar i DOM:en även hopfälld så aria-controls
                  alltid pekar på något — det är utfällaren som byter tillstånd, inte
                  målet som försvinner. */}
              {multi && (
                <ul
                  id={panelId}
                  className={`${open ? "" : "hidden"} space-y-2 border-t border-surface-border pt-2`}
                >
                  {g.lots.map((lot) => {
                    const lotSelected = selected.has(lot.id);
                    return (
                      <li key={lot.id} className="flex flex-col gap-1">
                        <button
                          type="button"
                          aria-pressed={selectMode ? lotSelected : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Väljläge → markera just den här posten. Annars → sätt/ändra
                            // DESS köppris (aldrig gruppens: priserna är olika, det är
                            // hela poängen med poster).
                            if (selectMode) toggleMany([lot.id]);
                            else openPriceEditor(lot);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`-mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight tabular-nums transition-colors hover:bg-surface-overlay/50 ${
                            selectMode && lotSelected ? "bg-holo-cyan/10 text-ink" : ""
                          }`}
                        >
                          {selectMode && (
                            <IconCheck
                              size={12}
                              className={`shrink-0 ${lotSelected ? "text-holo-cyan" : "text-ink-faint"}`}
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="text-ink">{t("pieces", { count: lot.quantity })}</span>
                            <span className="text-ink-muted"> · </span>
                            {/* Saknat pris är "–", ALDRIG 0 kr: noll betyder "fick gratis". */}
                            <span
                              className={
                                lot.purchasePrice != null ? "font-semibold text-ink" : "text-ink-faint"
                              }
                            >
                              {lot.purchasePrice != null ? formatPrice(lot.purchasePrice) : "–"}
                            </span>
                            <span className="block truncate text-ink-faint">
                              {formatDate(lot.purchaseDate, locale)}
                            </span>
                          </span>
                        </button>
                        {!selectMode && (
                          <span
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <SellButton item={toSellItem(lot)} className="w-full" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* EXEMPLARARKET — bottenark med SAMMA form som säljarket (ägarbeslut
          2026-09-07): en remsa med kortets bild högst upp, ett exemplar i taget
          nedanför. Var förut en modal med ett antalsfält ("hur många ska tas
          bort?"), som varken kunde visa vilka exemplar man har eller vad de
          kostat — och som bara kunde ta bort.
          ⛔ INGEN autoFocus — se kommentaren vid köppris-arket nedan. */}
      <BottomSheet
        open={copyLots != null}
        onClose={closeCopySheet}
        title={t("gridCopiesTitle")}
        closeLabel={tc("cancel")}
        // Vägen ut ur markeringsläget utan att scrolla till foten. Samma
        // skrivning som fotknappen — det finns bara ETT sätt att spara.
        headerAction={
          removeMode
            ? {
                label: t("gridCopiesSaveRemove", { count: removeCount }),
                onClick: () => void applyCopyChanges(),
                tone: "danger",
              }
            : undefined
        }
        panelClassName="sm:mx-auto sm:max-w-md"
        footer={
          <BottomSheetCta
            onClick={() => void applyCopyChanges()}
            disabled={deleting || (!copiesChanged && removeCount === 0)}
          >
            {/* ⛔ ALDRIG "Radera" (ägaren 2026-09-07): arket ändrar pris, skick
                och gradering också — knappen får inte lova bara det ena. */}
            {removeCount > 0
              ? t("gridCopiesSaveRemove", { count: removeCount })
              : t("gridCopiesSave")}
          </BottomSheetCta>
        }
      >
        {/* EXEMPLARREMSAN — katalogbilden, ett kort per exemplar. Markerade för
            borttagning tonas ner och får papperskorgen över sig. */}
        {copies.length > 1 && (
          <div className="-mx-[18px] mb-4 overflow-x-auto px-[18px]">
            <div className="flex gap-2">
              {copies.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => pickCopy(i)}
                  onPointerDown={() => startCopyPress(i)}
                  onPointerUp={cancelCopyPress}
                  onPointerLeave={cancelCopyPress}
                  onPointerCancel={cancelCopyPress}
                  onContextMenu={(e) => e.preventDefault()}
                  aria-current={i === copyIndex}
                  aria-label={lotOf(c)?.name ?? t("gridCopyLabel", { n: i + 1 })}
                  className={cn(
                    "relative h-[68px] w-[52px] shrink-0 overflow-hidden rounded-lg border-2 bg-surface-overlay transition-colors",
                    i === copyIndex ? "border-holo-cyan" : "border-transparent opacity-60"
                  )}
                >
                  {/* ⛔ Bilden per EXEMPLAR — markeringen kan spänna över flera
                      olika kort, och då är gruppens första bild fel för resten. */}
                  {lotOf(c)?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lotOf(c)!.imageUrl!}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-faint">
                      <IconPackage size={16} />
                    </span>
                  )}
                  {c.remove && (
                    <span className="absolute inset-0 flex items-center justify-center bg-fall/70 text-surface">
                      <IconTrash size={18} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Kortets identitet — samma rad som säljarket har. */}
        <div className="mb-4 flex items-center gap-3">
          <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-overlay">
            {lotOf(activeCopy)?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lotOf(activeCopy)!.imageUrl!}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-faint">
                <IconPackage size={16} />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{lotOf(activeCopy)?.name}</p>
            <p className="truncate text-xs text-ink-muted">
              {lotOf(activeCopy)?.setName ??
                t("gridCopyOf", { n: copyIndex + 1, total: copies.length })}
            </p>
          </div>
          {copies.length > 1 && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-faint">
              {copyIndex + 1}/{copies.length}
            </span>
          )}
        </div>

        <p className="mb-4 text-xs text-ink-muted">
          {removeMode ? t("gridCopiesHintRemove") : t("gridCopiesHint")}
        </p>

        {activeCopy && (
          <div className={cn("space-y-5", activeCopy.remove && "opacity-50")}>
            <div>
              <SectionLabel>{t("gridSectionPrice")}</SectionLabel>
              <Input
                inputMode="decimal"
                enterKeyHint="done"
                aria-label={t("purchasePrice")}
                placeholder={t("purchasePricePlaceholder")}
                value={activeCopy.price}
                disabled={activeCopy.remove}
                onChange={(e) => patchCopy({ price: e.target.value })}
                className="h-11 bg-surface"
              />
            </div>

            <div>
              <SectionLabel>{t("gridSectionCondition")}</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {COLLECTION_CONDITIONS.map((value) => (
                  <Chip
                    key={value}
                    active={activeCopy.condition === value}
                    onClick={() => patchCopy({ condition: value })}
                  >
                    {tCond(value)}
                  </Chip>
                ))}
              </div>
            </div>

            {/* GRADERING — Traderas egen vokabulär (attribut 125/126), så att en
                senare annons kan bära värdet rakt av utan översättning.
                ⛔ Ett bolag utan betyg är inte en gradering; båda krävs. */}
            <div>
              <SectionLabel>{t("gridSectionGrading")}</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={!activeCopy.gradingCompany}
                  onClick={() => patchCopy({ gradingCompany: "", grade: "" })}
                >
                  {t("gridGradingNone")}
                </Chip>
                {GRADING_ISSUERS.map((issuer) => (
                  <Chip
                    key={issuer}
                    active={activeCopy.gradingCompany === issuer}
                    onClick={() => patchCopy({ gradingCompany: issuer })}
                  >
                    {issuer}
                  </Chip>
                ))}
              </div>
              {activeCopy.gradingCompany && (
                <>
                  <p className="mb-2 mt-3 text-xs text-ink-muted">{t("gridGradeLabel")}</p>
                  <div className="flex flex-wrap gap-2">
                    {GRADES.map((g) => (
                      <Chip
                        key={g}
                        active={activeCopy.grade === g}
                        onClick={() => patchCopy({ grade: g })}
                      >
                        {g}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Borttagning per exemplar — en egen, tydligt märkt växel, aldrig gömd
            i sparknappen. */}
        {activeCopy && (
          <div className="mt-5">
            <Button
              variant={activeCopy.remove ? "secondary" : "danger"}
              size="md"
              className="w-full"
              onClick={() => patchCopy({ remove: !activeCopy.remove })}
            >
              {activeCopy.remove ? (
                t("gridCopyRemoveUndo")
              ) : (
                <>
                  <IconTrash size={16} />
                  {t("gridCopyRemove")}
                </>
              )}
            </Button>
            {activeCopy.remove && (
              <p className="mt-2 text-center text-xs text-fall">{t("gridCopyRemoved")}</p>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Köppris — BOTTENARK, inte modal (ägarbeslut 2026-09-07: samma glid-upp som
          resten av appen). ⛔ INGEN autoFocus: tangentbordet öppnas då i samma commit
          som arket monteras, innan Capacitor-lyssnaren i useKeyboardHeight hunnit
          registreras, och knappsatsen lägger sig rakt över fältet — exakt buggen som
          målpris-arket i bevakningarna redan betalat för. */}
      <BottomSheet
        open={priceTarget != null}
        onClose={() => setPriceTarget(null)}
        title={t("gridPurchasePriceTitle")}
        closeLabel={tc("cancel")}
        panelClassName="sm:mx-auto sm:max-w-md"
        footer={
          <BottomSheetCta onClick={() => void savePurchasePrice()} disabled={savingPrice}>
            {tc("save")}
          </BottomSheetCta>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePurchasePrice();
          }}
        >
          <p className="mb-3 truncate text-sm font-medium text-ink">{priceTarget?.name}</p>
          <Label htmlFor="purchasePriceKr">{t("purchasePrice")}</Label>
          <Input
            id="purchasePriceKr"
            inputMode="decimal"
            enterKeyHint="done"
            placeholder={t("purchasePricePlaceholder")}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="h-11 bg-surface"
          />
          <p className="mt-2 text-xs text-ink-muted">{t("gridPurchasePriceHint")}</p>
          <FieldError message={priceError} />
        </form>
      </BottomSheet>
    </section>
  );
}
