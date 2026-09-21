-- Förseglade produkter i samlingen (ingen kortrad) fick schemats default NEAR_MINT,
-- som är kortvokabulär — nu betyder NEAR_MINT "öppnad" på en sealed-post
-- (lib/collection-labels.ts). Ingen har valt "Near Mint" på en ETB med flit;
-- posterna lades till som förseglade. Idempotent.
UPDATE "CollectionItem"
SET "condition" = 'SEALED'
WHERE "cardId" IS NULL AND "productId" IS NOT NULL AND "condition" = 'NEAR_MINT';
