import { auth, hasRole } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { HIDDEN_FEATURES } from "@/lib/hidden-features";
import { loadGiveawayAdmin } from "@/services/giveaway";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminRequired } from "../admin-required";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("sv-SE");
const PHASE = { upcoming: "Inte startad", open: "Pågår", closed: "Avslutad" } as const;

/**
 * Giveaway: varje anmäld med samma lotter som dragningen räknar, och vännerna de
 * bjudit in. "Räknas" = vännen kom tillbaka en senare dag. Discord = kopplat via
 * Scoutr; att vännen fortfarande är kvar i servern kollar dragningen.
 */
export default async function AdminGiveawayPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const data = await loadGiveawayAdmin();
  const totalTickets = data.rows.reduce((n, r) => n + r.tickets.total, 0);
  const totalInvited = data.rows.reduce((n, r) => n + r.counts.qualifiedInvites, 0);
  const totalInDiscord = data.rows.reduce((n, r) => n + r.counts.invitesInDiscord, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Giveaway</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {PHASE[data.phase]}
          {HIDDEN_FEATURES.giveaway && " · dold för användare"} · räknas från {formatDate(data.countsFrom)} ·
          slutar {formatDateTime(data.closesAt)}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {nf.format(data.rows.length)} anmälda · {nf.format(totalTickets)} lotter ·{" "}
          {nf.format(totalInvited)} inbjudna vänner som räknas · {nf.format(totalInDiscord)} av dem i Discord
        </p>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="Inga anmälda ännu" description="Anmälningarna syns här så fort någon går med." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-10">#</TH>
              <TH>Deltagare</TH>
              <TH className="text-right">Lotter</TH>
              <TH className="text-right">Skannade</TH>
              <TH className="text-right">Vänner</TH>
              <TH className="text-right">Vänner i Discord</TH>
              <TH className="text-right">Gradering</TH>
              <TH>Restock</TH>
              <TH>Facebook</TH>
              <TH>Discord</TH>
            </TR>
          </THead>
          <TBody>
            {data.rows.map((r, i) => (
              <TR key={r.userId}>
                <TD className="align-top text-ink-faint">{i + 1}</TD>
                <TD className="align-top">
                  <p className="font-medium text-ink">{r.name ?? "–"}</p>
                  <p className="text-xs text-ink-muted">{r.email}</p>
                  <p className="text-xs text-ink-faint">anmäld {formatDate(r.joinedAt)}</p>
                  {r.friends.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-holo-cyan">
                        {r.friends.length} {r.friends.length === 1 ? "inbjuden" : "inbjudna"}
                      </summary>
                      <ul className="mt-1 space-y-1 text-xs">
                        {r.friends.map((f) => (
                          <li key={`${f.email}-${f.joinedAt}`} className="text-ink-muted">
                            <span className="text-ink">{f.name ?? f.email}</span>
                            {f.name && <span> · {f.email}</span>} · {formatDate(f.joinedAt)} ·{" "}
                            {f.counts ? (
                              <span className="text-rise">räknas</span>
                            ) : (
                              <span className="text-ink-faint">väntar på återbesök</span>
                            )}
                            {" · "}
                            {f.discordUsername ? (
                              <span className="text-rise">Discord {f.discordUsername}</span>
                            ) : (
                              <span className="text-ink-faint">ingen Discord</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </TD>
                <TD className="text-right align-top font-semibold tabular-nums text-holo-cyan">
                  {nf.format(r.tickets.total)}
                </TD>
                <TD className="text-right align-top tabular-nums">{nf.format(r.counts.scannedCards)}</TD>
                <TD className="text-right align-top tabular-nums">{nf.format(r.counts.qualifiedInvites)}</TD>
                <TD className="text-right align-top tabular-nums">{nf.format(r.counts.invitesInDiscord)}</TD>
                <TD className="text-right align-top tabular-nums">{nf.format(r.counts.gradings)}</TD>
                <TD className="align-top">{r.counts.hasRestockAlert ? "Ja" : "–"}</TD>
                <TD className="align-top">{r.counts.facebookFollowed ? "Ja" : "–"}</TD>
                <TD className="align-top text-ink-muted">{r.discordUsername ?? "–"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <p className="text-xs text-ink-faint">
        Vänner räknas när de skapat konto via länken och kommit tillbaka en senare dag. Discord = kopplat via
        Scoutr; att personen fortfarande är kvar i servern kollar dragningen.
      </p>
    </div>
  );
}
