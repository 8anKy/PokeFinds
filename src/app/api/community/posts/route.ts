import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { createPost, getFeed } from "@/services/community";
import { PostCategory } from "@prisma/client";

export const dynamic = "force-dynamic";

const feedSchema = z.object({
  category: z.nativeEnum(PostCategory).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const createSchema = z.object({
  title: z.string().trim().min(3, "Titeln är för kort.").max(200),
  content: z.string().trim().min(1, "Innehåll krävs.").max(10000),
  category: z.nativeEnum(PostCategory),
  imageUrl: z.string().url().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const params = feedSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const feed = await getFeed({ ...params, userId: session?.user?.id });
    return jsonOk(feed);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const { ok } = await rateLimit(`community-post:${user.id}`, 5, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har skapat för många inlägg på kort tid. Försök igen om en stund."
      );
    }

    const input = createSchema.parse(await req.json());
    const post = await createPost(user.id, input);
    return jsonOk(post, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
