// Run by tests/no-eden.test.ts in its own process, with @elysiajs/eden
// unloadable: everything but api must work, and api must say what's missing.
import { afterAll, expect, test as bunTest } from "bun:test";
import { featherTest } from "../../src/index.ts";
import { createApp } from "../example/app.ts";
import * as schema from "../example/schema.ts";
import { test, todos, users } from "../example/fixtures.ts";

const NEEDS_EDEN = /the api fixture needs @elysiajs\/eden: bun add -d @elysiajs\/eden/;

test("@elysiajs/eden really is unloadable here", async () => {
  await expect(import("@elysiajs/eden")).rejects.toThrow(/@elysiajs\/eden/);
});

test("logInAs with session and request works without eden", async ({ db, logInAs, session, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });
  await logInAs(alice);
  await session.visit("/").assertText("Buy milk");
  await request.visit("/").assertText("Buy milk");
});

test("the api logInAs returns fails only when used, naming the package", async ({ db, logInAs }) => {
  const { api } = await logInAs(await users.insert(db));
  expect(() => api.me.get()).toThrow(NEEDS_EDEN);
});

// The api fixture's setup must fail with the message.
const expectingSetupError = featherTest({
  createApp,
  db: { migrations: "./tests/example/drizzle", schema },
  runner: { test: (name, fn) => bunTest(name, () => expect(fn()).rejects.toThrow(NEEDS_EDEN)), afterAll },
});
expectingSetupError("the api fixture without eden says what to install", async ({ api }) => {
  expect(api).toBeUndefined(); // never reached
});
