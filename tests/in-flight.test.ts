// The rule: await your steps before logInAs, and await logInAs before your
// next steps — anything else fails loudly instead of racing.
import { expect } from "bun:test";
import { createApp } from "./example/app.ts";
import { SESSION_COOKIE, userForToken } from "./example/auth.ts";
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
