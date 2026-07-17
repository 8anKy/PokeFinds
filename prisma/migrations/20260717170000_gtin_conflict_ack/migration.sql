-- Admin-kvittering av GRANSKADE streckkods-konflikter i länkfel-vyn.
-- Lagrar de KONFLIKTDRIVANDE koderna (sorterade, komma-separerade) som admin
-- markerat OK. Vyn döljer konflikten så länge nyckeln är oförändrad; dyker en NY
-- avvikande kod upp ändras nyckeln → konflikten syns igen (auto-återuppstånd).
-- Se src/services/gtin-conflicts.ts.
ALTER TABLE "Product" ADD COLUMN "gtinConflictAckKey" TEXT;
