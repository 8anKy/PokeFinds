import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { computeCollectionValue, type PortfolioFilter } from "@/services/collection";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { portfolioItemWhere } from "@/lib/portfolio-limit";

export const dynamic = "force-dynamic";

/** `?portfolio=<id>` räknar för EN pärm (värde, graf, vinst, topplista). Utan = hela samlingen. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const portfolioId = new URL(req.url).searchParams.get("portfolio");
    let portfolio: PortfolioFilter;
    if (portfolioId) {
      const row = await prisma.portfolio.findFirst({
        where: { id: portfolioId, userId: user.id },
        select: { id: true, isDefault: true },
      });
      if (!row) throw new ServiceError(404, "Pärmen hittades inte.");
      portfolio = portfolioItemWhere(row);
    }
    const value = await computeCollectionValue(user.id, { portfolio });
    return jsonOk(value);
  } catch (e) {
    return apiError(e);
  }
}
