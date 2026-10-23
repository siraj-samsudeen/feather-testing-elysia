// The db fixture: a Drizzle handle on the test's own transaction, injected
// into the app, rolled back after the test. Engine from FEATHER_DB.
import { expect } from "bun:test";
import { featherTest } from "../src/index.ts";
import { createApp } from "./example/app.ts";
import { startSession, type AppDb } from "./example/auth.ts";
import * as schema from "./example/schema.ts";

const test = featherTest({
  createApp,
  db: { migrations: "./tests/example/drizzle", schema },
});

const insertAda = (db: AppDb) =>
  db.insert(schema.users).values({ email: "ada@example.com", name: "Ada", passwordHash: "x" }).returning();

test("db is a Drizzle handle on a migrated database", async ({ db }) => {
  const [ada] = await insertAda(db);
  expect(ada!.name).toBe("Ada");
  expect(await db.query.users.findMany()).toHaveLength(1);
});

test("each test starts empty: the last one rolled back", async ({ db }) => {
  expect(await db.select().from(schema.users)).toEqual([]);
});

test("the app gets the test's db, so it sees rows the test inserted", async ({ db, handler }) => {
  const [ada] = await insertAda(db);
  const { token } = await startSession(db, ada!.id);
  const response = await handler(new Request("http://localhost/me", { headers: { cookie: `sid=${token}` } }));
  expect(await response.json()).toMatchObject({ name: "Ada" });
});

let seen: unknown;
test.with({
  createApp: (deps) => {
    seen = deps.db;
    return createApp(deps);
  },
})("createApp is called with { db }", async ({ app, db }) => {
  expect(app).toBeDefined();
  expect(seen).toBe(db);
});

test("sql runs raw SQL on the same transaction", async ({ db, sql }) => {
  await insertAda(db);
  const rows = await sql`select count(*)::int as n from users`;
  expect(rows).toEqual([{ n: 1 }]);
});

test("the engine follows FEATHER_DB (pglite by default)", async ({ dbEngine }) => {
  expect(dbEngine.engine).toBe((process.env.FEATHER_DB as "pglite" | "postgres" | undefined) ?? "pglite");
});
