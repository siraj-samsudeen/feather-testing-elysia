// A step still running when logInAs starts can't undo the login: logInAs
// waits for running steps to finish, so the login is the last write.
import { expect } from "bun:test";
import { createApp } from "./example/app.ts";
import { SESSION_COOKIE, startSession } from "./example/auth.ts";
import { test, users } from "./example/fixtures.ts";

const withSlowLogin = test.with({
  // A slow response that sets the session cookie it is given (Alice's).
  createApp: ((deps: Parameters<typeof createApp>[0]) =>
    createApp(deps).get("/slow-set", async ({ query, cookie }) => {
      await Bun.sleep(150);
      cookie[SESSION_COOKIE]!.set({ value: query.token!, path: "/", httpOnly: true });
      return new Response("<p>set</p>", { headers: { "content-type": "text/html" } });
    })) as unknown as typeof createApp,
});

withSlowLogin("an unawaited request step across logInAs: the login wins", async ({ db, logInAs, request, api }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const { token } = await startSession(db, alice.id);
  const running = request.visit(`/slow-set?token=${token}`).run(); // started, not awaited
  await Bun.sleep(20);
  await logInAs(await users.insert(db, { name: "Bob" }));
  await running;
  await request.visit("/").assertText("Bob's todos");
  expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
});

withSlowLogin("an unawaited browser step across logInAs: the login wins", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const { token } = await startSession(db, alice.id);
  const running = session.visit(`/slow-set?token=${token}`).run(); // started, not awaited
  await Bun.sleep(20);
  await logInAs(await users.insert(db, { name: "Bob" }));
  await running;
  await session.visit("/").assertText("Bob's todos");
});
