-- Card.structFingerprint — belysningsimmunt strukturavtryck (959 byte int8:
-- 255 DCT-tecken + 704 gradienthistogram). Skärmfoto-fallet: färgavtryckets
-- topp-15 38,5 % → 97,1 % med blandningen. Se src/lib/art-fingerprint.ts.
ALTER TABLE "Card" ADD COLUMN "structFingerprint" BYTEA;
