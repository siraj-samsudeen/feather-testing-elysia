// api sends a cookie only where a browser (and core's request adapter) would:
// matching domain and path, not expired, Secure only over https or localhost.
import { expect } from "bun:test";
import { SESSION_COOKIE, startSession, type AppDb } from "./example/auth.ts";
import { test, users } from "./example/fixtures.ts";
import type { SessionCookie } from "../src/index.ts";

const minting = (shape: (token: string) => SessionCookie) =>
  test.with({
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }) =>
      shape((await startSession(db, user.id)).token),
  });

const hourAgo = () => Math.floor(Date.now() / 1000) - 3600;

const anonymousCases: [string, (token: string) => SessionCookie][] = [
  ["expired", (value) => ({ name: SESSION_COOKIE, value, expires: hourAgo() })],
  ["for another domain", (value) => ({ name: SESSION_COOKIE, value, domain: "example.com" })],
  ["for another path", (value) => ({ name: SESSION_COOKIE, value, path: "/admin" })],
];

for (const [label, shape] of anonymousCases) {
  minting(shape)(`a cookie ${label} leaves api and request anonymous`, async ({ db, logInAs, api, request }) => {
    const signedIn = await logInAs(await users.insert(db, { name: "Alice" }));
    expect((await api.api.me.get()).status).toBe(401);
    expect((await signedIn.api.api.me.get()).status).toBe(401);
    await request.visit("/api/me").assertText("not signed in");
  });
}

const signedInCases: [string, (token: string) => SessionCookie][] = [
  ["host-only", (value) => ({ name: SESSION_COOKIE, value })],
  ["for localhost, Secure, unexpired, path /api", (value) => ({
    name: SESSION_COOKIE, value, domain: "localhost", secure: true, path: "/api", expires: hourAgo() + 7200,
  })],
];

for (const [label, shape] of signedInCases) {
  minting(shape)(`a cookie ${label} signs api and request in`, async ({ db, logInAs, api, request }) => {
    const signedIn = await logInAs(await users.insert(db, { name: "Alice" }));
    expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
    expect((await signedIn.api.api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/api/me").assertText("Alice");
  });
}

test("an explicit cookie header on a call wins", async ({ db, logInAs, api }) => {
  await logInAs(await users.insert(db, { name: "Alice" }));
  const bob = await users.insert(db, { name: "Bob" });
  const { token } = await startSession(db, bob.id);
  expect((await api.api.me.get({ headers: { cookie: `${SESSION_COOKIE}=${token}` } })).data).toMatchObject({ name: "Bob" });
});

for (const expires of [-1, -42]) {
  minting((value) => ({ name: SESSION_COOKIE, value, expires }))(
    `expires ${expires} is a session cookie (as in Playwright): api, request and session are signed in`,
    async ({ db, logInAs, api, request, session }) => {
      const signedIn = await logInAs(await users.insert(db, { name: "Alice" }));
      expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
      expect((await signedIn.api.api.me.get()).data).toMatchObject({ name: "Alice" });
      await request.visit("/api/me").assertText("Alice");
      await signedIn.request.visit("/api/me").assertText("Alice");
      await session.visit("/").assertText("Alice's todos");
    },
  );
}

minting((value) => ({ name: SESSION_COOKIE, value, secure: true }))(
  "a host-only Secure cookie stays Secure in the browser and still signs it in on localhost",
  async ({ db, logInAs, session, page }) => {
    await logInAs(await users.insert(db, { name: "Alice" }));
    const [sid] = (await page.context().cookies()).filter((c) => c.name === SESSION_COOKIE);
    expect(sid).toMatchObject({ secure: true, domain: "localhost", path: "/" });
    await session.visit("/").assertText("Alice's todos");
  },
);
