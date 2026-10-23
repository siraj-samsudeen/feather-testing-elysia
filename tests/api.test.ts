// api: an Eden Treaty client on the test's app, in-process (no port).
import { expect } from "bun:test";
import { featherTest } from "../src/index.ts";
import { createApp } from "./example/app.ts";
import { startSession } from "./example/auth.ts";
import * as schema from "./example/schema.ts";

const test = featherTest({ createApp, db: { migrations: "./tests/example/drizzle", schema } });

test("api calls the app in-process, typed from its routes", async ({ api, app }) => {
  const { data, error, status } = await api.me.get();
  expect(status).toBe(401);
  expect(data).toBeNull();
  expect(error?.value).toEqual({ error: "not signed in" });
  expect(app.server).toBeNull();
});

test("api sees the test's rows", async ({ api, db }) => {
  const [ada] = await db.insert(schema.users).values({ email: "ada@example.com", name: "Ada", passwordHash: "x" }).returning();
  await db.insert(schema.todos).values({ userId: ada!.id, title: "Buy milk" });
  const { token } = await startSession(db, ada!.id);
  const { data } = await api.todos.get({ headers: { cookie: `sid=${token}` } });
  expect(data?.map((todo) => todo.title)).toEqual(["Buy milk"]);
});
