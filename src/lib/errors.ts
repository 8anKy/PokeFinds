/** Fel som kastas från services med HTTP-status och svenskt meddelande. */
export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
