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
import { createRequire } from "node:module";
import { treaty, type Treaty } from "@elysiajs/eden";
import type { AnyElysia } from "elysia";
import { Session, type SessionCookie } from "feather-testing-core";
import {
  defineCoreTest,
  type CoreFixtures,
  type FixtureDefs,
  type Runner,
  type TestFn,
} from "feather-testing-core/fixtures";

export type { Runner, TestFn } from "feather-testing-core/fixtures";
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
   * the test's own session, request and api use them from then on (the
   * browser at once; request from its next step). Returns that user's cookies
   * and request / api clients of their own, for tests with several users.
   */
  logInAs: (user: User) => Promise<SignedIn<App>>;
  /** The cookies of the latest logInAs, which session, request and api start with. */
  auth: { readonly cookies: readonly SessionCookie[] };
  /** A Playwright session on the app's baseUrl, signed in by logInAs. */
  session: PlaywrightSession;
  /** A request-adapter session on the app's handler (no browser), signed in by logInAs from its next step. */
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
  /** Run before they change, e.g. to add them to a live browser context. */
  appliers: ((cookies: SessionCookie[]) => Promise<void>)[] = [];

  /** The cookies change only once every applier has accepted them. */
  async logIn(cookies: SessionCookie[]): Promise<void> {
    for (const apply of this.appliers) await apply(cookies);
    const key = (c: SessionCookie) => `${c.name}\u0000${effectiveDomain(c)}\u0000${c.path ?? "/"}`;
    const replaced = new Set(cookies.map(key));
    this.cookies = [...this.cookies.filter((c) => !replaced.has(key(c))), ...cookies];
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

/**
 * The Cookie header a browser would send to `url`: the rules of core's
 * request-adapter jar (no domain: host-only for the app's host; Domain also
 * covers subdomains; Path; Secure only over https or to localhost; none or
 * negative expires: a session cookie; longer paths first).
 *
 * Core exports the same function as cookieHeaderFor from
 * feather-testing-core/request, but that entry loads happy-dom, which api
 * and logInAs must not need; switch to it once core exports it from an
 * entry without happy-dom.
 */
function cookieHeaderFor(cookies: readonly SessionCookie[], url: URL, appHost = new URL(APP_ORIGIN).hostname): string | null {
  const host = url.hostname.toLowerCase();
  const now = Date.now();
  const secureContext = url.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
  const pathMatches = (path: string) =>
    url.pathname === path || (url.pathname.startsWith(path) && (path.endsWith("/") || url.pathname[path.length] === "/"));
  const matching = cookies
    .filter((c) => {
      // A negative expires is a session cookie (Playwright's -1).
      if (c.expires !== undefined && c.expires >= 0 && c.expires * 1000 <= now) return false;
      if (c.secure && !secureContext) return false;
      if (c.domain === undefined) {
        if (host !== appHost.toLowerCase()) return false;
      } else {
        const domain = c.domain.replace(/^\./, "").toLowerCase();
        if (host !== domain && !host.endsWith(`.${domain}`)) return false;
      }
      return pathMatches(c.path ?? "/");
    })
    .sort((a, b) => (b.path ?? "/").length - (a.path ?? "/").length);
  return matching.length === 0 ? null : matching.map((c) => `${c.name}=${c.value}`).join("; ");
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

function toCookies(minted: unknown): SessionCookie[] {
  const cookies = Array.isArray(minted) ? minted : [minted];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw new Error(
        `logInAs: mintSession must return { name, value, ... } or an array of them; got ${JSON.stringify(minted)}.`,
      );
    }
  }
  return cookies.map((cookie) => ({ ...cookie }));
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

/** bun:test's { test, afterAll }, loaded only when no runner is given. */
function bunRunner(): Runner {
  const require = createRequire(import.meta.url);
  const { test, afterAll } = require("bun:test") as typeof import("bun:test");
  return { test, afterAll };
}

export function featherTest<App extends AnyElysia, Db = never, User = unknown>(
  options: FeatherTestOptions<App, Db, User>,
): TestFn<FeatherFixtures<App, Db, User>> {
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
      // Everything that can fail happens before the login state changes.
      const cookies = toCookies(await mintSession({ db, user, app }));
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
    };
  const dbFixtures = options.db === undefined ? {} : postgresFixtures(options.db);
  const fixtures = {
    ...dbFixtures,
    createApp: [options.createApp, { value: true }],
    app:
      options.db === undefined
        ? async ({ createApp }: { createApp: (deps: object) => App }, use: (app: App) => Promise<void>) => {
            const app = createApp({});
            await app.modules; // async plugins (.use(import(...)), .use(promise)) finish loading first
            await use(app);
          }
        : async ({ createApp, db }: { createApp: (deps: { db: Db }) => App; db: Db }, use: (app: App) => Promise<void>) => {
            const app = createApp({ db });
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
    session: async (
      { page, baseUrl, auth }: { page: CoreFixtures["page"]; baseUrl: string; auth: AuthState },
      use: (session: PlaywrightSession) => Promise<void>,
    ) => {
      const { createSession } = await import("feather-testing-core/playwright");
      // Each login goes straight into the browser context when logInAs runs,
      // so the latest login always wins, even over steps already queued.
      // (Not core's cookies option: it is read when the first step runs,
      // and would re-seed an earlier user's cookies over a later login.)
      const host = new URL(baseUrl).hostname;
      const toContext = async (cookies: SessionCookie[]) => {
        // A host-only and a Domain cookie are two cookies to the browser;
        // drop the earlier login's one that this login replaces.
        const context = page.context();
        for (const old of await context.cookies()) {
          const replaced = cookies.some(
            (c) =>
              c.name === old.name &&
              (c.path ?? "/") === old.path &&
              effectiveDomain(c, host) === old.domain.replace(/^\./, "").toLowerCase(),
          );
          if (replaced) await context.clearCookies({ name: old.name, domain: old.domain, path: old.path });
        }
        await context.addCookies(forPlaywright(cookies, baseUrl));
      };
      if (auth.cookies.length > 0) await toContext(auth.cookies);
      auth.appliers.push(toContext);
      await use(createSession(page, { baseUrl }));
    },
    request: async (
      { handler, auth }: { handler: RequestHandler; auth: AuthState },
      use: (request: RequestSession) => Promise<void>,
    ) => {
      const { createSession } = await import("feather-testing-core/request");
      const request = createSession(handler, { cookies: [...auth.cookies] });
      // Each login is queued as a step: it applies from the session's next
      // step on (steps already queued and not yet awaited run before it).
      auth.appliers.push(async (cookies) => {
        request.addCookies(cookies);
      });
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
        if (app.server) await app.stop();
      }
    },
  };
  return defineCoreTest(runner).extend(
    fixtures as unknown as FixtureDefs<ElysiaFixtures<App, Db, User>, CoreFixtures & ElysiaFixtures<App, Db, User>>,
  ) as unknown as TestFn<FeatherFixtures<App, Db, User>>;
}
