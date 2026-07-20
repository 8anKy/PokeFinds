/**
 * POST /api/cron/dispatch?job=<restock-watch|restock-watch-manatorsk>
 *
 * Retry-proxy för restock-pingrarna. cron-job.org POST:ade tidigare DIREKT till
 * GitHubs workflow_dispatch-API — men när GitHub har en transient 5xx-blip (t.ex.
 * "Minor Service Outage") får cron-job.org ett fel och mejlar en misslyckad-körning,
 * trots att nästa 10-min-tick lyckas. Den här routen tar emot pingen i stället och
 * RETRYAR GitHub-dispatchen genom transienta 5xx → cron-job.org ser bara ett fel
 * vid en RIKTIG ihållande outage (alla försök misslyckas), inte vid enstaka blip.
 *
 * Skyddas av samma x-cron-secret som /api/cron/scrape. GITHUB_DISPATCH_TOKEN = en
 * fine-grained PAT med Actions: read+write (samma token cron-job.org redan använde).
 */
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPO = "8anKy/PokeFinds";
// Allowlist: bara restock-pingrarnas workflows får fyras via proxyn.
const ALLOWED: Record<string, string> = {
  "restock-watch": "restock-watch.yml",
  "restock-watch-manatorsk": "restock-watch-manatorsk.yml",
};

const MAX_ATTEMPTS = 4;

async function dispatchWithRetry(
  workflowFile: string,
  token: string
): Promise<{ ok: boolean; status: number; attempts: number }> {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
        signal: AbortSignal.timeout(10000),
      });
      lastStatus = res.status;
      if (res.status === 204) return { ok: true, status: 204, attempts: attempt };
      // 4xx = permanent (auth/felaktig förfrågan) → ingen mening att retrya.
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, attempts: attempt };
      }
      // 5xx = transient (GitHub-outage) → backoff + försök igen.
    } catch {
      lastStatus = 0; // timeout/nätverksfel → retrya
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  return { ok: false, status: lastStatus, attempts: MAX_ATTEMPTS };
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
  }
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
  }
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    console.error("[cron-dispatch] GITHUB_DISPATCH_TOKEN saknas i miljön.");
    return NextResponse.json({ error: "Dispatch-token saknas." }, { status: 503 });
  }

  const job = new URL(req.url).searchParams.get("job") ?? "restock-watch";
  const workflowFile = ALLOWED[job];
  if (!workflowFile) {
    return NextResponse.json({ error: `Okänt jobb: ${job}` }, { status: 400 });
  }

  const result = await dispatchWithRetry(workflowFile, token);
  if (result.ok) {
    return NextResponse.json({ ok: true, job, attempts: result.attempts });
  }
  // Alla försök misslyckades (ihållande GitHub-outage eller auth-fel) → 502 så att
  // cron-job.org larmar BARA vid riktiga fel, inte transienta blip (som retryn slukar).
  console.error(
    `[cron-dispatch] ${job} misslyckades efter ${result.attempts} försök (senaste HTTP ${result.status}).`
  );
  return NextResponse.json({ ok: false, job, lastStatus: result.status }, { status: 502 });
}
