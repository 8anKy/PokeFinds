import type { NextRequest } from "next/server";
import { z } from "zod";
import { ListingKind, ListingStatus } from "@prisma/client";
import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { imageUrl, isForumImageKey, MAX_IMAGES_PER_POST } from "@/lib/object-storage";
import { LISTING_CONDITIONS, validateListing } from "@/lib/listing-rules";
import { postMarketThreadToDiscord } from "@/lib/discord-market";
import { createPost, getFeed } from "@/services/community";
import { getGroupBySlug } from "@/services/community-groups";
import { revalidateForum } from "../_shared/revalidate";

export const dynamic = "force-dynamic";

const feedSchema = z.object({
  group: z.string().trim().min(1).max(64).optional(),
  /** Författar-id (profilens Inlägg-flik). Trådar är publika, så ingen auth-koppling. */
  author: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  kind: z.nativeEnum(ListingKind).optional(),
  status: z.union([z.nativeEnum(ListingStatus), z.literal("all")]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const createSchema = z.object({
  groupSlug: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3, "Titeln är för kort.").max(120, "Titeln är för lång."),
  content: z.string().trim().min(1, "Skriv något i tråden.").max(10000),
  imageKeys: z
    .array(z.string().refine(isForumImageKey, "Ogiltig bildnyckel."))
    .max(MAX_IMAGES_PER_POST)
    .default([]),
  listingKind: z.nativeEnum(ListingKind).optional(),
  /** Kronor från formuläret — konverteras till öre här, aldrig i klienten. */
  priceKr: z.number().nonnegative().max(1_000_000).optional(),
  condition: z.enum(LISTING_CONDITIONS).optional(),
  productId: optionalText(64),
  /** Produktväljaren söker via /api/search/suggest, som bara ger slug. */
  productSlug: optionalText(200),
  traderaUrl: optionalText(500),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    await assertCommunityV2(session?.user?.role ?? null);
    const params = feedSchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const feed = await getFeed({
      groupSlug: params.group,
      authorId: params.author,
      kind: params.kind,
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
    });
    return jsonOk(feed);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);

    const { ok } = await rateLimit(`community-post:${user.id}`, 5, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har skapat för många trådar på kort tid. Försök igen om en stund."
      );
    }

    const input = createSchema.parse(await req.json());

    const group = await getGroupBySlug(input.groupSlug);
    if (!group) throw new ServiceError(404, "Gruppen hittades inte.");

    // Bildnycklar får bara peka på användarens EGET prefix — annars kan man
    // "låna" någon annans uppladdning genom att gissa nyckeln.
    const ownPrefix = `forum/${user.id.replace(/[^A-Za-z0-9_-]/g, "")}/`;
    if (input.imageKeys.some((k) => !k.startsWith(ownPrefix))) {
      throw new ServiceError(400, "Ogiltig bildnyckel.");
    }

    const priceOre = input.priceKr != null ? Math.round(input.priceKr * 100) : null;

    let productId: string | null = input.productId ?? null;
    if (!productId && input.productSlug) {
      const product = await prisma.product.findUnique({
        where: { slug: input.productSlug },
        select: { id: true },
      });
      if (!product) throw new ServiceError(404, "Produkten hittades inte.");
      productId = product.id;
    } else if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new ServiceError(404, "Produkten hittades inte.");
    }

    const verdict = validateListing({
      isMarketplace: group.isMarketplace,
      listingKind: input.listingKind ?? null,
      priceOre,
      condition: input.condition ?? null,
      productId,
      traderaUrl: input.traderaUrl ?? null,
    });
    if (!verdict.ok) throw new ServiceError(400, verdict.message);

    const post = await createPost(user.id, {
      groupId: group.id,
      title: input.title,
      content: input.content,
      images: input.imageKeys.map((key) => ({ key })),
      listingKind: input.listingKind ?? null,
      priceOre: group.isMarketplace ? priceOre : null,
      condition: group.isMarketplace ? (input.condition ?? null) : null,
      productId: group.isMarketplace ? productId : null,
      traderaUrl: group.isMarketplace ? (input.traderaUrl ?? null) : null,
    });

    revalidateForum({ group: true });

    if (group.isMarketplace) {
      // Fire-and-forget: tråden är sparad, Discord får inte fördröja svaret.
      const firstKey = post.images[0]?.key;
      void (firstKey ? imageUrl(firstKey) : Promise.resolve(null))
        .catch(() => null)
        .then((thumb) =>
          postMarketThreadToDiscord({
            id: post.id,
            title: post.title,
            content: post.content,
            listingKind: post.listingKind,
            priceOre: post.priceOre,
            condition: post.condition,
            authorName: post.user.name,
            imageUrl: thumb,
          })
        );
    }

    return jsonOk({ id: post.id, groupSlug: group.slug }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
