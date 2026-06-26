# API-referens

Alla endpoints ligger under `/api`. Autentisering via NextAuth-session (cookie). Fel returneras som `{ "error": "meddelande" }`.

## Auth
| Metod | Path | Auth | Beskrivning |
|---|---|---|---|
| POST | /api/auth/register | – | `{name, email, password}` — skapar konto, skickar verifierings-mail |
| POST | /api/auth/verify | – | `{token}` — verifierar e-post |
| POST | /api/auth/forgot | – | `{email}` — skickar återställningslänk |
| POST | /api/auth/reset | – | `{token, password}` — sätter nytt lösenord |
| GET/POST | /api/auth/[...nextauth] | – | NextAuth (inloggning/session) |

## Användare
| GET | /api/users/me | ✅ | Egen profil |
| PATCH | /api/users/me | ✅ | Uppdatera namn, bio, notisinställningar, preferenser |
| DELETE | /api/users/me | ✅ | GDPR: radera konto + all data |
| GET | /api/users/me/export | ✅ | GDPR: exportera all data som JSON |
| POST | /api/users/me/onboarding | ✅ | Spara onboarding-val |

## Produkter & kort
| GET | /api/products | – | Sök/filter: `q, kategori, set, minPris, maxPris, lager, sprak, sortera, sida` |
| GET | /api/products/[slug] | – | Produktdetalj (ökar viewCount) |
| GET | /api/products/[slug]/prices?days=30 | – | Prishistorik |
| GET | /api/products/[slug]/offers | – | Erbjudanden per butik |
| POST | /api/products/[slug]/click | – | Klickspårning, returnerar butiks-URL (med affiliateparametrar om aktiverat) |
| GET | /api/sets, /api/sets/[id] | – | Sets |
| GET | /api/cards?query= | – | Kortsökning |

## Bevakningar & alerts
| GET/POST | /api/watchlist | ✅ | Lista/skapa bevakning `{productId, targetPrice?, restockAlert?, priceAlert?}` |
| PATCH/DELETE | /api/watchlist/[id] | ✅ | Uppdatera/ta bort |
| GET | /api/alerts | ✅ | Alert-historik |
| POST | /api/alerts/[id]/read | ✅ | Markera läst |

## Samling
| GET/POST | /api/collection | ✅ | Lista/lägg till objekt |
| PATCH/DELETE | /api/collection/[id] | ✅ | Uppdatera/ta bort |
| GET | /api/collection/value | ✅ | Totalvärde, vinst/förlust, utveckling |
| GET | /api/collection/export | ✅ | CSV-export |
| POST | /api/collection/import | ✅ | CSV-import (JSON-rader) |

## Skanning
| POST | /api/scanner/upload | ✅ | `{image: dataURL}` (max 4 MB) → kandidater |
| GET | /api/scanner/jobs | ✅ | Senaste skanningar |
| POST | /api/scanner/confirm | ✅ | `{jobId, cardId, ...}` → lägg till i samling |

## Community
| GET/POST | /api/community/posts | GET – / POST ✅ | Flöde (`kategori`, `sida`) / nytt inlägg (rate limit 5/10 min) |
| GET/DELETE | /api/community/posts/[id] | – / ägare+moderator | Inlägg |
| GET/POST | /api/community/posts/[id]/comments | – / ✅ | Kommentarer |
| POST | /api/community/posts/[id]/like | ✅ | Toggle gilla |
| POST | /api/community/posts/[id]/save | ✅ | Toggle spara |
| POST | /api/community/posts/[id]/report | ✅ | Rapportera `{reason}` |

## Marknad
| GET | /api/market/trending · /drops · /most-watched · /restocks · /stats | – | Marknadsdata |

## Admin (kräver roll)
| GET | /api/admin/stats | ADMIN | Systemstatistik |
| GET / PATCH | /api/admin/users, /api/admin/users/[id] | ADMIN (rollbyte: SUPERADMIN) | Användarhantering |
| GET/POST / PATCH | /api/admin/sources, /[id] | ADMIN | Datakällor |
| GET | /api/admin/scrape-jobs | ADMIN | Jobbhistorik |
| POST | /api/admin/scrape-jobs/run | ADMIN | `{sourceId}` — kör scrapingjobb nu |
| GET / PATCH | /api/admin/reports, /[id] | MODERATOR | Moderering |
| GET/POST / PATCH | /api/admin/retailers, /[id] | ADMIN | Butiker |

## Cron
| POST | /api/cron/scrape | header `x-cron-secret` = `CRON_SECRET` | Kör alla aktiva källor |
