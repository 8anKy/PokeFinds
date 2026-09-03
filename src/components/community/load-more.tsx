"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("Forum");
  if (!hasMore) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="secondary" onClick={onClick} loading={loading}>
        {t("loadMore")}
      </Button>
    </div>
  );
}
