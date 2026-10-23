/**
 * feather-testing-elysia: Playwright-style fixtures for Elysia apps.
 *
 *   export const test = featherTest({ createApp, db: { migrations: "./drizzle" }, mintSession });
 *
 *   test("lists my todos", async ({ db, logInAs, session }) => {
 *     const alice = await insertUser(db);
 *     await logInAs(alice);
 *     await session.visit("/").assertText("Buy milk");
 *   });
 *
 * A test destructures what it needs; only that (and what it depends on) is
 * set up, and everything is torn down after the test, even when it fails.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { treaty, type Treaty } from "@elysiajs/eden";
import type { AnyElysia } from "elysia";
import { Session, type SessionCookie } from "feather-testing-core";
import { cookieHeaderFor } from "feather-testing-core/cookies";
import {
  defineCoreTest,
  FixtureValue,
  value,
  type CoreFixtures,
  type FixtureDef,
  type FixtureDefs,
  type Runner,
  type TestBody,
  type TestFn,
} from "feather-testing-core/fixtures";

export type { Runner, TestFn } from "feather-testing-core/fixtures";

/** The options whose values are functions: .with() takes them as values, not fixture functions. */
const FUNCTION_OPTIONS = ["createApp", "mintSession"] as const;
type FunctionOption = (typeof FUNCTION_OPTIONS)[number];

/** featherTest's test function: core's, with .with() taking createApp / mintSession as plain functions. */
export interface FeatherTestFn<F> {
  (name: string, body: TestBody<F>): void;
  (name: string, uses: (keyof F & string)[], body: TestBody<F>): void;
  extend<G extends object>(fixtures: FixtureDefs<G, F & G>): FeatherTestFn<F & G>;
  with(overrides: {
    [K in keyof F]?: K extends FunctionOption ? F[K] | FixtureValue<F[K]> : FixtureDef<F[K], F>;
  }): FeatherTestFn<F>;
}

/**
 * Core's .with() reads a function as a fixture function; createApp and
 * mintSession are option values that happen to be functions, so wrap them
 * in value() on the way in.
 */
function withFunctionOptions<F>(base: TestFn<F>): FeatherTestFn<F> {
  const test = ((...args: Parameters<TestFn<F>>) => (base as (...a: unknown[]) => void)(...args)) as FeatherTestFn<F>;
  test.extend = (fixtures) => withFunctionOptions(base.extend(fixtures));
  test.with = (overrides) => {
    const wrapped: Record<string, unknown> = { ...overrides };
    for (const key of FUNCTION_OPTIONS) {
      if (typeof wrapped[key] === "function") wrapped[key] = value(wrapped[key]);
    }
    return withFunctionOptions(base.with(wrapped as Parameters<TestFn<F>["with"]>[0]));
  };
  return test;
}
/** A cookie a session starts with (core's): no domain = host-only for the app's host; expires in seconds, none or negative = a session cookie. */
export type { SessionCookie } from "feather-testing-core";

type RequestHandler = (request: Request) => Response | Promise<Response>;
type PlaywrightSession = CoreFixtures["session"];
type RequestSession = CoreFixtures["request"];


/**
 * The consumer's half of logInAs: make `user` signed in the way the app does
 * (insert a sessions row, sign a token, ...) and return the cookie(s) the
 * app's login would set. `db` is the test's db (undefined without one).
 */
export type MintSession<User, Db, App> = (args: {
  db: Db;
  user: User;
  app: App;
}) => SessionCookie | SessionCookie[] | Promise<SessionCookie | SessionCookie[]>;

/** What logInAs(user) returns: that user's cookies and request-level clients of their own. */
export interface SignedIn<App extends AnyElysia> {
  /** The cookies mintSession returned. */
  cookies: SessionCookie[];
  /** A fresh request-adapter session (no browser) starting with those cookies. */
  request: RequestSession;
  /** An Eden Treaty client sending those cookies. */
  api: Treaty.Create<App>;
}

/**
 * Raw SQL on the test's transaction (feather-testing-postgres's SqlRunner,
 * mirrored here so a project without a database needs no postgres types).
 */
export interface SqlRunner {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** feather-testing-postgres's createFeatherDb options (see its README). */
export interface DbOptions {
  /** Default: FEATHER_DB, else "pglite". */
  engine?: "pglite" | "postgres";
  /** Default "tx": one rolled-back transaction per test. "clone": a fresh database per test. */
  strategy?: "tx" | "clone";
  /** Postgres engine: default DATABASE_URL. */
  url?: string;
  driver?: "bun" | "postgres-js";
  /** A drizzle-kit migrations folder, applied once per file. */
  migrations?: string;
  setup?: (sql: SqlRunner) => unknown;
  /** Passed to drizzle(), enabling db.query.<table>. */
  schema?: Record<string, unknown>;
  pglite?: Record<string, unknown>;
}

/** A started feather-testing-postgres FeatherDb (structural). */
export interface FeatherDbLike<Db> {
  readonly engine: "pglite" | "postgres";
  readonly strategy: "tx" | "clone";
  start(): Promise<void>;
  beginTest(): Promise<TestDbLike<Db>>;
  endTest(): Promise<void>;
  close(): Promise<void>;
}

export interface TestDbLike<Db> {
  db: Db;
  sql: SqlRunner;
  raw: unknown;
}

export interface FeatherTestOptions<App extends AnyElysia, Db, User> {
  /** Builds a fresh app per test. Called as createApp({ db }) — or createApp({}) without a db. */
  createApp: (deps: { db: Db }) => App;
  /**
   * A real Postgres per test via feather-testing-postgres: createFeatherDb
   * options (engine from FEATHER_DB, strategy, migrations, schema, ...) or a
   * FeatherDb. Omit it for an app without a database.
   */
  db?: DbOptions | FeatherDbLike<Db>;
  /** Mints a signed-in session for logInAs(user). Without it, logInAs throws. */
  mintSession?: MintSession<User, Db, App>;
  /** The test runner's { test, afterAll }. Default: bun:test's. */
  runner?: Runner;
}

/** The fixtures featherTest adds to core's (browser, context, page, session, request, rtl). */
export interface ElysiaFixtures<App extends AnyElysia, Db, User> {
  /** Option: the app factory (override with test.with({ createApp })). */
  createApp: (deps: { db: Db }) => App;
  /** A fresh app for the test: createApp({ db }), or createApp({}) without a db; its async plugins already loaded. */
  app: App;
  /** The app's request handler (app.handle), for the request adapter. */
  handler: RequestHandler;
  /** The app listening on a free port (app.listen(0)), stopped after the test. Only started when asked for. */
  baseUrl: string;
  /** Option: how logInAs signs a user in (override with test.with({ mintSession })). */
  mintSession: MintSession<User, Db, App> | undefined;
  /**
   * Sign `user` in: mintSession({ db, user, app }) makes the cookies, and
   * the test's own session, request and api use them from then on, at
   * once (even for steps already queued). Returns that user's cookies
   * and request / api clients of their own, for tests with several users.
   */
  logInAs: (user: User) => Promise<SignedIn<App>>;
  /** The cookies of the latest logInAs, which session, request and api start with. */
  auth: { readonly cookies: readonly SessionCookie[] };
  /** A Playwright session on the app's baseUrl, signed in by logInAs. */
  session: PlaywrightSession;
  /** A request-adapter session on the app's handler (no browser), signed in by logInAs. */
  request: RequestSession;
  /** An Eden Treaty client on the app, in-process (app.handle, no port), typed from its routes; sends logInAs's cookies. */
  api: Treaty.Create<App>;
  /** With a db configured: the Drizzle handle bound to this test's transaction, handed to createApp. */
  db: Db;
  /** With a db configured: raw SQL on the same transaction. */
  sql: SqlRunner;
  /** With a db configured: { db, sql, raw } for this test (ended after it). */
  testDb: TestDbLike<Db>;
  /** With a db configured: the started engine, shared by the file's tests. */
  dbEngine: FeatherDbLike<Db>;
}

export type FeatherFixtures<App extends AnyElysia, Db, User = unknown> = Omit<
  CoreFixtures,
  "handler" | "baseUrl" | "session" | "request"
> &
  ElysiaFixtures<App, Db, User>;

/** The cookies the test is signed in with, and who to tell when they change. */
class AuthState {
  cookies: SessionCookie[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `login` after every login started before it has settled (passed or failed). */
  serialize<T>(login: () => Promise<T>): Promise<T> {
    const run = this.tail.then(login);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Chains of the test's session and request that are running now, by which. */
  private running = new Map<Promise<unknown>, "session" | "request">();

  /** Logins started and not yet settled (passed or failed). */
  private logins = 0;

  beginLogin(): void {
    this.logins++;
  }

  endLogin(): void {
    this.logins--;
  }

  /**
   * The rule: await your steps before logInAs, and await logInAs before
   * your next steps. logInAs calls this first: it refuses while a chain of
   * the test's session or request is running, naming which.
   */
  refuseWhileRunning(): void {
    const which = [...new Set(this.running.values())].sort();
    if (which.length > 0) {
      throw new Error(
        `logInAs needs your ${which.join(" and ")} steps to be finished — await them before logging in.`,
      );
    }
  }

  /**
   * Record when a chain of `session` runs (await, then() and run() all go
   * through run()). A chain started while a login is in progress refuses
   * at once (unless mintSession itself started it), and its queued steps
   * are dropped so they don't run on the next await.
   */
  track<S extends { run(): Promise<void>; discard(): number }>(session: S, which: "session" | "request"): S {
    const run = session.run.bind(session);
    session.run = () => {
      if (this.logins > 0 && !insideMintSession()) {
        session.discard(); // drop the refused steps, so they don't run on the next await
        return Promise.reject(
          new Error(`${which} steps were started while logInAs(…) was in progress — await logInAs first.`),
        );
      }
      const chain = run();
      this.running.set(chain, which);
      const done = () => void this.running.delete(chain);
      chain.then(done, done);
      return chain;
    };
    return session;
  }

  /** Phase 1, may fail: e.g. add the cookies to a live browser context. */
  prepare: ((cookies: SessionCookie[]) => Promise<void>)[] = [];
  /** Phase 2, after every prepare succeeded: must not fail (e.g. put the cookies in the request's jar). */
  commit: ((cookies: SessionCookie[]) => void | Promise<void>)[] = [];

  /**
   * Two-phase: if any prepare step fails, the login is refused and nothing
   * else changes (auth, api, request keep the previous user).
   */
  async logIn(cookies: SessionCookie[]): Promise<void> {
    for (const prepare of this.prepare) await prepare(cookies);
    const replaced = new Set(cookies.map(cookieKey));
    this.cookies = [...this.cookies.filter((c) => !replaced.has(cookieKey(c))), ...cookies];
    for (const commit of this.commit) await commit(cookies);
  }
}

/** The origin in-process clients address the app on: the request adapter's default baseUrl. */
const APP_ORIGIN = "http://localhost";

/**
 * The domain a cookie lands on, as core's request jar resolves it: no
 * domain means the app's host; case and a leading dot don't matter. Two
 * cookies with the same name, path and effective domain are the same
 * cookie, so a later login replaces an earlier one.
 */
function effectiveDomain(cookie: SessionCookie, appHost = new URL(APP_ORIGIN).hostname): string {
  return (cookie.domain ?? appHost).replace(/^\./, "").toLowerCase();
}

/** A cookie's identity: name, effective domain, path. */
function cookieKey(cookie: SessionCookie): string {
  return `${cookie.name}\u0000${effectiveDomain(cookie)}\u0000${cookie.path ?? "/"}`;
}


/**
 * An Eden Treaty client that calls app.handle in-process on APP_ORIGIN,
 * adding the cookies that match each request's URL (a cookie header the
 * call sets itself wins).
 */
function apiClient<App extends AnyElysia>(app: App, cookies: () => readonly SessionCookie[]): Treaty.Create<App> {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.headers.has("cookie")) {
      const header = cookieHeaderFor(cookies(), new URL(request.url));
      if (header) request.headers.set("cookie", header);
    }
    return app.handle(request);
  }) as typeof fetch;
  return treaty<App>(APP_ORIGIN, { fetcher });
}

/**
 * A session created on its first DSL call (visit, fillIn, ...): the request
 * logInAs returns, so core's request adapter (and happy-dom) load only
 * when it is used. Other reads (then, Symbol.toStringTag, inspection) see
 * the prototype and create nothing; in particular the proxy is not a
 * thenable until created.
 */
function lazySession<T extends object>(proto: object, make: () => T, created: () => T | undefined): T {
  return new Proxy(Object.create(proto) as T, {
    get(target, key) {
      const existing = created();
      if (existing) {
        const value = Reflect.get(existing, key, existing);
        return typeof value === "function" ? value.bind(existing) : value;
      }
      const method = typeof key === "string" && key !== "then" && key !== "constructor" ? Reflect.get(proto, key) : undefined;
      if (typeof method !== "function") return key === "then" ? undefined : Reflect.get(target, key);
      return (...args: unknown[]) => {
        const real = make();
        return (Reflect.get(real, key, real) as (...a: unknown[]) => unknown).apply(real, args);
      };
    },
    has(_target, key) {
      const existing = created();
      return existing ? key in existing : key in proto;
    },
  });
}

/** Core's cookie rule for Playwright: without a domain, set for baseUrl's host by domain + path. */
/**
 * A negative `expires` (-1 in Playwright's cookies) means a session cookie.
 * Leave it out before handing cookies to Playwright, which accepts no
 * negative but -1. (Core's request jar reads any negative as a session cookie.)
 */
function asSessionCookies(cookies: readonly SessionCookie[]): SessionCookie[] {
  return cookies.map(({ expires, ...rest }) => (expires !== undefined && expires >= 0 ? { ...rest, expires } : rest));
}

function forPlaywright(cookies: SessionCookie[], baseUrl: string) {
  const origin = new URL(baseUrl);
  return asSessionCookies(cookies).map(({ domain, path, ...rest }) => {
    if (domain !== undefined) return { ...rest, domain, path: path ?? "/" };
    // domain + path, not url: a url makes Playwright take `secure` from its
    // scheme, overriding the cookie's own (as core's addCookies does).
    return { ...rest, domain: origin.hostname, path: path ?? "/" };
  });
}

/** 9999-12-31T23:59:59Z in seconds: a later `expires` is not seconds since the epoch. */
const MAX_EXPIRES_SECONDS = 253_402_300_799;

/**
 * Refuse a cookie no client would take, before anything changes, so a bad
 * mintSession result never half-applies a login.
 */
function validateCookie(cookie: SessionCookie): void {
  const bad = (problem: string) =>
    new Error(`logInAs: mintSession's cookie '${cookie.name}' ${problem}`);
  if (cookie.name === "" || /[\s;=,\x00-\x1f\x7f]/.test(cookie.name)) {
    throw bad("has an invalid name: it must be non-empty, without spaces, ';', '=' or ','.");
  }
  if (/[;\x00-\x1f\x7f]/.test(cookie.value)) {
    throw bad("has an invalid value: it must not contain ';' or control characters.");
  }
  if (cookie.expires !== undefined) {
    if (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)) {
      throw bad(`has expires ${String(cookie.expires)}: give seconds since the epoch, -1 (or none) for a session cookie.`);
    }
    if (cookie.expires > MAX_EXPIRES_SECONDS) {
      throw bad(
        `has expires ${cookie.expires}, which looks like milliseconds: expires is in seconds since the epoch, ` +
          "e.g. Math.floor(date.getTime() / 1000).",
      );
    }
  }
  if (cookie.domain !== undefined && (typeof cookie.domain !== "string" || cookie.domain.replace(/^\./, "") === "")) {
    throw bad("has an empty domain: leave domain out for a host-only cookie.");
  }
  if (cookie.path !== undefined && (typeof cookie.path !== "string" || !cookie.path.startsWith("/"))) {
    throw bad(`has path ${JSON.stringify(cookie.path)}: a path starts with '/'.`);
  }
  if (cookie.sameSite !== undefined && !["Strict", "Lax", "None"].includes(cookie.sameSite)) {
    throw bad(`has sameSite ${JSON.stringify(cookie.sameSite)}: use "Strict", "Lax" or "None".`);
  }
}

function toCookies(minted: unknown): SessionCookie[] {
  const cookies = Array.isArray(minted) ? minted : [minted];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw new Error(
        `logInAs: mintSession must return { name, value, ... } or an array of them; got ${JSON.stringify(minted)}.`,
      );
    }
    validateCookie(cookie as SessionCookie);
  }
  // The same cookie twice (same name, path and effective domain): the
  // last one wins, as it would in a browser's jar.
  const last = new Map<string, SessionCookie>();
  for (const cookie of cookies as SessionCookie[]) {
    const key = cookieKey(cookie);
    last.delete(key);
    last.set(key, { ...cookie });
  }
  return [...last.values()];
}

/** feather-testing-postgres's fixtures (an optional peer, loaded only when a db is configured). */
function postgresFixtures<Db>(db: DbOptions | FeatherDbLike<Db>): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  let mod: { postgresFixtures(options: unknown): Record<string, unknown> };
  try {
    mod = require("feather-testing-postgres/fixtures");
  } catch (error) {
    throw new Error(
      "featherTest: the db option needs feather-testing-postgres (npm install -D feather-testing-postgres).",
      { cause: error },
    );
  }
  // Already in core's [async (deps, use) => …, { scope, deps }] shape.
  return mod.postgresFixtures(db);
}

/** Core's request adapter, loaded synchronously on first use (it needs happy-dom). */
function loadRequestAdapter(): typeof import("feather-testing-core/request") {
  return createRequire(import.meta.url)("feather-testing-core/request");
}

/**
 * Marks the async context of a mintSession call with a per-call token,
 * active only until that call settles: tasks it leaves behind (a timer, an
 * unawaited promise) keep the token but not the exemptions.
 */
interface MintToken {
  active: boolean;
  /** The mintSession call's promise, when it returned one. */
  pending?: Promise<unknown>;
}
const minting = new AsyncLocalStorage<MintToken>();

/**
 * Inside a mintSession call that has not settled yet. A microtask the mint
 * queued on its way out runs before any await after the call can switch
 * the token off, so with a promise, ask whether it has already settled
 * (Bun.peek.status; elsewhere the finally after the await is the fallback).
 */
function insideMintSession(): boolean {
  const token = minting.getStore();
  if (!token?.active) return false;
  const peek = (globalThis as { Bun?: { peek: { status(p: Promise<unknown>): string } } }).Bun?.peek;
  if (token.pending && peek) return peek.status(token.pending) === "pending";
  return true;
}

/** createApp's result, checked: an Elysia app (something with handle()), not a Promise. */
function checkedApp<App>(app: App): App {
  const isApp = typeof (app as { handle?: unknown } | null)?.handle === "function";
  if (isApp) return app;
  const got =
    app instanceof Promise || typeof (app as { then?: unknown } | null)?.then === "function"
      ? "a Promise — make it synchronous; async plugins are awaited for you"
      : app === null || typeof app !== "object"
        ? String(app === null ? "null" : typeof app === "undefined" ? "undefined" : typeof app)
        : "an object without handle()";
  throw new Error(`featherTest: createApp must return an Elysia app synchronously (got ${got})`);
}

/** bun:test's { test, afterAll }, loaded only when no runner is given. */
function bunRunner(): Runner {
  const require = createRequire(import.meta.url);
  const { test, afterAll } = require("bun:test") as typeof import("bun:test");
  return { test, afterAll };
}

export function featherTest<App extends AnyElysia, Db = never, User = unknown>(
  options: FeatherTestOptions<App, Db, User>,
): FeatherTestFn<FeatherFixtures<App, Db, User>> {
  const runner = options.runner ?? bunRunner();
  type LogInDeps = { app: App; mintSession: MintSession<User, Db, App> | undefined; auth: AuthState };
  type UseLogInAs = (logInAs: (user: User) => Promise<SignedIn<App>>) => Promise<void>;
  const logInAs =
    ({ app, mintSession, auth, db }: LogInDeps & { db: Db }) =>
    async (user: User): Promise<SignedIn<App>> => {
      if (!mintSession) {
        throw new Error(
          "logInAs needs a mintSession: featherTest({ createApp, mintSession: ({ db, user }) => ({ name, value }) }), " +
            "or test.with({ mintSession }).",
        );
      }
      if (insideMintSession()) {
        throw new Error(
          "logInAs was called from inside mintSession — mint the session directly instead " +
            "(insert the session row and return its cookie); logInAs would wait for itself.",
        );
      }
      // One login at a time, in the order they were called, so overlapping
      // logins can't interleave their browser steps: the last one started
      // wins everywhere. A failed login releases the lock.
      // Await your steps before logInAs, and await logInAs before your next
      // steps: a running chain refuses the login (before anything is minted),
      // and a chain started until this login settles refuses itself.
      auth.refuseWhileRunning();
      auth.beginLogin();
      return auth.serialize(async () => {
      // Everything that can fail happens before the login state changes.
      const token: MintToken = { active: true };
      let minted: SessionCookie | SessionCookie[];
      let result: ReturnType<typeof mintSession>;
      try {
        result = minting.run(token, () => mintSession({ db, user, app })); // not awaited yet
      } catch (error) {
        token.active = false; // threw synchronously
        throw error;
      }
      if (result instanceof Promise || typeof (result as { then?: unknown })?.then === "function") {
        if (result instanceof Promise) token.pending = result;
        try {
          minted = await result;
        } finally {
          token.active = false;
        }
      } else {
        token.active = false; // a plain value: the mint is over, before any await
        minted = result as SessionCookie | SessionCookie[];
      }
      const cookies = toCookies(minted);
      let request: RequestSession | undefined;
      const signedIn: SignedIn<App> = {
        cookies,
        // Created on its first DSL call: core's request adapter needs
        // happy-dom, which a browser- or API-only project may not have.
        request: lazySession(
          Session.prototype,
          () => (request ??= loadRequestAdapter().createSession((r) => app.handle(r), { cookies })),
          () => request,
        ),
        api: apiClient(app, () => cookies),
      };
      await auth.logIn(cookies);
      return signedIn;
      }).finally(() => auth.endLogin());
    };
  const dbFixtures = options.db === undefined ? {} : postgresFixtures(options.db);
  const fixtures = {
    ...dbFixtures,
    createApp: [options.createApp, { value: true }],
    app:
      options.db === undefined
        ? async ({ createApp }: { createApp: (deps: object) => App }, use: (app: App) => Promise<void>) => {
            const app = checkedApp(createApp({}));
            await app.modules; // async plugins (.use(import(...)), .use(promise)) finish loading first
            await use(app);
          }
        : async ({ createApp, db }: { createApp: (deps: { db: Db }) => App; db: Db }, use: (app: App) => Promise<void>) => {
            const app = checkedApp(createApp({ db }));
            await app.modules; // async plugins finish loading first
            await use(app);
          },
    handler: async ({ app }: { app: App }, use: (handler: RequestHandler) => Promise<void>) => {
      await use((request) => app.handle(request));
    },
    mintSession: [options.mintSession, { value: true }],
    auth: async ({}, use: (auth: AuthState) => Promise<void>) => {
      await use(new AuthState());
    },
    logInAs: options.db === undefined
      ? async ({ app, mintSession, auth }: LogInDeps, use: UseLogInAs) => {
          await use(logInAs({ app, mintSession, auth, db: undefined as Db }));
        }
      : async ({ app, mintSession, auth, db }: LogInDeps & { db: Db }, use: UseLogInAs) => {
          await use(logInAs({ app, mintSession, auth, db }));
        },
    // baseUrl before page: fixtures are torn down in reverse order of setup,
    // so the browser context closes (dropping its connections) before the
    // server stops.
    session: async (
      { baseUrl, page, auth }: { baseUrl: string; page: CoreFixtures["page"]; auth: AuthState },
      use: (session: PlaywrightSession) => Promise<void>,
    ) => {
      const { createSession } = await import("feather-testing-core/playwright");
      // Each login goes straight into the browser context when logInAs runs,
      // so the latest login always wins, even over steps already queued.
      // (Not core's cookies option: it is read when the first step runs,
      // and would re-seed an earlier user's cookies over a later login.)
      const host = new URL(baseUrl).hostname;
      const toContext = async (cookies: SessionCookie[]) => {
        const context = page.context();
        type Stored = Awaited<ReturnType<typeof context.cookies>>[number];
        const same = (a: Stored, b: Stored) =>
          a.name === b.name && a.domain === b.domain && a.path === b.path && a.partitionKey === b.partitionKey;
        /** Re-add whichever of `wanted` the context no longer holds. */
        const keep = async (wanted: Stored[]) => {
          const now = await context.cookies();
          const lost = wanted.filter((c) => !now.some((r) => same(r, c)));
          if (lost.length > 0) await context.addCookies(lost);
        };
        // Which stored cookies this login replaces, decided before the add
        // and by identity, whatever their value: unpartitioned, same name,
        // path and effective domain (a host-only and a Domain cookie are two
        // cookies to the browser, and the browser may store a domain
        // differently from how it was given, e.g. .localhost as localhost,
        // so where a new cookie lands can't be read back reliably). A
        // partitioned cookie is another cookie, never replaced here.
        const touches = (stored: Stored) =>
          !stored.partitionKey &&
          cookies.some(
            (c) =>
              c.name === stored.name &&
              (c.path ?? "/") === stored.path &&
              effectiveDomain(c, host) === stored.domain.replace(/^\./, "").toLowerCase(),
          );
        const before = await context.cookies();
        const replaced = before.filter(touches);
        for (const stored of replaced) {
          await context.clearCookies({ name: stored.name, domain: stored.domain, path: stored.path });
        }
        // clearCookies can't filter by partition: put back what it took
        // that was not meant to go (a partitioned twin).
        await keep(before.filter((c) => !replaced.includes(c)));
        try {
          await context.addCookies(forPlaywright(cookies, baseUrl));
        } catch (error) {
          // The browser refused a cookie: put the previous login back, so a
          // failed login leaves the context as it was. The add may have
          // installed some cookies before failing (Chromium's batches have
          // been all-or-nothing, but nothing promises it), so first clear
          // every cookie with one of this login's identities, then restore
          // the snapshot.
          await (async () => {
            for (const stored of (await context.cookies()).filter(touches)) {
              await context.clearCookies({ name: stored.name, domain: stored.domain, path: stored.path });
            }
            await keep(before);
          })().catch(() => undefined);
          throw error;
        }
      };
      if (auth.cookies.length > 0) await toContext(auth.cookies);
      auth.prepare.push(toContext);
      await use(auth.track(createSession(page, { baseUrl }), "session"));
    },
    request: async (
      { handler, auth }: { handler: RequestHandler; auth: AuthState },
      use: (request: RequestSession) => Promise<void>,
    ) => {
      const { createSession } = await import("feather-testing-core/request");
      const request = auth.track(createSession(handler, { cookies: [...auth.cookies] }), "request");
      // Each login goes into the jar at once (setCookies is outside the
      // step queue), so the request switches at the same moment as the
      // browser, even under steps already queued.
      auth.commit.push((cookies) => request.setCookies(cookies));
      await use(request);
    },
    api: async ({ app, auth }: { app: App; auth: AuthState }, use: (api: Treaty.Create<App>) => Promise<void>) => {
      await use(apiClient(app, () => auth.cookies));
    },
    baseUrl: async ({ app }: { app: App }, use: (url: string) => Promise<void>) => {
      try {
        // Inside the try: Elysia sets app.server before running onStart
        // hooks, so a throwing hook still leaves a server to stop.
        app.listen(0);
        await use(`http://localhost:${app.server!.port}`);
      } finally {
        // Force-close open connections (an SSE stream, a WebSocket): a
        // graceful stop would wait for them, and the db cleanup after it.
        if (app.server) await app.stop(true);
      }
    },
  };
  const test = defineCoreTest(runner).extend(
    fixtures as unknown as FixtureDefs<ElysiaFixtures<App, Db, User>, CoreFixtures & ElysiaFixtures<App, Db, User>>,
  ) as unknown as TestFn<FeatherFixtures<App, Db, User>>;
  return withFunctionOptions(test);
}
