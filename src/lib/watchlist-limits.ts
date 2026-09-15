/**
 * Gratiskontots bevakningstak — en konstant klientkomponenter kan läsa utan att
 * dra in tjänstelagret (services/watchlist.ts importerar Prisma). Tjänsten
 * re-exporterar den så gamla importvägar fungerar. Copyn i båda språkfilerna
 * vaktas mot talet av `tests/unit/watchlist-limit-copy-sync.test.ts`.
 */
export const FREE_PLAN_WATCHLIST_LIMIT = 5;
