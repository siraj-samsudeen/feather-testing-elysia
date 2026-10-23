// Run by tests/no-happy-dom.test.ts in its own process, with happy-dom
// unloadable: logInAs must work for browser- and API-only tests.
import { expect } from "bun:test";
import { test, todos, users } from "../example/fixtures.ts";

test("happy-dom really is unloadable here", async ({}) => {
  await expect(import("feather-testing-core/request")).rejects.toThrow(/happy-dom/);
});

test("logInAs + api without happy-dom", async ({ db, logInAs, api }) => {
  const signedIn = await logInAs(await users.insert(db, { name: "Alice" }));
  expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
  expect((await signedIn.api.api.me.get()).data).toMatchObject({ name: "Alice" });
});

test("logInAs + session without happy-dom", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });
  await logInAs(alice);
  await session.visit("/").assertText("Buy milk");
});

test("the returned request fails only when used, naming happy-dom", async ({ db, logInAs }) => {
  const { request } = await logInAs(await users.insert(db));
  expect(() => request.visit("/")).toThrow(/happy-dom/);
});

test("incidental reads don't create the returned request (creating it would need happy-dom)", async ({ db, logInAs }) => {
  const { request } = await logInAs(await users.insert(db));
  Bun.inspect(request);
  Object.prototype.toString.call(request);
  expect("visit" in request).toBe(true);
  expect((request as unknown as { then?: unknown }).then).toBeUndefined();
});
