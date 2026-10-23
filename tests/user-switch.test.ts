// Switching user replaces the previous user's cookie wherever the new one
// lands on the same effective cookie: same name, same path, and the same
// domain once a missing domain means the app's host (case and a leading
// dot don't matter). api, request and session must agree.
import { expect } from "bun:test";
import { SESSION_COOKIE, startSession, type AppDb } from "./example/auth.ts";
import { test, users } from "./example/fixtures.ts";
import type { SessionCookie } from "../src/index.ts";

const domains: (string | undefined)[] = [undefined, "localhost", ".LocalHost"];

for (const first of domains) {
  for (const second of domains) {
    if (first === second) continue;
    let call = 0;
    test.with({
      mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
        const domain = call++ === 0 ? first : second;
        const { token } = await startSession(db, user.id);
        return domain === undefined ? { name: SESSION_COOKIE, value: token } : { name: SESSION_COOKIE, value: token, domain };
      },
    })(`Alice (domain ${first}) then Bob (domain ${second}): everyone is Bob`, async ({ db, logInAs, api, request, session, page, auth }) => {
      call = 0;
      await logInAs(await users.insert(db, { name: "Alice" }));
      await logInAs(await users.insert(db, { name: "Bob" }));
      expect(auth.cookies).toHaveLength(1);
      expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
      await request.visit("/api/me").assertText("Bob").refuteText("Alice");
      await session.visit("/").assertText("Bob's todos");
      const sent = await page.context().cookies("http://localhost/");
      expect(sent.filter((c) => c.name === SESSION_COOKIE)).toHaveLength(1);
    });
  }
}

test.with({
  // Two sid cookies in one result: the last one wins, as in a browser jar.
  mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie[]> => {
    const other = await users.insert(db, { name: "Mallory" });
    const old = await startSession(db, other.id);
    const fresh = await startSession(db, user.id);
    return [
      { name: SESSION_COOKIE, value: old.token },
      { name: SESSION_COOKIE, value: fresh.token, domain: "LOCALHOST" },
    ];
  },
})("duplicate cookies in one mintSession result: the last wins everywhere", async ({ db, logInAs, api, request, session, auth }) => {
  const signedIn = await logInAs(await users.insert(db, { name: "Alice" }));
  expect(auth.cookies).toHaveLength(1);
  expect(signedIn.cookies).toHaveLength(1);
  expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
  expect((await signedIn.api.api.me.get()).data).toMatchObject({ name: "Alice" });
  await request.visit("/api/me").assertText("Alice");
  await signedIn.request.visit("/api/me").assertText("Alice");
  await session.visit("/").assertText("Alice's todos");
});

for (const domain of [undefined, "localhost", ".localhost"]) {
  test(`a partitioned sid in the browser survives logInAs, which still signs the browser in (domain ${domain})`, async ({ db, logInAs, session, page, baseUrl }) => {
    const context = page.context();
    await context.addCookies([
      { name: SESSION_COOKIE, value: "partitioned-old", domain: domain ?? "localhost", path: "/", secure: true, sameSite: "None", partitionKey: new URL(baseUrl).origin },
    ]);
    const partitioned = () => context.cookies().then((all) => all.filter((c) => c.partitionKey));
    expect(await partitioned()).toHaveLength(1);

    await logInAs(await users.insert(db, { name: "Alice" }));

    await session.visit("/").assertText("Alice's todos");
    expect(await partitioned()).toEqual([expect.objectContaining({ name: SESSION_COOKIE, value: "partitioned-old" })]);
  });
}

{
  let call = 0;
  test.with({
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
      const { token } = await startSession(db, user.id);
      return call++ === 0 ? { name: SESSION_COOKIE, value: token } : { name: SESSION_COOKIE, value: token, domain: ".localhost" };
    },
  })("replacing Alice's cookie keeps a partitioned sid on the same domain, and the browser is Bob", async ({ db, logInAs, session, page, baseUrl }) => {
    call = 0;
    const context = page.context();
    await logInAs(await users.insert(db, { name: "Alice" }));
    await context.addCookies([
      { name: SESSION_COOKIE, value: "partitioned-old", domain: "localhost", path: "/", secure: true, sameSite: "None", partitionKey: new URL(baseUrl).origin },
    ]);
    await logInAs(await users.insert(db, { name: "Bob" }));

    await session.visit("/").assertText("Bob's todos");
    const sids = (await context.cookies()).filter((c) => c.name === SESSION_COOKIE);
    expect(sids.filter((c) => c.partitionKey).map((c) => c.value)).toEqual(["partitioned-old"]);
    expect(sids.filter((c) => !c.partitionKey)).toHaveLength(1);
  });
}

// Chromium folds a .localhost Domain cookie into a host-only localhost one,
// so the two can only coexist on a real domain: example.test here.
for (const [label, expires, left] of [
  ["expired", () => Math.floor(Date.now() / 1000) - 3600, []],
  ["live", () => undefined, [".example.test"]],
] as const) {
  let call = 0;
  let token = "";
  test.with({
    // The same token both times: on example.test first, then on .example.test.
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
      if (call++ === 0) {
        token = (await startSession(db, user.id)).token;
        return { name: SESSION_COOKIE, value: token, domain: "example.test" };
      }
      const cookie: SessionCookie = { name: SESSION_COOKIE, value: token, domain: ".example.test" };
      const at = expires();
      return at === undefined ? cookie : { ...cookie, expires: at };
    },
  })(`a replaced cookie with the same value leaves the browser too (moved to .example.test, ${label})`, async ({ db, logInAs, session, page, auth }) => {
    call = 0;
    expect(session).toBeDefined();
    const alice = await users.insert(db, { name: "Alice" });
    await logInAs(alice);
    await logInAs(alice);

    expect(auth.cookies.map((c) => c.domain)).toEqual([".example.test"]);
    const stored = (await page.context().cookies()).filter((c) => c.name === SESSION_COOKIE);
    expect(stored.map((c) => c.domain)).toEqual([...left]);
  });
}
