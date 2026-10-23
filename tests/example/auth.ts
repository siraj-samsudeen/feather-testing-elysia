// Hand-rolled cookie sessions on Drizzle tables: an opaque random token in a
// `sessions` row, sent back as the `sid` cookie. The login route and the
// tests' mintSession both call startSession, so tests sign in the way the
// app does, minus the password form.
import { and, eq, gt } from "drizzle-orm";
import type { FeatherDrizzleDb } from "feather-testing-postgres/drizzle";
import * as schema from "./schema.ts";

export type AppDb = FeatherDrizzleDb<typeof schema>;

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export async function startSession(db: AppDb, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export async function userForToken(db: AppDb, token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, token), gt(schema.sessions.expiresAt, new Date())));
  return row ?? null;
}
