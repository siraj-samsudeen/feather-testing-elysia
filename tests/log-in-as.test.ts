// logInAs(user): mint a session with the consumer's mintSession, sign in the
// test's own session / request / api, and return signed-in clients.
import { expect } from "bun:test";
import { featherTest } from "../src/index.ts";
import { createApp } from "./example/app.ts";
import * as schema from "./example/schema.ts";
import { test, todos, users } from "./example/fixtures.ts";

test("logInAs signs in the test's request session", async ({ db, logInAs, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });
  await logInAs(alice);
  await request.visit("/").assertText("Alice's todos").assertHas("li", { text: "Buy milk" });
});

test("logInAs signs in the test's api client", async ({ db, logInAs, api }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await logInAs(alice);
  const { data } = await api.api.me.get();
  expect(data).toMatchObject({ name: "Alice" });
});

test("logInAs returns the cookies and signed-in clients of their own", async ({ db, logInAs, app }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const bob = await users.insert(db, { name: "Bob" });
  await todos.insert(db, { userId: alice.id, title: "Alice's errand" });
  await todos.insert(db, { userId: bob.id, title: "Bob's errand" });
  const asAlice = await logInAs(alice);
  const asBob = await logInAs(bob);
  expect(asAlice.cookies).toEqual([expect.objectContaining({ name: "sid", httpOnly: true })]);
  await asAlice.request.visit("/").assertText("Alice's errand").refuteText("Bob's errand");
  await asBob.request.visit("/").assertText("Bob's errand").refuteText("Alice's errand");
  expect((await asBob.api.api.me.get()).data).toMatchObject({ name: "Bob" });
  expect(app.server).toBeNull(); // all in-process
});

test("the latest logInAs wins for the test's own clients", async ({ db, logInAs, api }) => {
  await logInAs(await users.insert(db, { name: "Alice" }));
  await logInAs(await users.insert(db, { name: "Bob" }));
  expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
});

test("logInAs after the browser session's first step adds the cookie to its context", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await session.visit("/").assertPath("/login");
  await logInAs(alice);
  await session.visit("/").assertText("Alice's todos");
});

test("logInAs after the request session's first step signs it in from its next step", async ({ db, logInAs, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const bob = await users.insert(db, { name: "Bob" });
  await request.visit("/").assertPath("/login");
  await logInAs(alice);
  await request.visit("/").assertText("Alice's todos");
  await logInAs(bob);
  await request.visit("/").assertText("Bob's todos");
});

let seen: { db: unknown; user: unknown; app: unknown } | undefined;
test.with({
  mintSession: (args: { db: unknown; user: unknown; app: unknown }) => {
    seen = args;
    return [{ name: "a", value: "1" }, { name: "b", value: "2" }];
  },
})("mintSession is overridable per test and may return several cookies", async ({ db, logInAs, app }) => {
  const alice = await users.insert(db);
  const { cookies } = await logInAs(alice);
  expect(cookies.map((c) => c.name)).toEqual(["a", "b"]);
  expect(seen).toEqual({ db, user: alice, app });
});

const noMint = featherTest({ createApp, db: { migrations: "./tests/example/drizzle", schema } });
noMint("logInAs without mintSession explains what to configure", async ({ db, logInAs }) => {
  const alice = await users.insert(db);
  await expect(logInAs(alice as never)).rejects.toThrow(/mintSession/);
});

test("switching user between queuing and running the browser's first step runs as the new user", async ({ db, logInAs, session }) => {
  await logInAs(await users.insert(db, { name: "Alice" }));
  const chain = session.visit("/"); // queued as Alice, not run yet
  await logInAs(await users.insert(db, { name: "Bob" }));
  await chain.assertText("Bob's todos").refuteText("Alice's todos");
});
