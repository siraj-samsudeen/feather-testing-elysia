// A login that fails leaves every client as the previous user, the live
// browser included.
import { expect } from "bun:test";
import { SESSION_COOKIE, startSession, type AppDb } from "./example/auth.ts";
import { test, users } from "./example/fixtures.ts";
import type { SessionCookie } from "../src/index.ts";

let call = 0;
const secondLoginExpires = (expires: number) =>
  test.with({
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
      const { token } = await startSession(db, user.id);
      return call++ === 0 ? { name: SESSION_COOKIE, value: token } : { name: SESSION_COOKIE, value: token, expires };
    },
  });

secondLoginExpires(1e15)(
  "expires in milliseconds by mistake: refused with a clear error, everyone stays Alice",
  async ({ db, logInAs, session, api, request }) => {
    call = 0;
    await logInAs(await users.insert(db, { name: "Alice" }));
    await session.visit("/").assertText("Alice's todos");
    await request.visit("/").assertText("Alice's todos");

    await expect(logInAs(await users.insert(db, { name: "Bob" }))).rejects.toThrow(
      /'sid'.*expires.*milliseconds.*\/ 1000/,
    );

    await session.visit("/").assertText("Alice's todos");
    expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/").assertText("Alice's todos");
  },
);

secondLoginExpires(-1)(
  "the browser refusing the cookie leaves the browser as Alice",
  async ({ db, logInAs, session, page, api, request, auth }) => {
    call = 0;
    await logInAs(await users.insert(db, { name: "Alice" }));
    await session.visit("/").assertText("Alice's todos");

    // The browser refuses Bob's cookie (and only it).
    const aliceValue = auth.cookies[0]!.value;
    const context = page.context();
    const realAdd = context.addCookies.bind(context);
    context.addCookies = async (list) => {
      if (list.some((c) => c.name === SESSION_COOKIE && c.value !== aliceValue)) {
        throw new Error("browser refused the cookie");
      }
      return realAdd(list);
    };
    await expect(logInAs(await users.insert(db, { name: "Bob" }))).rejects.toThrow("browser refused the cookie");
    context.addCookies = realAdd;

    await session.visit("/").assertText("Alice's todos");
    expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/").assertText("Alice's todos");
  },
);

const invalid: [string, Partial<SessionCookie>, RegExp][] = [
  ["a name with a space", { name: "my sid" }, /invalid name/],
  ["a value with ';'", { value: "a;b" }, /invalid value/],
  ["expires NaN", { expires: Number.NaN }, /expires NaN/],
  ["a path without '/'", { path: "api" }, /path "api"/],
  ["an empty domain", { domain: "." }, /empty domain/],
  ["an unknown sameSite", { sameSite: "lax" as never }, /sameSite "lax"/],
];

for (const [label, change, message] of invalid) {
  test.with({
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => ({
      name: SESSION_COOKIE,
      value: (await startSession(db, user.id)).token,
      ...change,
    }),
  })(`a cookie with ${label} is refused before anything changes`, async ({ db, logInAs, auth }) => {
    await expect(logInAs(await users.insert(db))).rejects.toThrow(message);
    expect(auth.cookies).toEqual([]);
  });
}
