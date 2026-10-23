# feather-testing-elysia

Playwright-style fixtures for [Elysia](https://elysiajs.com) apps under `bun test`. A test destructures what it needs (`app`, `session`, `request`, `api`, `db`, `logInAs`, …); only that is set up, with sensible defaults, and everything is torn down after the test, even when it fails. Tests run against a real Postgres (PGlite or a server), never mocks.

Built on two Feather packages:

- [feather-testing-core](https://github.com/siraj-samsudeen/feather-testing-core) 0.7: the fluent session DSL (`visit`, `fillIn`, `clickButton`, `assertText`, …), its Playwright and request adapters, and its fixture engine (`defineTest`, `.extend()`, `.with()`).
- [feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres) 0.2: one rolled-back transaction (or one cloned database) per test, on PGlite or Postgres, with a Drizzle handle you inject with `createApp({ db })`.

> **Status: v0.1, unpublished.** Both foundations are unpublished too (core `0.7.0-beta.1`, PR #17; postgres `0.2.0`, PR #6), so this repo installs them from tarballs in `vendor/`. `peerDependencies` already name the npm ranges they will become; before publishing, replace the `file:vendor/…` devDependencies with those npm versions (`prepublishOnly` refuses to publish until then).

## Before / after

**Before** (elysia-todo's acceptance test, by hand):

```ts
let browser, context, page, app, baseUrl;
beforeAll(async () => { browser = await chromium.launch({ headless: !headed, slowMo: headed ? 700 : 0 }); });
afterAll(async () => { await browser.close(); });
beforeEach(async () => {
  app = createApp().listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
  context = await browser.newContext(record ? { recordVideo: { dir: "test-results/videos" } } : {});
  page = await context.newPage();
});
afterEach(async () => { if (record) await page.screenshot({ /* … */ }); await context.close(); await app.stop(); });

test("1.0 …", async () => {
  await createSession(page, { baseUrl }).visit("/") /* … */;
});
```

**After:**

```ts
// tests/fixtures.ts
import { featherTest } from "feather-testing-elysia";
import { createApp } from "../src/app";

export const test = featherTest({ createApp });

// tests/todos.test.ts
import { test } from "./fixtures";

test("1.0 …", async ({ session }) => {
  await session.visit("/") /* … */;
});
```

`HEADED=1` and `RECORD=1` still work; the browser is launched once per file, only if a test asks for it.

**With a database and users** (Phoenix-style: insert a user, log them in, drive the browser):

```ts
// tests/fixtures.ts
import { featherTest } from "feather-testing-elysia";
import { factory, seq } from "feather-testing-postgres/drizzle";
import { createApp } from "../src/app";
import { startSession, SESSION_COOKIE, type AppDb } from "../src/auth";
import * as schema from "../src/schema";

export const test = featherTest({
  createApp,                                          // called as createApp({ db })
  db: { migrations: "./drizzle", schema },            // engine from FEATHER_DB: pglite (default) or postgres
  mintSession: async ({ db, user }: { db: AppDb; user: { id: number } }) => {
    const { token, expiresAt } = await startSession(db, user.id); // the app's own session code
    return { name: SESSION_COOKIE, value: token, httpOnly: true, expires: expiresAt.getTime() / 1000 };
  },
});

export const users = factory(schema.users, { email: seq((n) => `user${n}@example.com`), name: "Ada", passwordHash: "x" });
export const todos = factory(schema.todos, { title: "Buy milk" });
```

```ts
// tests/todos.test.ts
import { expect } from "bun:test";
import { test, todos, users } from "./fixtures";

test("a signed-in user sees their todos", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });

  await logInAs(alice);

  await session.visit("/").assertText("Alice's todos").assertHas("li", { text: "Buy milk" });
});

test("the same, without a browser", async ({ db, logInAs, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });
  await logInAs(alice);
  await request.visit("/").assertHas("li", { text: "Buy milk" });
});

test("the JSON API", async ({ db, logInAs, api }) => {
  await logInAs(await users.insert(db));
  const { data } = await api.api.todos.get();          // Eden Treaty, typed from the app's routes
  expect(data).toEqual([]);
});
```

Every row a test inserts, and every row the app writes while serving it, is rolled back after the test. The app sees the test's rows because it runs on the test's own transaction.

The complete example (a tiny Elysia app with `users`, `sessions` and `todos` tables, hand-rolled cookie sessions, and tests at both levels) is in [`tests/example/`](tests/example).

## Installation

```bash
bun add -d feather-testing-elysia feather-testing-core elysia @elysiajs/eden
bun add -d playwright                     # for session (a real browser); then: bunx playwright install chromium
bun add -d happy-dom                      # only for request sessions (core's request adapter parses pages with it);
                                          # logInAs, api and session work without it
bun add -d feather-testing-postgres drizzle-orm @electric-sql/pglite   # for db
```

Each test gets core's per-test timeout of 30 s (120 s with `HEADED=1`), enough for launching Chromium and for the first test of a file, which starts and migrates the database. It is passed to `bun:test` per test, so bun's own 5 s default doesn't apply. (Bun 1.4.2 ignores `timeout` under `[test]` in `bunfig.toml` anyway.)

The package ships TypeScript source; Bun runs it as is.

## `featherTest(options)`

```ts
featherTest<App, Db, User>({
  createApp: (deps: { db: Db }) => App,          // required: a fresh app per test
  db?: DbOptions | FeatherDb,                    // feather-testing-postgres: createFeatherDb options, or a FeatherDb
  mintSession?: MintSession<User, Db, App>,      // what logInAs uses
  runner?: { test, afterAll },                   // default: bun:test's
}): TestFn<FeatherFixtures<App, Db, User>>
```

It returns core's test function (`defineCoreTest(runner).extend(...)`), so `.extend({...})` adds your own fixtures and `.with({...})` replaces values for a group of tests:

```ts
const withFakeMailer = test.with({ createApp: ({ db }) => createApp({ db, mailer: fakeMailer }) });
withFakeMailer("sends the welcome email", async ({ request }) => { /* … */ });
```

## Fixtures

| Fixture | Scope | Default | Override |
|---|---|---|---|
| `app` | test | `createApp({ db })`, or `createApp({})` without a db, after its async plugins load (`await app.modules`). Never listens unless `baseUrl` is asked for | `test.with({ createApp })` |
| `handler` | test | `(req) => app.handle(req)` | `.with({ handler })` |
| `baseUrl` | test | `app.listen(0)` → `http://localhost:<port>`; `app.stop()` after. Only when a test (or `session`) asks for it: a request-only test never opens a port | `.with({ baseUrl: "http://…" })` to point at another server |
| `session` | test | A Playwright session (core's adapter) on `page`, `baseUrl` preset, signed in by `logInAs` (each login is added to its browser context at once, so the latest login wins) | `.with({ headed, record, browserName, slowMo })` |
| `request` | test | A request-adapter session on `handler` (no browser, in-process), signed in by `logInAs` from its next step | |
| `api` | test | An Eden Treaty client on `app.handle`: in-process, no HTTP, typed from the app's routes; sends `logInAs`'s cookies that match each call's URL | |
| `logInAs` | test | `(user) => Promise<{ cookies, request, api }>`, see below | `.with({ mintSession })` |
| `db` | test | With `db` configured: the Drizzle handle on the test's transaction (`strategy: "tx"`) or cloned database (`"clone"`). The same handle `app` got | `db` option |
| `sql` | test | Raw SQL (tagged template, `sql.unsafe`) on the same transaction | |
| `testDb`, `dbEngine` | test, file | feather-testing-postgres's `{ db, sql, raw }` and the started engine (started and migrated once per file, closed after) | |
| `browser`, `context`, `page`, `rtl` | file, test, test, test | Core's: Chromium launched once per file when first needed; a fresh context and page per test | `.with({ browserName, headed, record, outputDir })` |
| `auth` | test | The cookies of the latest `logInAs` (what `session`, `request` and `api` start with) | |

Options (plain values, overridable with `.with()`): `createApp`, `mintSession`, and core's `browserName` (`"chromium"`), `headed` (`HEADED=1`), `slowMo` (700 when headed), `record` (`"on"` with `RECORD=1`, else `"off"`; or `"on-failure"`), `outputDir` (`"test-results"`).

**Watching and recording.** `HEADED=1 bun test` opens a visible browser with `slowMo` 700 and a 120 s per-test timeout. `RECORD=1 bun test` saves a video of every page to `test-results/videos/` and a screenshot of the last page to `test-results/screenshots/`.

## `mintSession` and `logInAs`

`mintSession` is your app's half of signing in, without the login form:

```ts
type MintSession<User, Db, App> = (args: { db: Db; user: User; app: App }) =>
  SessionCookie | SessionCookie[] | Promise<SessionCookie | SessionCookie[]>;

interface SessionCookie {            // core's, re-exported here (Playwright's shape)
  name: string; value: string;
  domain?: string;                   // default: host-only for the app's host
  path?: string;                     // default "/"
  expires?: number;                  // seconds since the epoch; none or negative (-1): a session cookie
  httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None";
}
```

- `db` is the test's db (inside its transaction), so the session row it inserts is visible to the app and rolled back after. Without a db configured it is `undefined`.
- Return exactly the cookie(s) your login route would set. Call the same function your login route calls (`startSession(db, user.id)` in the example) rather than duplicating it.
- Whatever `user` is (a row, an id) is up to you: `logInAs(user)` passes it through, typed from `mintSession`'s parameter.
- With better-auth later, `mintSession` is where its session creation goes; nothing else changes.

`await logInAs(user)`:

1. calls `mintSession({ db, user, app })`;
2. signs in the test's own `session`, `request` and `api` with those cookies. The browser `session` gets them in its context immediately, so the latest login wins, even over steps already queued. `request` gets them through core's `addCookies`, queued as a step: they apply from its next step on, and steps queued before `logInAs` and not yet awaited run first, as the previous user;
3. returns `{ cookies, request, api }`: that user's cookies, plus a fresh request session and Eden client of their own. Use them for several users in one test:

```ts
const asAlice = await logInAs(alice);
const asBob = await logInAs(bob);           // the test's own session/request/api are now Bob
await asAlice.request.visit("/").refuteText("Bob's errand");
```

Without `mintSession`, `logInAs` throws, naming the option.

## `api`

`api` is an `@elysiajs/eden` Treaty client on the app: calls go straight to `app.handle` (addressed as `http://localhost`, like `request`), with no port and no HTTP, and are typed from the app's routes (`api.api.todos.get()` → `{ data, error, status }`). After `logInAs`, it sends the signed-in cookies the way a browser would: only those whose domain and path match the call, not expired, and `Secure` ones only over https or to localhost. A `cookie` header the call sets itself wins. It does not keep cookies the app sets in responses (it is not a cookie jar). Use `request` for flows that log in through a form.

## Rules

- **Sequential only.** One test owns the database transaction at a time. `bun test` runs files one after another in one process, and a file's tests in order, which is what this needs. Never use `test.concurrent`; feather-testing-postgres's `beginTest()` refuses a second open test.
- **A test must name its fixtures by destructuring** its first parameter: `async ({ db, session }) => …`. A test that needs none takes no parameter: `async () => …`. In minified code, name them: `test(name, ["session"], fn)`.
- **One `featherTest(...)` per project**, in a shared `tests/fixtures.ts`, imported by every test file. The engine (PGlite or Postgres) is started and migrated once per file.
- **Lanes.** PGlite is the default (`FEATHER_DB` unset): nothing to install. Run a Postgres lane too, pinned to production's major version: `FEATHER_DB=postgres DATABASE_URL=postgres://… bun test`.

## Limits (v0.1)

- **bun test first.** `runner` accepts Vitest's `{ test, afterAll }`, but only `bun test` is tested.
- **The `request` that `logInAs` returns is a proxy** created on its first DSL call (so happy-dom loads only if it is used). It is not `instanceof Session`, and not a thenable until its first step is queued; everything else behaves the same.
- **Queued steps and logins.** The browser `session` takes a login at once, even over steps already queued; `request` takes it from its next step (core's `addCookies` is a step). Await a chain before switching user if that difference matters.
- **`api` sends cookies but does not store them.**
- **One app per test.** `handler`, `baseUrl`, `api` and `logInAs` all use the same `app`.
- **PGlite gaps** (one connection, extensions as modules, `now()` frozen within a transaction): see feather-testing-postgres's README.

## Next

- **Outbox helpers**: assert on jobs and emails the app queued (`outbox`, `assertEmailed`), in the test's transaction.
- **`runJobs()`**: run queued jobs in-process inside the test, to see their effects.
- better-auth: a ready-made `mintSession` for it.
- React (client-rendered) pages: `session` already drives them; a component-level fixture (`rtl` + the app's API) is a later step.

## Developing

```bash
mise exec bun@1.4.2 -- bun install
mise exec bun@1.4.2 -- bunx playwright install chromium
mise exec bun@1.4.2 -- bun run test:pglite       # the PGlite lane (default)
mise exec bun@1.4.2 -- bun run test:postgres     # needs a local Postgres; DATABASE_URL defaults to postgres://postgres:postgres@127.0.0.1:5432/feather_elysia_test
mise exec bun@1.4.2 -- bun run typecheck
mise exec bun@1.4.2 -- bun run db:generate       # after changing tests/example/schema.ts
```

## License

MIT
