import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReportStatus } from "@prisma/client";
import { listChatReports } from "@/services/chat";
import { ChatReportsClient, type AdminReportStatus } from "./chat-reports-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chatt-anmälningar · Admin" };

const STATUSES: AdminReportStatus[] = ["OPEN", "REVIEWED", "ACTIONED"];

function parseStatus(value: string | undefined): AdminReportStatus {
  return (STATUSES as string[]).includes(value ?? "") ? (value as AdminReportStatus) : "OPEN";
}

/**
 * Moderatorvyn över anmälda samtal. ⛔ Enda vägen för en moderator in i ett
 * privat samtal: bara ANMÄLDA konversationer listas, och bara de senaste 30
 * meddelandena — villkoren säger det, och sidan får aldrig bli en sökyta.
 * Rollgrinden sitter på admin-layouten (MODERATOR+).
 */
export default async function AdminChatReportsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status: ReportStatus = parseStatus(searchParams.status);
  const [t, reports] = await Promise.all([getTranslations("Chat"), listChatReports(status)]);

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-bold text-ink">{t("adminTitle")}</h2>
      <ChatReportsClient reports={reports} activeStatus={status as AdminReportStatus} />
    </div>
  );
}
