-- SAMLARORDNING för kortnummer.
--
-- `Card.number` är text ("93", "TG28", "143a", "MEP 074", "!"), och en vanlig
-- textsortering ger därför 1, 10, 100, 101, 102, 11 … — inte ordningen korten
-- ligger i pärmen. /produkter sorteras och PAGINERAS i SQL, så ordningen måste
-- finnas i databasen; att sortera i minnet hade bara sorterat den sida vi råkat
-- hämta.
--
-- Kolumnen är GENERATED ALWAYS ... STORED — alltså räknad av Postgres, inte av
-- appen. Det är med flit: en kolumn som importerna måste komma ihåg att fylla i
-- är en vakt som failar öppet (nya kort hade tyst sorterats fel), och vi har just
-- haft två sådana buggar. Prisma skriver aldrig fältet (det skickas aldrig i
-- `data`), så INSERT/UPDATE fortsätter fungera.
--
-- Nyckelns form:  [prefix 4][tal 7][suffix 3]
--   "44"       → "0000000004400 0"  → "00000000044000"
--   "TG28"     → "tg00" + "0000028" + "000"
--   "143a"     → "0000" + "0000143" + "a00"
--   "!"        → "0000" + "9999999" + "000"   (kort utan tal hamnar sist)
--
-- Utfyllnaden är '0', ALDRIG mellanslag: mellanslag är "ignorerbara" i icke-C-
-- collation (en_US.UTF-8), så en nyckel padd med mellanslag kan sortera olika i
-- olika miljöer. Siffror sorterar före bokstäver i både C och en_US, vilket ger
-- huvudnumreringen (tomt prefix) före delserierna (TG/GG/SV) i båda.
ALTER TABLE "Card" ADD COLUMN "numberSortKey" TEXT
GENERATED ALWAYS AS (
  rpad(
    left(lower(regexp_replace(substring("number" from '^[^0-9]*'), '[^A-Za-z]', '', 'g')), 4),
    4, '0'
  )
  || lpad(left(coalesce(substring("number" from '[0-9]+'), '9999999'), 7), 7, '0')
  || rpad(
    left(coalesce(substring(lower("number") from '[0-9]([a-z]+)[^a-z]*$'), ''), 3),
    3, '0'
  )
) STORED;

CREATE INDEX "Card_numberSortKey_idx" ON "Card"("numberSortKey");
