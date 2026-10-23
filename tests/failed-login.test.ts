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
    expect((await api.me.get()).data).toMatchObject({ name: "Alice" });
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
    expect((await api.me.get()).data).toMatchObject({ name: "Alice" });
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

secondLoginExpires(-1)(
  "an add that installs the new cookie and then fails is rolled back to the previous login",
  async ({ db, logInAs, session, page, api, request, auth }) => {
    call = 0;
    await logInAs(await users.insert(db, { name: "Alice" }));
    await session.visit("/").assertText("Alice's todos");

    const aliceValue = auth.cookies[0]!.value;
    const context = page.context();
    const realAdd = context.addCookies.bind(context);
    context.addCookies = async (list) => {
      if (list.some((c) => c.name === SESSION_COOKIE && c.value !== aliceValue)) {
        await realAdd(list); // installed...
        throw new Error("browser failed part-way"); // ...then failed
      }
      return realAdd(list);
    };
    await expect(logInAs(await users.insert(db, { name: "Bob" }))).rejects.toThrow("browser failed part-way");
    context.addCookies = realAdd;

    const sids = (await context.cookies()).filter((c) => c.name === SESSION_COOKIE);
    expect(sids.map((c) => c.value)).toEqual([aliceValue]);
    await session.visit("/").assertText("Alice's todos");
    expect((await api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/").assertText("Alice's todos");
  },
);

secondLoginExpires(-1)(
  "a failure while putting back a partitioned twin still restores the snapshot",
  async ({ db, logInAs, session, page, baseUrl, api, request, auth }) => {
    call = 0;
    await logInAs(await users.insert(db, { name: "Alice" }));
    const context = page.context();
    await context.addCookies([
      { name: SESSION_COOKIE, value: "partitioned-twin", domain: "localhost", path: "/", secure: true, sameSite: "None", partitionKey: new URL(baseUrl).origin },
    ]);
    const describe = (all: Awaited<ReturnType<typeof context.cookies>>) =>
      all.map((c) => `${c.name}=${c.value}@${c.domain}${c.path}|${c.partitionKey ?? ""}`).sort();
    const snapshot = describe(await context.cookies());
    const before = [...auth.cookies];

    // For Bob's login only: the clear takes more than it was asked for (the
    // partitioned twin included), and the first addCookies, the put-back,
    // rejects once.
    const realClear = context.clearCookies.bind(context);
    const realAdd = context.addCookies.bind(context);
    let rejected = false;
    context.clearCookies = async () => realClear();
    context.addCookies = async (list) => {
      if (!rejected) {
        rejected = true;
        throw new Error("put-back refused");
      }
      return realAdd(list);
    };
    await expect(logInAs(await users.insert(db, { name: "Bob" }))).rejects.toThrow("put-back refused");
    context.clearCookies = realClear;
    context.addCookies = realAdd;

    expect(describe(await context.cookies())).toEqual(snapshot);
    expect(auth.cookies).toEqual(before);
    expect((await api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/").assertText("Alice's todos");
    await session.visit("/").assertText("Alice's todos");
  },
);

secondLoginExpires(-1)(
  "when the add and the restore both fail, the add's error is thrown with the restore's as its cause",
  async ({ db, logInAs, session, page }) => {
    call = 0;
    expect(session).toBeDefined(); // the browser step
    await logInAs(await users.insert(db, { name: "Alice" }));
    const context = page.context();
    const realAdd = context.addCookies.bind(context);
    let calls = 0;
    context.addCookies = async () => {
      calls++;
      throw new Error(calls === 1 ? "add refused" : "restore refused");
    };
    const error = await logInAs(await users.insert(db, { name: "Bob" })).then(
      () => undefined,
      (e: unknown) => e,
    );
    context.addCookies = realAdd;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("add refused");
    expect(((error as Error).cause as Error | undefined)?.message).toBe("restore refused");
  },
);
