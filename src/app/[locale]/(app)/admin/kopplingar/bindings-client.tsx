"use client";

import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { formatDateTime, formatPrice } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

export interface BindingRow {
  id: string;
  at: string;
  storeName: string;
  url: string;
  /** Butikens titel som matchningen dömde på. */
  storeTitle: string;
  priceOre: number | null;
  stockStatus: string | null;
  /** null = offern är redan borttagen (kopplingen bortkopplad). */
  offerId: string | null;
  product: { title: string; slug: string } | null;
}

export interface PendingRow {
  id: string;
  storeName: string;
  url: string;
  storeTitle: string;
  stockStatus: string;
  product: { title: string; slug: string };
}

export function BindingsClient({
  rows,
  windowDays,
  pending,
}: {
  rows: BindingRow[];
  windowDays: number;
  pending: PendingRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function unbind(row: BindingRow) {
    if (!row.offerId) return;
    if (
      !window.confirm(
        `Koppla bort ${row.storeName} från "${
          row.product?.title ?? "produkten"
        }"?\n\nOffern tas bort och URL:en nekas permanent.`
      )
    )
      return;
    setBusy(row.id);
    try {
      const res = await fetch(`/api/admin/offers/${row.offerId}`, {
        method: "DELETE",
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte koppla bort.");
      toast({
        title: "Bortkopplad",
        description: `${row.storeName} · URL:en är nekad.`,
        variant: "success",
      });
      router.refresh();
    } catch (e) {
      toast({
        title: "Fel",
        description: e instanceof Error ? e.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kopplingar från larm-hits</CardTitle>
          <p className="text-sm text-ink-muted">
            Butiks-URL:er som bands till en produkt direkt när de dök upp
            (släppdagen), senaste {windowDays} dygnen. Fel produkt?{" "}
            <strong>Koppla bort</strong> tar bort offern och nekar URL:en —
            samma sak som Ta bort på produktsidan.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Inga kopplingar ännu"
              description="Hit-vägen har inte bundit någon ny URL de senaste dygnen."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>När</TH>
                  <TH>Butik · titel</TH>
                  <TH>Bunden till</TH>
                  <TH>Pris</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(r.at)}
                    </TD>
                    <TD>
                      <span className="block font-medium">{r.storeName}</span>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-[28rem] truncate text-xs text-ink-muted hover:text-ink"
                        title={r.url}
                      >
                        {r.storeTitle || r.url}
                      </a>
                    </TD>
                    <TD>
                      {r.product ? (
                        <Link
                          href={`/produkter/${r.product.slug}`}
                          className="text-holo-cyan hover:opacity-80"
                        >
                          {r.product.title}
                        </Link>
                      ) : (
                        <Badge variant="default">Bortkopplad</Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">
                      {r.priceOre != null ? formatPrice(r.priceOre) : "–"}
                      {r.stockStatus && (
                        <span className="ml-1 text-xs text-ink-faint">
                          {r.stockStatus}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {r.offerId && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === r.id}
                          onClick={() => unbind(r)}
                        >
                          Koppla bort
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Väntande länkar</CardTitle>
          <p className="text-sm text-ink-muted">
            URL:er som redan är kopplade till en produkt men ännu inte gett ett
            pris (t.ex. förkopplade inför ett släpp, sidan 404:ar tills butiken
            publicerar). Syns inte på produktsidan förrän butiken går live — då
            blir första lagerflippen ett larm direkt.
          </p>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-faint">Inga väntande länkar.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Butik · titel</TH>
                  <TH>Kopplad till</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {pending.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="block font-medium">{r.storeName}</span>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-[28rem] truncate text-xs text-ink-muted hover:text-ink"
                        title={r.url}
                      >
                        {r.storeTitle || r.url}
                      </a>
                    </TD>
                    <TD>
                      <Link
                        href={`/produkter/${r.product.slug}`}
                        className="text-holo-cyan hover:opacity-80"
                      >
                        {r.product.title}
                      </Link>
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          r.stockStatus === "IN_STOCK" ? "success" : "default"
                        }
                      >
                        {r.stockStatus === "UNKNOWN" ? "Väntar" : r.stockStatus}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
