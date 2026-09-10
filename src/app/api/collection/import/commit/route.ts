/**
 * SKRIVSTEGET. Tar de rader användaren GODKÄNT i granskningen — varje rad bär
 * sitt eget `cardId`/`productId` (eller inget alls, för en fritextpost).
 *
 * ⛔ Servern gissar aldrig här. Kom raden in utan kort är den avsedd att vara
 * fritext; ett andra försök att matcha i skrivsteget hade kunnat ge ett ANNAT
 * svar än det användaren såg och godkände.
 *
 * Hela filen skickas i ett anrop och skrivs atomiskt — då blir den EN import
 * som antingen lyckas helt eller inte alls och kan ångras i ett svep.
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { readJsonCapped } from "@/lib/body-limit";
import { collectionImportPublic } from "@/lib/collection-import-gate";
import { commitImport, IMPORT_CHUNK_LIMIT } from "@/services/collection-import";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 6 * 1024 * 1024;

const itemSchema = z.object({
  row: z.number().int().min(0).default(0),
  name: z.string().min(1).max(300),
  cardId: z.string().max(40).nullable().default(null),
  productId: z.string().max(40).nullable().default(null),
  quantity: z.number().int().min(1).max(9999).default(1),
  condition: z
    .enum(["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "PLAYED", "POOR", "SEALED"])
    .nullable()
    .default(null),
  language: z.enum(["SV", "EN", "JP", "DE", "FR", "OTHER"]).nullable().default(null),
  // Öre. ⛔ Aldrig 0 — "0 kr" läses som gratis, `null` som "vi vet inte".
  purchasePrice: z.number().int().positive().max(2_147_483_647).nullable().default(null),
  purchaseDate: z.string().datetime().nullable().default(null),
  estimatedValue: z.number().int().positive().max(2_147_483_647).nullable().default(null),
  gradingCompany: z.string().max(50).nullable().default(null),
  grade: z.string().max(20).nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
});

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  fingerprint: z.string().min(1).max(64),
  source: z.string().max(40).default("generic"),
  items: z.array(itemSchema).min(1).max(IMPORT_CHUNK_LIMIT),
});

export async function POST(req: Request) {
  if (!collectionImportPublic()) return new Response(null, { status: 404 });
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await readJsonCapped(req, MAX_BODY_BYTES));
    const result = await commitImport(user.id, body);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
