-- Specialvariant-diskriminator (common vs Poké/Master Ball reverse vs promo).
-- null = bas-common (RapidAPI From); != null = variant (pokemontcg.io-trend).
ALTER TABLE "Product" ADD COLUMN "variantLabel" TEXT;
