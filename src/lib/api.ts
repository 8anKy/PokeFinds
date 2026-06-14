/** Gemensam felhantering för API-routes. */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AuthError } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export function apiError(error: unknown): NextResponse {
  if (error instanceof AuthError || error instanceof ServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Posten finns redan." }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Posten hittades inte." }, { status: 404 });
    }
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Ogiltig indata.", details: error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  console.error("API-fel:", error);
  return NextResponse.json({ error: "Något gick fel. Försök igen." }, { status: 500 });
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as Record<string, unknown> | unknown[], init);
}
