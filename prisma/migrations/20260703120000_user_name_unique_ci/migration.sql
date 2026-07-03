-- Case-insensitive unique display name.
-- ponytail: expression index lower(name) can't be expressed in schema.prisma, so
-- it lives ONLY here. `prisma migrate dev` will try to DROP it (it sees an index
-- the schema doesn't declare) — don't let it. Prod applies via `migrate deploy`.
-- App-level checks in register + users/me PATCH are the primary, user-friendly
-- guard; this index is the race-proof net (P2002 -> 409 via apiError).
CREATE UNIQUE INDEX "User_name_lower_key" ON "User" (lower(name));
