/**
 * GRANSKNINGSSTEGET: filens celler + användarens kolumntolkning → vad varje rad
 * blir i katalogen. SKRIVER INGENTING.
 *
 * ⛔ Klienten skickar CELLERNA, inte färdiga poster. Normaliseringen (skick,
 * tryckning, valuta, datumordning) måste ge samma svar i granskningen som vid
 * skrivningen, och den enda garantin för det är att den körs på ETT ställe.
 *
 * Hela filen skickas i ett anrop (hårt tak 5 000 rader). `startRow` finns kvar
 * för API-klienter som vill förhandsgranska en del och behålla filens radnummer.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { readJsonCapped } from "@/lib/body-limit";
import { buildDraftRows } from "@/lib/import-rows";
import { IMPORT_FIELDS } from "@/lib/import-mapping";
import { findDuplicateImport, resolveImportRows, IMPORT_CHUNK_LIMIT } from "@/services/collection-import";

export const dynamic = "force-dynamic";

/** Hårt body-tak, verkställt INNAN kroppen buffras. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const mappingSchema = z.object(
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.number().int().min(0).max(999).nullable().optional()]))
);

const bodySchema = z.object({
  /** Celler, rad för rad. Rubrikraden är redan bortplockad av klienten. */
  rows: z.array(z.array(z.string().max(2000))).min(1).max(IMPORT_CHUNK_LIMIT),
  mapping: mappingSchema,
  moneyUnit: z.enum(["major", "ore"]).default("major"),
  fileCurrency: z.enum(["SEK", "USD", "EUR", "OTHER"]).default("SEK"),
  source: z.enum(["foilio", "generic"]).default("generic"),
  dateOrder: z.enum(["dmy", "mdy"]).optional(),
  /** Radnummer den första raden i chunken har i filen (1-baserat). */
  startRow: z.number().int().min(1).default(1),
  /** SHA-256 över filen — bara till dubblettvarningen i första chunken. */
  fingerprint: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await readJsonCapped(req, MAX_BODY_BYTES));

    const built = buildDraftRows(
      { headers: [], rows: body.rows, delimiter: "," },
      body.mapping,
      {
        moneyUnit: body.moneyUnit,
        fileCurrency: body.fileCurrency,
        dateOrder: body.dateOrder,
        trustEstimatedValue: body.source === "foilio",
      }
    );
    // Radnumren ska peka in i ANVÄNDARENS fil, inte in i chunken.
    const offset = body.startRow - 1;
    for (const row of built.rows) row.row += offset;

    const resolved = await resolveImportRows(built.rows);
    const draftByRow = new Map(built.rows.map((r) => [r.row, r]));

    const duplicate = body.fingerprint
      ? await findDuplicateImport(user.id, body.fingerprint)
      : null;

    return jsonOk({
      items: resolved.map((r) => {
        const draft = draftByRow.get(r.row);
        return {
          ...r,
          draft: {
            name: draft?.name ?? r.name,
            quantity: draft?.quantity ?? 1,
            condition: draft?.condition ?? null,
            language: draft?.language ?? null,
            purchasePrice: draft?.purchasePrice ?? null,
            purchaseDate: draft?.purchaseDate?.toISOString() ?? null,
            estimatedValue: draft?.estimatedValue ?? null,
            gradingCompany: draft?.gradingCompany ?? null,
            grade: draft?.grade ?? null,
            notes: draft?.notes ?? null,
          },
        };
      }),
      skippedEmpty: built.skippedEmpty,
      droppedForeignPrices: built.droppedForeignPrices,
      ignoredMarketValues: built.ignoredMarketValues,
      dateOrder: built.dateOrder,
      duplicate,
    });
  } catch (e) {
    return apiError(e);
  }
}
