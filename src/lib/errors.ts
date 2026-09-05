/**
 * Fel som kastas från services med HTTP-status och svenskt meddelande.
 * `code` är en maskinläsbar nyckel (t.ex. FORUM_RULES, PROFANITY) som följer med
 * i API-svaret så att klienten kan översätta och reagera utan att tolka texten.
 */
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
