"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import {
  isTraderaUrl,
  LISTING_CONDITIONS,
  LISTING_KINDS,
  parseKronorToOre,
  type ListingKindValue,
} from "@/lib/listing-rules";
import { LISTING_KIND_KEYS } from "@/lib/community-labels";
import type { GroupSummary } from "@/services/community-groups";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ImagePicker, type PickedImage } from "./image-picker";
import { ProductPicker, type PickedProduct } from "./product-picker";

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const CONTENT_MAX = 10_000;

/**
 * Komponisten för en ny tråd (/forum/ny — inloggning krävs av middleware).
 * Marknadsfälten visas bara när vald grupp är marknadsplatsen; servern gör
 * om samma dom i listing-rules, det här är bara snabb återkoppling.
 */
export function Composer({ initialGroup }: { initialGroup?: string }) {
  const t = useTranslations("Forum");
  const tCond = useTranslations("Condition");
  const router = useRouter();
  const { toast } = useToast();

  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [groupSlug, setGroupSlug] = useState(initialGroup ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [kind, setKind] = useState<ListingKindValue | null>(null);
  const [priceKr, setPriceKr] = useState("");
  const [condition, setCondition] = useState("");
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [traderaUrl, setTraderaUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: GroupSummary[] }>("/api/community/groups")
      .then((d) => {
        if (cancelled) return;
        setGroups(d.items);
        // Förvalt: ?group= om den finns, annars första gruppen.
        setGroupSlug((cur) =>
          cur && d.items.some((g) => g.slug === cur) ? cur : (d.items[0]?.slug ?? "")
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("somethingWrong"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const group = useMemo(
    () => groups?.find((g) => g.slug === groupSlug) ?? null,
    [groups, groupSlug]
  );
  const marketplace = group?.isMarketplace ?? false;
  const uploading = images.some((i) => i.uploading);

  function validate(): string | null {
    if (!groupSlug) return t("composerGroupRequired");
    if (title.trim().length < TITLE_MIN) return t("composerTitleTooShort");
    if (title.trim().length > TITLE_MAX) return t("composerTitleTooLong");
    if (!content.trim()) return t("composerContentRequired");
    if (uploading) return t("composerWaitUploads");
    if (marketplace) {
      if (!kind) return t("composerKindRequired");
      if (kind !== "TRADE" && priceKr.trim()) {
        const ore = parseKronorToOre(priceKr);
        if (ore == null) return t("composerPriceInvalid");
        if (kind === "SELL" && ore <= 0) return t("composerPriceRequired");
      } else if (kind === "SELL") {
        return t("composerPriceRequired");
      }
      if (traderaUrl.trim() && !isTraderaUrl(traderaUrl.trim())) {
        return t("composerTraderaInvalid");
      }
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        groupSlug,
        title: title.trim(),
        content: content.trim(),
        imageKeys: images.map((i) => i.key).filter((k): k is string => !!k),
      };
      if (marketplace && kind) {
        body.listingKind = kind;
        if (kind !== "TRADE" && priceKr.trim()) {
          const ore = parseKronorToOre(priceKr);
          if (ore != null) body.priceKr = ore / 100;
        }
        if (condition) body.condition = condition;
        if (product) body.productSlug = product.slug;
        if (traderaUrl.trim()) body.traderaUrl = traderaUrl.trim();
      }
      const res = await apiFetch<{ id: string }>("/api/community/posts", { method: "POST", body });
      toast({ title: t("composerPublished"), variant: "success" });
      router.push(`/forum/t/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <Label htmlFor="postGroup">{t("composerGroup")}</Label>
        <Select
          id="postGroup"
          value={groupSlug}
          onChange={(e) => {
            setGroupSlug(e.target.value);
            setError(null);
          }}
          disabled={!groups}
        >
          {!groups && <option value="">{t("loading")}</option>}
          {groups?.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.emoji ? `${g.emoji} ` : ""}
              {g.name}
            </option>
          ))}
        </Select>
        {group && <p className="mt-1.5 text-xs text-ink-faint">{group.description}</p>}
      </div>

      <div>
        <Label htmlFor="postTitle">{t("composerTitleLabel")}</Label>
        <Input
          id="postTitle"
          placeholder={t("composerTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          required
        />
      </div>

      <div>
        <Label htmlFor="postContent">{t("composerContent")}</Label>
        <Textarea
          id="postContent"
          placeholder={t("composerContentPlaceholder")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={CONTENT_MAX}
          rows={7}
          required
        />
      </div>

      <ImagePicker value={images} onChange={setImages} disabled={saving} />

      {marketplace && (
        <fieldset className="space-y-4 rounded-xl border border-surface-border p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{t("composerKind")}</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("composerKind")}>
            {LISTING_KINDS.map((k) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(k)}
                  className={cn(
                    "h-10 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
                    active
                      ? "border-holo-cyan/60 bg-holo-cyan/[0.14] text-holo-cyan"
                      : "border-surface-border bg-surface text-ink hover:bg-surface-overlay"
                  )}
                >
                  {t(LISTING_KIND_KEYS[k])}
                </button>
              );
            })}
          </div>

          {kind && kind !== "TRADE" && (
            <div>
              <Label htmlFor="postPrice">
                {kind === "SELL" ? t("composerPrice") : t("composerPriceOptional")}
              </Label>
              <Input
                id="postPrice"
                inputMode="decimal"
                placeholder="0"
                value={priceKr}
                onChange={(e) => setPriceKr(e.target.value)}
                required={kind === "SELL"}
              />
            </div>
          )}

          <div>
            <Label htmlFor="postCondition">{t("composerCondition")}</Label>
            <Select
              id="postCondition"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option value="">{t("composerConditionNone")}</option>
              {LISTING_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {tCond(c)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="postProduct">{t("composerProduct")}</Label>
            <ProductPicker value={product} onChange={setProduct} disabled={saving} />
            <p className="mt-1.5 text-xs text-ink-faint">{t("composerProductHint")}</p>
          </div>

          <div>
            <Label htmlFor="postTradera">{t("composerTradera")}</Label>
            <Input
              id="postTradera"
              type="url"
              inputMode="url"
              placeholder={t("composerTraderaPlaceholder")}
              value={traderaUrl}
              onChange={(e) => setTraderaUrl(e.target.value)}
            />
          </div>
        </fieldset>
      )}

      <FieldError message={error} />

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/forum")}
          disabled={saving}
        >
          {t("cancel")}
        </Button>
        <Button type="submit" loading={saving} disabled={!groups}>
          {t("composerSubmit")}
        </Button>
      </div>
    </form>
  );
}
