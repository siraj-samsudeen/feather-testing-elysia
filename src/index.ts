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
import type { AnyElysia } from "elysia";
import {
  defineCoreTest,
  type CoreFixtures,
  type FixtureDefs,
  type Runner,
  type TestFn,
} from "feather-testing-core/fixtures";

export type { Runner, TestFn } from "feather-testing-core/fixtures";

type RequestHandler = (request: Request) => Response | Promise<Response>;

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

/** feather-testing-postgres's fixture shape: { scope, deps, setup, teardown }. */
interface HookFixture {
  scope: "test" | "file";
  deps?: readonly string[];
  setup(deps: Record<string, unknown>): unknown;
  teardown?(value: unknown, deps: Record<string, unknown>): unknown;
}

/**
 * feather-testing-postgres's postgresFixtures() return { scope, deps, setup,
 * teardown } definitions; core's engine takes async (fixtures, use) => …
 * functions. This bridges the two.
 */
function fromHookFixtures(defs: Record<string, HookFixture>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(defs)) {
    out[name] = [
      async (deps: Record<string, unknown>, use: (value: unknown) => Promise<void>) => {
        const value = await def.setup(deps);
        try {
          await use(value);
        } finally {
          await def.teardown?.(value, deps);
        }
      },
      { scope: def.scope, deps: [...(def.deps ?? [])] },
    ];
  }
  return out;
}

export interface FeatherTestOptions<App extends AnyElysia, Db> {
  /** Builds a fresh app per test. Called as createApp({ db }) — or createApp({}) without a db. */
  createApp: (deps: { db: Db }) => App;
  /**
   * A real Postgres per test via feather-testing-postgres: createFeatherDb
   * options (engine from FEATHER_DB, strategy, migrations, schema, ...) or a
   * FeatherDb. Omit it for an app without a database.
   */
  db?: DbOptions | FeatherDbLike<Db>;
  /** The test runner's { test, afterAll }. Default: bun:test's. */
  runner?: Runner;
}

/** The fixtures featherTest adds to core's (browser, context, page, session, request, rtl). */
export interface ElysiaFixtures<App extends AnyElysia, Db> {
  /** Option: the app factory (override with test.with({ createApp })). */
  createApp: (deps: { db: Db }) => App;
  /** A fresh app for the test: createApp({ db }), or createApp({}) without a db. */
  app: App;
  /** The app's request handler (app.handle), for the request adapter. */
  handler: RequestHandler;
  /** The app listening on a free port (app.listen(0)), stopped after the test. Only started when asked for. */
  baseUrl: string;
  /** With a db configured: the Drizzle handle bound to this test's transaction, handed to createApp. */
  db: Db;
  /** With a db configured: raw SQL on the same transaction. */
  sql: SqlRunner;
  /** With a db configured: { db, sql, raw } for this test (ended after it). */
  testDb: TestDbLike<Db>;
  /** With a db configured: the started engine, shared by the file's tests. */
  dbEngine: FeatherDbLike<Db>;
}

export type FeatherFixtures<App extends AnyElysia, Db> = Omit<CoreFixtures, "handler" | "baseUrl"> &
  ElysiaFixtures<App, Db>;

/** feather-testing-postgres's fixtures (an optional peer, loaded only when a db is configured). */
function postgresFixtures<Db>(db: DbOptions | FeatherDbLike<Db>): Record<string, unknown> {
  const require = createRequire(import.meta.url);
  let mod: { postgresFixtures(options: unknown): Record<string, HookFixture> };
  try {
    mod = require("feather-testing-postgres/fixtures");
  } catch (error) {
    throw new Error(
      "featherTest: the db option needs feather-testing-postgres (npm install -D feather-testing-postgres).",
      { cause: error },
    );
  }
  return fromHookFixtures(mod.postgresFixtures(db));
}

/** bun:test's { test, afterAll }, loaded only when no runner is given. */
function bunRunner(): Runner {
  const require = createRequire(import.meta.url);
  const { test, afterAll } = require("bun:test") as typeof import("bun:test");
  return { test, afterAll };
}

export function featherTest<App extends AnyElysia, Db = never>(
  options: FeatherTestOptions<App, Db>,
): TestFn<FeatherFixtures<App, Db>> {
  const runner = options.runner ?? bunRunner();
  const dbFixtures = options.db === undefined ? {} : postgresFixtures(options.db);
  const fixtures = {
    ...dbFixtures,
    createApp: [options.createApp, { value: true }],
    app:
      options.db === undefined
        ? async ({ createApp }: { createApp: (deps: object) => App }, use: (app: App) => Promise<void>) => {
            await use(createApp({}));
          }
        : async ({ createApp, db }: { createApp: (deps: { db: Db }) => App; db: Db }, use: (app: App) => Promise<void>) => {
            await use(createApp({ db }));
          },
    handler: async ({ app }: { app: App }, use: (handler: RequestHandler) => Promise<void>) => {
      await use((request) => app.handle(request));
    },
    baseUrl: async ({ app }: { app: App }, use: (url: string) => Promise<void>) => {
      app.listen(0);
      try {
        await use(`http://localhost:${app.server!.port}`);
      } finally {
        await app.stop();
      }
    },
  };
  return defineCoreTest(runner).extend(
    fixtures as unknown as FixtureDefs<ElysiaFixtures<App, Db>, CoreFixtures & ElysiaFixtures<App, Db>>,
  ) as unknown as TestFn<FeatherFixtures<App, Db>>;
}
