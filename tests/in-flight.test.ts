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

// A route that waits, then says which user its request arrived as.
const withSlowWhoami = test.with({
  createApp: ((deps: Parameters<typeof createApp>[0]) =>
    createApp(deps).get("/whoami-slow", async ({ query, cookie }) => {
      const sid = cookie[SESSION_COOKIE]?.value as string | undefined;
      const { userForToken } = await import("./example/auth.ts");
      const user = await userForToken(deps.db, sid);
      await Bun.sleep(Number(query.ms ?? 0));
      return new Response(`<p>arrived as ${user?.name ?? "nobody"}</p>`, { headers: { "content-type": "text/html" } });
    })) as unknown as typeof createApp,
});

withSlowWhoami("a chain started while logInAs waits for running chains is sent after the login", async ({ db, logInAs, request }) => {
  const bob = await users.insert(db, { name: "Bob" });
  const first = request.visit("/whoami-slow?ms=80").run(); // running: logInAs will wait for it
  const login = logInAs(bob); // not awaited
  await Bun.sleep(20);
  const second = request.visit("/whoami-slow?ms=0").run(); // started during the wait
  await login;
  await first;
  await second;
  await request.assertText("arrived as Bob");
});

withSlowWhoami("a chain started between the browser step and the commit is sent after the login", async ({ db, logInAs, session, page, request }) => {
  expect(session).toBeDefined(); // the browser step
  const context = page.context();
  const realAdd = context.addCookies.bind(context);
  context.addCookies = async (list) => {
    await Bun.sleep(100);
    return realAdd(list);
  };
  const login = logInAs(await users.insert(db, { name: "Bob" })); // not awaited
  await Bun.sleep(40); // inside the browser step now
  const chain = request.visit("/whoami-slow?ms=0").run();
  await login;
  await chain;
  await request.assertText("arrived as Bob");
});

withSlowWhoami("a failed login releases the chains it held", async ({ db, logInAs, session, page, request }) => {
  expect(session).toBeDefined();
  const context = page.context();
  context.addCookies = async () => {
    await Bun.sleep(60);
    throw new Error("browser refused the cookie");
  };
  const login = logInAs(await users.insert(db, { name: "Bob" })).then(() => "ok", () => "failed");
  await Bun.sleep(20);
  const chain = request.visit("/whoami-slow?ms=0").run(); // held while the login runs
  expect(await login).toBe("failed");
  await Promise.race([chain, Bun.sleep(2000).then(() => { throw new Error("still held"); })]);
  await request.assertText("arrived as nobody");
});

withSlowWhoami("a chain held by one login doesn't stall the next login", async ({ db, logInAs, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const bob = await users.insert(db, { name: "Bob" });
  const first = logInAs(alice); // not awaited
  const chain = request.visit("/whoami-slow?ms=0").run(); // held
  const second = logInAs(bob); // queued behind the first
  const started = Date.now();
  await Promise.all([first, second, chain]);
  expect(Date.now() - started).toBeLessThan(2000);
  await request.assertText("arrived as Bob");
});
