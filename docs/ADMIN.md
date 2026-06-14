# Admin-guide

Adminpanelen finns på `/admin` (synlig i sidomenyn för MODERATOR och uppåt).

## Roller
| Roll | Behörighet |
|---|---|
| USER | Standardkonto |
| MODERATOR | Moderering: rapporter, dölja/ta bort inlägg |
| ADMIN | Allt ovan + användare, datakällor, jobb, butiker, statistik |
| SUPERADMIN | Allt ovan + ändra användarroller |

## Sidor
- **/admin** — Översikt: systemstatistik, DB/Redis-status, senaste jobb, datakvalitet (produkter utan erbjudanden, senaste observation)
- **/admin/anvandare** — sök, paginering, rollbyte (endast SUPERADMIN)
- **/admin/kallor** — datakällor: aktivera/inaktivera, **"Kör nu"** startar ett scrapingjobb direkt, lägg till källa (kräver adapter i koden, se SCRAPERS.md)
- **/admin/jobb** — jobbhistorik med status, körtid, loggar och felmeddelanden
- **/admin/rapporter** — communityrapporter: dölj inlägg eller avfärda
- **/admin/butiker** — butiker/retailers: aktivera, affiliate-inställningar

Alla adminmutationer skrivs till `AuditLog`.

## Demo
Logga in som `admin@pokefinds.se / admin1234` och kör mock-källan via /admin/kallor → "Kör nu" för att se prisdrift + restock-alerts i realtid.
