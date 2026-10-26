-- Cardmarkets sjunde skick (ägarbeslut 2026-10-26): Light Played mellan Good och Played.
ALTER TYPE "CardCondition" ADD VALUE IF NOT EXISTS 'LIGHT_PLAYED' AFTER 'GOOD';
