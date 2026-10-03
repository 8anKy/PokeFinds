CREATE TABLE "CommunityStore" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "address" TEXT NOT NULL,
  "city" TEXT NOT NULL, "identityKey" TEXT NOT NULL, "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityStore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityStore_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "CommunityStore_coords_check" CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL))
);
CREATE UNIQUE INDEX "CommunityStore_identityKey_key" ON "CommunityStore"("identityKey");
CREATE INDEX "CommunityStore_status_city_idx" ON "CommunityStore"("status", "city");
ALTER TABLE "CommunityStore" ADD CONSTRAINT "CommunityStore_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "CommunityStoreFollow" (
  "userId" TEXT NOT NULL, "storeId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityStoreFollow_pkey" PRIMARY KEY ("userId", "storeId")
);
ALTER TABLE "CommunityStoreFollow" ADD CONSTRAINT "CommunityStoreFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityStoreFollow" ADD CONSTRAINT "CommunityStoreFollow_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "CommunityStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "CommunityStoreReport" (
  "postId" TEXT NOT NULL, "storeId" TEXT NOT NULL, "productLabel" TEXT NOT NULL,
  "productSlug" TEXT, "observation" TEXT NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL,
  "nearbyAtSubmit" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CommunityStoreReport_pkey" PRIMARY KEY ("postId"),
  CONSTRAINT "CommunityStoreReport_observation_check" CHECK ("observation" IN ('SEEN', 'SOLD_OUT', 'NOT_CARRIED'))
);
CREATE INDEX "CommunityStoreReport_storeId_observedAt_idx" ON "CommunityStoreReport"("storeId", "observedAt");
CREATE INDEX "CommunityStoreReport_observedAt_idx" ON "CommunityStoreReport"("observedAt");
ALTER TABLE "CommunityStoreReport" ADD CONSTRAINT "CommunityStoreReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityStoreReport" ADD CONSTRAINT "CommunityStoreReport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "CommunityStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
