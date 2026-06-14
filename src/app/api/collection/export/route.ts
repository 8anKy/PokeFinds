import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { exportCollectionCsv } from "@/services/collection";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const csv = await exportCollectionCsv(user.id);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pokefinds-samling.csv"',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
