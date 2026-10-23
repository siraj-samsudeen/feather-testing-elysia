// The rule: await your steps before logInAs, and await logInAs before your
// next steps — anything else fails loudly instead of racing.
import { expect } from "bun:test";
import { createApp } from "./example/app.ts";
import { SESSION_COOKIE, startSession, userForToken, type AppDb } from "./example/auth.ts";
import type { SessionCookie } from "../src/index.ts";
import { test, users } from "./example/fixtures.ts";

// A route that waits, then says which user its request arrived as.
const withSlowWhoami = test.with({
  createApp: ((deps: Parameters<typeof createApp>[0]) =>
    createApp(deps).get("/whoami-slow", async ({ query, cookie }) => {
      const user = await userForToken(deps.db, cookie[SESSION_COOKIE]?.value as string | undefined);
      await Bun.sleep(Number(query.ms ?? 0));
      return new Response(`<p>arrived as ${user?.name ?? "nobody"}</p>`, { headers: { "content-type": "text/html" } });
    })) as unknown as typeof createApp,
});

for (const which of ["request", "session"] as const) {
  withSlowWhoami(`logInAs refuses while a ${which} chain is running, and nothing changes`, async ({ db, logInAs, request, session, api, auth }) => {
    await logInAs(await users.insert(db, { name: "Alice" }));
    const before = [...auth.cookies];
    const chain = which === "request" ? request : session;
    const running = chain.visit("/whoami-slow?ms=150").run(); // started, not awaited

    await expect(logInAs(await users.insert(db, { name: "Bob" }))).rejects.toThrow(
      new RegExp(`needs your ${which} steps to be finished — await them before logging in`),
    );
    await running;

    expect(auth.cookies).toEqual(before);
    expect((await api.api.me.get()).data).toMatchObject({ name: "Alice" });
    await request.visit("/whoami-slow").assertText("arrived as Alice");
    await session.visit("/whoami-slow").assertText("arrived as Alice");
  });

  withSlowWhoami(`a ${which} chain started while logInAs is in progress refuses; the login completes`, async ({ db, logInAs, request, session, api }) => {
    const chain = which === "request" ? request : session;
    expect(session).toBeDefined(); // a browser step makes the login take a moment
    const login = logInAs(await users.insert(db, { name: "Bob" })); // not awaited
    await expect(chain.visit("/whoami-slow").run()).rejects.toThrow(
      new RegExp(`${which} steps were started while logInAs\\(…\\) was in progress — await logInAs first`),
    );
    await login;

    expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
    // The refused steps were dropped, not left queued for the next await.
    await chain.visit("/whoami-slow").assertText("arrived as Bob");
    await chain.assertPath("/whoami-slow");
  });
}

withSlowWhoami("awaited steps and logins in turn work as usual", async ({ db, logInAs, request, session }) => {
  await request.visit("/whoami-slow").assertText("arrived as nobody");
  await logInAs(await users.insert(db, { name: "Alice" }));
  await request.visit("/whoami-slow").assertText("arrived as Alice");
  await session.visit("/whoami-slow").assertText("arrived as Alice");
  await logInAs(await users.insert(db, { name: "Bob" }));
  await request.visit("/whoami-slow").assertText("arrived as Bob");
  await session.visit("/whoami-slow").assertText("arrived as Bob");
});

// mintSession's exemptions last only while it runs, not in tasks it leaves behind.
{
  let deferred: (() => Promise<unknown>) | undefined;
  let slowMint = false;
  const withDeferred = test.with({
    mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
      const task = deferred;
      deferred = undefined;
      if (task) setTimeout(() => void task(), 30); // outlives this mint
      if (slowMint) await Bun.sleep(150);
      return { name: SESSION_COOKIE, value: (await startSession(db, user.id)).token };
    },
  });

  withDeferred("a task left by one login's mint, firing during the next login, is refused", async ({ db, logInAs, request }) => {
    let outcome: unknown;
    deferred = () => request.visit("/").run().then(() => "ran", (error: unknown) => error);
    const done = new Promise<void>((resolve) => {
      const task = deferred!;
      deferred = async () => {
        outcome = await task();
        resolve();
      };
    });
    slowMint = false;
    await logInAs(await users.insert(db, { name: "Alice" })); // leaves the task behind
    slowMint = true;
    const bob = logInAs(await users.insert(db, { name: "Bob" })); // the task fires while this runs
    await done;
    await bob;
    slowMint = false;
    expect(String(outcome)).toContain("started while logInAs(…) was in progress");
  });

  withDeferred("logInAs from a task a mint left behind is a normal login, not re-entry", async ({ db, logInAs, api }) => {
    const bob = await users.insert(db, { name: "Bob" });
    let outcome: unknown;
    const done = new Promise<void>((resolve) => {
      deferred = async () => {
        outcome = await logInAs(bob).then(() => "logged in", (error: unknown) => error);
        resolve();
      };
    });
    slowMint = false;
    await logInAs(await users.insert(db, { name: "Alice" }));
    await done;
    expect(outcome).toBe("logged in");
    expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
  });
}

// A microtask a mintSession queues on its way out runs before any await
// after it; it must not count as inside mintSession, sync or async.
for (const kind of ["sync", "async"] as const) {
  let task: (() => void) | undefined;
  const tokens = new Map<number, string>();
  const withMicrotask = test.with({
    mintSession:
      kind === "sync"
        ? ({ user }: { db: AppDb; user: { id: number } }): SessionCookie => {
            const t = task;
            task = undefined;
            if (t) queueMicrotask(t);
            return { name: SESSION_COOKIE, value: tokens.get(user.id)! };
          }
        : async ({ db, user }: { db: AppDb; user: { id: number } }): Promise<SessionCookie> => {
            const value = (await startSession(db, user.id)).token;
            const t = task;
            task = undefined;
            if (t) queueMicrotask(t);
            return { name: SESSION_COOKIE, value };
          },
  });
  const insert = async (db: AppDb, name: string) => {
    const user = await users.insert(db, { name });
    tokens.set(user.id, (await startSession(db, user.id)).token); // for the sync mint
    return user;
  };

  withMicrotask(`a microtask from a ${kind} mintSession running a chain during the login is refused`, async ({ db, logInAs, request, session }) => {
    expect(session).toBeDefined(); // a browser step keeps the login going after the mint
    let outcome: unknown;
    task = () => {
      outcome = request.visit("/").run().then(() => "ran", (error: unknown) => error);
    };
    await logInAs(await insert(db, "Alice"));
    expect(String(await outcome)).toContain("started while logInAs(…) was in progress");
  });

  withMicrotask(`logInAs from a microtask a ${kind} mintSession queued is a normal login`, async ({ db, logInAs, api }) => {
    const bob = await insert(db, "Bob");
    let outcome: Promise<unknown> | undefined;
    task = () => {
      outcome = logInAs(bob).then(() => "logged in", (error: unknown) => error);
    };
    await logInAs(await insert(db, "Alice"));
    expect(await outcome).toBe("logged in");
    expect((await api.api.me.get()).data).toMatchObject({ name: "Bob" });
  });
}
