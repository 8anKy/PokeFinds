/**
 * Versionen av forumreglerna (texten i `Forum.rules1`–`rules5`). Höj talet när
 * reglerna ändras i sak — då frågar dialogen ALLA igen, eftersom
 * `User.forumRulesVersion` < CURRENT räknas som "inte godkänt".
 * En ren omformulering utan ny innebörd ska INTE höja versionen.
 * Klient-säker (ingen Prisma): läses av både dialogen och servern.
 */
export const FORUM_RULES_VERSION = 1;
