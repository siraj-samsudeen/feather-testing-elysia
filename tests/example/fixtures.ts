// The example project's test function: one file, imported by every test.
import { factory, seq } from "feather-testing-postgres/drizzle";
import { featherTest } from "../../src/index.ts";
import { createApp } from "./app.ts";
import { SESSION_COOKIE, startSession, type AppDb } from "./auth.ts";
import * as schema from "./schema.ts";

export const test = featherTest({
  createApp,
  db: { migrations: "./tests/example/drizzle", schema },
  // Sign a user in the way POST /login does, minus the password form.
  mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }) => {
    const { token, expiresAt } = await startSession(db, user.id);
    return { name: SESSION_COOKIE, value: token, httpOnly: true, expires: expiresAt.getTime() / 1000 };
  },
});

export const users = factory(schema.users, {
  email: seq((n) => `user${n}@example.com`),
  name: "Ada",
  passwordHash: "not-a-real-hash",
});

export const todos = factory(schema.todos, { title: "Buy milk" });
