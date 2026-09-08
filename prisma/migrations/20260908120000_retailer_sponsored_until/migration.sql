-- Sponsrad placering per butik. En DATUMGRÄNS, inte en bock: en avtalsperiod som
-- passerat släcks av klockan, inte av att någon kommer ihåg att bocka ur.
-- Påverkar aldrig den ordinarie rangordningen (villkor §8 + /om) — butiken visas i
-- ett eget, märkt ark ovanför butikslistan och ligger kvar på sin naturliga plats i den.
ALTER TABLE "Retailer" ADD COLUMN "sponsoredUntil" TIMESTAMP(3);
