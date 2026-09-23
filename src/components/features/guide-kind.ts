import type { Guide } from "@/content/guides";

/** Guidetypens etikett i `Guides`-namnrymden — en tabell, så en ny typ fälls av tsc. */
export const KIND_KEY: Record<Guide["kind"], "kindSet" | "kindGuide" | "kindCalendar"> = {
  set: "kindSet",
  guide: "kindGuide",
  calendar: "kindCalendar",
};
