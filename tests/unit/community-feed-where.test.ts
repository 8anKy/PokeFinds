/**
 * Flödesfiltret i forumtjänsten: profilens Inlägg-flik frågar per författare och
 * vill se HELA historiken (även sålda/avslutade annonser), medan startflödet
 * bara visar det aktuella.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ hasRole: () => false }));
vi.mock("@/lib/object-storage", () => ({ imageUrls: async () => [] }));

import { buildFeedWhere } from "@/services/community";

describe("buildFeedWhere", () => {
  it("startflödet: bara synliga trådar som är vanliga eller aktiva annonser", () => {
    expect(buildFeedWhere({})).toEqual({
      isHidden: false,
      OR: [{ listingStatus: null }, { listingStatus: "ACTIVE" }],
    });
  });

  it("författare + status=all: personens alla trådar, inget statusfilter", () => {
    expect(buildFeedWhere({ authorId: "u1", status: "all" })).toEqual({
      isHidden: false,
      userId: "u1",
    });
  });

  it("grupp + annonstyp kombineras med författaren", () => {
    expect(
      buildFeedWhere({
        groupSlug: "kop-salj-byt",
        authorId: "u1",
        kind: "SELL",
      })
    ).toMatchObject({
      isHidden: false,
      group: { slug: "kop-salj-byt" },
      userId: "u1",
      listingKind: "SELL",
    });
  });
});
