import { z } from "zod";
import { apiError, jsonOk, requestLocale } from "@/lib/api";
import { requireEntitledUser, requireUser } from "@/lib/auth";
import { PORTFOLIO_NAME_MAX } from "@/lib/portfolio-limit";
import { createPortfolio, listPortfolios, portfolioAllowance } from "@/services/portfolios";

export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().min(1).max(PORTFOLIO_NAME_MAX) });

/** Pärmarna + hur många planen tillåter. Läses av /samling, skannern och snabbtillägget. */
export async function GET() {
  try {
    const user = await requireUser();
    const [portfolios, allowance] = await Promise.all([
      listPortfolios(user.id, { locale: requestLocale() }),
      portfolioAllowance(user.id, user.isPro),
    ]);
    return jsonOk({ portfolios, limit: allowance.limit, canCreate: allowance.canCreate });
  } catch (e) {
    return apiError(e);
  }
}

/** Ny pärm. 403 + kod PORTFOLIO_LIMIT när planen är full ⇒ klienten öppnar paywall-arket. */
export async function POST(req: Request) {
  try {
    // Entitlement-grind ⇒ färsk plan ur DB, aldrig token:ens (lib/auth.ts).
    const user = await requireEntitledUser();
    const input = createSchema.parse(await req.json());
    const portfolio = await createPortfolio(user.id, user.isPro, input.name);
    return jsonOk(portfolio, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
