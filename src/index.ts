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

export interface FeatherTestOptions<App extends AnyElysia, Db> {
  /** Builds a fresh app per test. Called as createApp({ db }) — or createApp({}) without a db. */
  createApp: (deps: { db: Db }) => App;
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
}

export type FeatherFixtures<App extends AnyElysia, Db> = Omit<CoreFixtures, "handler"> &
  ElysiaFixtures<App, Db>;

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
  const fixtures = {
    createApp: [options.createApp, { value: true }],
    app: async ({ createApp }: { createApp: (deps: object) => App }, use: (app: App) => Promise<void>) => {
      await use(createApp({}));
    },
    handler: async ({ app }: { app: App }, use: (handler: RequestHandler) => Promise<void>) => {
      await use((request) => app.handle(request));
    },
  };
  return defineCoreTest(runner).extend(
    fixtures as unknown as FixtureDefs<ElysiaFixtures<App, Db>, CoreFixtures & ElysiaFixtures<App, Db>>,
  ) as unknown as TestFn<FeatherFixtures<App, Db>>;
}
