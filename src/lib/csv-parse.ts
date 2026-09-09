/**
 * CSV-PARSER FÖR SAMLINGSIMPORT (ren — ingen DOM, ingen Prisma, ingen fetch).
 *
 * Vi skriver den själva i stället för att dra in ett bibliotek: hela kontraktet
 * är RFC 4180 plus tre saker som ett generiskt bibliotek ändå inte gissar rätt.
 *
 * ⛔ AVGRÄNSAREN MÅSTE SNIFFAS, INTE ANTAS. Svenska Excel sparar "CSV" med
 * SEMIKOLON, eftersom kommatecknet är decimaltecken i sv-SE. Den som exporterar
 * sin samling ur Excel/Numbers/Sheets får alltså en fil vår parser läser som EN
 * enda kolumn om vi hårdkodar ",". Det är hälften av löftet "importera från
 * vilket verktyg som helst".
 *
 * ⛔ BOM:EN MÅSTE BORT FÖRE RUBRIKEN. Excel skriver UTF-8 med BOM; utan
 * strykningen heter första kolumnen "﻿Quantity" och matchar ingen alias-
 * tabell — felet ser ut som "vi känner inte igen filen", inte som ett teckenfel.
 *
 * ⛔ RADSLUT ÄR CRLF, LF *ELLER* CR. Gamla Mac-exporter (och några webbappar)
 * skickar bara CR. En parser som bara delar på "\n" ger då EN rad med hela filen.
 *
 * Citattecken följer RFC 4180: ett fält som börjar med `"` läses till nästa
 * ensamma `"`, och `""` inuti är ett bokstavligt citattecken. Avgränsare och
 * radbrytningar inuti citat är data, inte struktur.
 */

/** Avgränsare vi provar, i den ordning en oavgjord sniffning ska falla. */
const CANDIDATES = [",", ";", "\t", "|"] as const;

export interface ParsedCsv {
  /** Rubrikraden, trimmad. Tom sträng för en namnlös kolumn (de förekommer). */
  headers: string[];
  /** Datarader. Kortare rader fylls INTE ut här — se `rowValue`. */
  rows: string[][];
  delimiter: string;
}

/** Tar bort UTF-8-BOM och normaliserar radslut till "\n". */
function cleanText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * Räknar förekomster av `delimiter` UTANFÖR citat på de första raderna.
 *
 * Utanför citat är hela poängen: "Pikachu, Charizard & co" innehåller ett komma
 * som inte är en kolumngräns, och en butiks-/appexport har gott om dem i
 * produktnamn.
 */
function countOutsideQuotes(text: string, delimiter: string, maxLines: number): number {
  let count = 0;
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n") {
      lines++;
      if (lines >= maxLines) break;
      continue;
    }
    if (ch === delimiter) count++;
  }
  return count;
}

/**
 * Gissar avgränsaren. Den kandidat som förekommer flest gånger utanför citat
 * över de första raderna vinner; ingen förekomst alls ⇒ "," (en enkolumnsfil är
 * giltig och ska inte kasta).
 */
export function sniffDelimiter(text: string): string {
  const clean = cleanText(text);
  let best = ",";
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    const count = countOutsideQuotes(clean, candidate, 5);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parsar en CSV-sträng till rubriker + rader.
 *
 * Helt tomma rader hoppas över (exporter avslutar ofta med radbrytning, och en
 * tom rad mitt i filen är alltid separation, aldrig ett objekt utan namn).
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const clean = cleanText(text);
  const delim = delimiter ?? sniffDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Har fältet börjat med ett citattecken? Ett `"` mitt i ett oskyddat fält
  // (tum-tecken, 4" binder) är då data och inte en citatstart.
  let quotedField = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(quotedField ? field : field.trim());
    field = "";
    quotedField = false;
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      quotedField = true;
      fieldStarted = true;
      continue;
    }
    if (ch === delim) {
      endField();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    if (ch !== " " || fieldStarted) fieldStarted = true;
    field += ch;
  }
  // Sista raden saknar radbrytning i de flesta exporter.
  if (field !== "" || row.length > 0) endRow();

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter: delim };
}

/**
 * Läser en kolumn ur en rad. Rader kortare än rubriken är vanliga (efterföljande
 * tomma fält utelämnas av flera exportörer) och ska ge "", aldrig undefined.
 */
export function rowValue(row: string[], index: number | null | undefined): string {
  if (index == null || index < 0) return "";
  return (row[index] ?? "").trim();
}
