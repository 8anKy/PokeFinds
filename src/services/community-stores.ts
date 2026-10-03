import { prisma } from "@/lib/db";
import { cachedRead } from "@/lib/cache";
import { ServiceError } from "@/lib/errors";
import { COMMUNITY_STORES_TAG, storeIdentity, type storeSuggestionSchema } from "@/lib/community-stores";
import type { z } from "zod";

const STORE_SELECT = { id: true, name: true, address: true, city: true, latitude: true, longitude: true } as const;
export type CommunityStoreDto = { id: string; name: string; address: string; city: string; latitude: number | null; longitude: number | null };

// EN gemensam katalogläsning, filtrera ort/avstånd i klienten. Ingen DB per butik,
// tangenttryck eller kartpanorering. Invalideras när ett förslag faktiskt godkänns.
export const listCommunityStores = cachedRead(async (): Promise<CommunityStoreDto[]> => {
  return prisma.communityStore.findMany({ where: { status: "APPROVED" }, select: STORE_SELECT, orderBy: [{ city: "asc" }, { name: "asc" }], take: 5000 });
}, "community-store-directory-v1", 86400, [COMMUNITY_STORES_TAG]);

export async function suggestCommunityStore(userId: string, input: z.infer<typeof storeSuggestionSchema>) {
  return prisma.communityStore.create({ data: { ...input, identityKey: storeIdentity(input.name, input.address, input.city), createdById: userId }, select: { id: true } });
}
export async function reportableStore(id: string) {
  const store = await prisma.communityStore.findUnique({ where: { id }, select: { ...STORE_SELECT, status: true } });
  if (!store || store.status !== "APPROVED") throw new ServiceError(404, "Butiken hittades inte.");
  return store;
}
