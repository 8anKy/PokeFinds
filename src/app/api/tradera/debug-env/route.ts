import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ponytail: TEMPORÄR felsökning av TRADERA_APP_ID-citattecken-mysteriet — ingen
// hemlig data (bara längd + första/sista tecken), men admin-gated ändå.
// Ta bort filen när löst.
function shape(v: string | undefined) {
  if (v === undefined) return { present: false };
  return {
    present: true,
    length: v.length,
    firstChar: v[0],
    lastChar: v[v.length - 1],
  };
}

export async function GET() {
  try {
    await requireRole("ADMIN");
    return jsonOk({
      TRADERA_APP_ID: shape(process.env.TRADERA_APP_ID),
      TRADERA_PUBLIC_KEY: shape(process.env.TRADERA_PUBLIC_KEY),
    });
  } catch (e) {
    return apiError(e);
  }
}
