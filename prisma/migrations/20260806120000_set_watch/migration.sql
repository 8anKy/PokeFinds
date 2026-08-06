-- SetWatch — "bevaka hela setet": restock-larm på alla sealed-produkter i ett set,
-- inklusive SKU:er som auto-importen skapar senare. Stående regel, ingen expansion
-- till WatchlistItem-rader (se kommentaren i schema.prisma).
CREATE TABLE "SetWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetWatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SetWatch_userId_setId_key" ON "SetWatch"("userId", "setId");
CREATE INDEX "SetWatch_userId_idx" ON "SetWatch"("userId");
-- Larmvägen frågar "vilka bevakar DETTA set?" vid varje lagerövergång.
CREATE INDEX "SetWatch_setId_idx" ON "SetWatch"("setId");

ALTER TABLE "SetWatch" ADD CONSTRAINT "SetWatch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetWatch" ADD CONSTRAINT "SetWatch_setId_fkey"
    FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alert.reasonSetName — setnamnet när mottagaren fick larmet via en SET-bevakning
-- och inte via en egen produktbevakning. Ögonblicksbild: skälet skrivs när beslutet
-- fattas, inte härleds vid utskick (bevakningen kan vara borttagen däremellan).
ALTER TABLE "Alert" ADD COLUMN "reasonSetName" TEXT;
