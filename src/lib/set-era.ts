/**
 * Vilken ERA ett set hör till — rubrikerna på /sets (ägarbeslut 2026-10-16).
 *
 * ENGELSKA: `CardSet.series` när den ÄR en era (pokemontcg.io sätter den). Set med en
 * "serie" som inte är en era ("Other", "POP", "NP", "McDonald's Collection") placeras
 * efter släppdatum, så McDonald's 2021 hamnar under Sword & Shield och POP 5 under EX.
 * JAPANSKA: `series` är opålitlig (144 set stod som "Other" 2026-10-16) ⇒ släppdatumet
 * avgör, setkoden när datum saknas.
 *
 * ⛔ Ren modul. Datumgränserna är respektive regions FÖRSTA set i eran.
 */

export const ERA_ORDER = [
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Black & White",
  "HeartGold & SoulSilver",
  "Platinum",
  "Diamond & Pearl",
  "EX",
  "e-Card",
  "Neo",
  "Gym",
  "Base",
] as const;
export type Era = (typeof ERA_ORDER)[number] | "Other";

const EN_SERIES: Record<string, Era> = {
  "Mega Evolution": "Mega Evolution",
  "Scarlet & Violet": "Scarlet & Violet",
  "Sword & Shield": "Sword & Shield",
  "Sun & Moon": "Sun & Moon",
  XY: "XY",
  "Black & White": "Black & White",
  "HeartGold & SoulSilver": "HeartGold & SoulSilver",
  Platinum: "Platinum",
  "Diamond & Pearl": "Diamond & Pearl",
  EX: "EX",
  "E-Card": "e-Card",
  Neo: "Neo",
  Gym: "Gym",
  Base: "Base",
};

// [första datum, era] — nyast först.
const EN_FROM: [string, Era][] = [
  ["2025-09-01", "Mega Evolution"],
  ["2023-03-01", "Scarlet & Violet"],
  ["2019-11-15", "Sword & Shield"],
  ["2017-02-01", "Sun & Moon"],
  ["2013-10-01", "XY"],
  ["2011-03-01", "Black & White"],
  ["2010-02-01", "HeartGold & SoulSilver"],
  ["2009-02-01", "Platinum"],
  ["2007-03-01", "Diamond & Pearl"],
  ["2003-06-01", "EX"],
  ["2002-09-01", "e-Card"],
  ["2000-12-01", "Neo"],
  ["2000-08-01", "Gym"],
  ["1990-01-01", "Base"],
];

const JP_FROM: [string, Era][] = [
  ["2025-08-01", "Mega Evolution"],
  ["2023-01-15", "Scarlet & Violet"],
  ["2019-12-01", "Sword & Shield"],
  ["2016-12-01", "Sun & Moon"],
  ["2013-11-01", "XY"],
  ["2010-12-01", "Black & White"],
  ["2009-09-01", "HeartGold & SoulSilver"],
  ["2008-09-01", "Platinum"],
  ["2006-09-01", "Diamond & Pearl"],
  ["2002-12-01", "EX"],
  ["2001-07-01", "e-Card"],
  ["1999-12-01", "Neo"],
  ["1998-06-01", "Gym"],
  ["1990-01-01", "Base"],
];

const JP_CODE: [RegExp, Era][] = [
  [/^(M\d|MP|MC|MA|MB|ME|MF|MMBS)/i, "Mega Evolution"],
  [/^SV/i, "Scarlet & Violet"],
  [/^SM/i, "Sun & Moon"],
  [/^(S\d|SA\d|SC|SD|SE|SF|SG|SH|SI|SJ|SK|SL|SN|SO|SP\d|S-P|SGL|SPD|SPZ)/i, "Sword & Shield"],
  [/^(XY|X30|Y30|HXY|CP\d|SNP)/i, "XY"],
  [/^(BW|BK|BTV|BGS|PPD|PBG|KLD|GBR|SZD|MG|K\+K|EBB|DS|SHC|WAK)/i, "Black & White"],
  [/^(L\d|LL|L-P|HS)/i, "HeartGold & SoulSilver"],
  [/^(PT|DPT)/i, "Platinum"],
  [/^DP/i, "Diamond & Pearl"],
  [/^(ADV|PCG|HRT)/i, "EX"],
];

function byDate(table: [string, Era][], date: Date | string | null): Era | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  for (const [from, era] of table) if (t >= Date.parse(from)) return era;
  return null;
}

export function setEra(s: { name: string; language: string; series: string | null; releaseDate: Date | string | null }): Era {
  if (s.language === "JP") {
    const d = byDate(JP_FROM, s.releaseDate);
    if (d) return d;
    const code = s.name.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
    if (code) for (const [re, era] of JP_CODE) if (re.test(code)) return era;
    return "Other";
  }
  const direct = s.series ? EN_SERIES[s.series] : undefined;
  return direct ?? byDate(EN_FROM, s.releaseDate) ?? "Other";
}

/** Sorteringsnyckel: nyaste eran först, "Other" sist. */
export function eraRank(era: Era): number {
  const i = (ERA_ORDER as readonly string[]).indexOf(era);
  return i === -1 ? ERA_ORDER.length : i;
}
