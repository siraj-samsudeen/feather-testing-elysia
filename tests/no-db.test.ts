// featherTest without a database: app, handler, request, overrides.
import { afterAll, expect, test as bunTest } from "bun:test";
import { Elysia } from "elysia";
import { value } from "feather-testing-core/fixtures";
import { featherTest } from "../src/index.ts";

const created: { deps: unknown }[] = [];

function createApp(deps: object) {
  created.push({ deps });
  return new Elysia()
    .get("/", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return `<h1>Hello</h1><a href="/about">About</a>`;
    })
    .get("/about", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return "<h1>About us</h1>";
    })
    .get("/json", () => ({ ok: true }));
}

const test = featherTest({ createApp });

test("app is createApp({}) when no db is configured", async ({ app }) => {
  expect(created.at(-1)!.deps).toEqual({});
  expect(app.server).toBeNull();
});

test("handler is the app's request handler", async ({ handler }) => {
  const response = await handler(new Request("http://localhost/json"));
  expect(await response.json()).toEqual({ ok: true });
});

test("request drives the app in-process and never opens a port", async ({ request, app }) => {
  await request.visit("/").assertText("Hello").clickLink("About").assertText("About us").assertPath("/about");
  expect(app.server).toBeNull();
});

let previous: unknown;
test("each test gets a fresh app (1/2)", async ({ app }) => {
  previous = app;
});
test("each test gets a fresh app (2/2)", async ({ app }) => {
  expect(previous).toBeDefined();
  expect(app).not.toBe(previous);
});

test.with({
  createApp: () =>
    new Elysia().get("/", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return "<h1>Overridden</h1>";
    }) as unknown as ReturnType<typeof createApp>, // a different app on purpose
})("test.with({ createApp }) swaps the app", async ({ request }) => {
  await request.visit("/").assertText("Overridden");
});

const overridden = () =>
  new Elysia().get("/", ({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return "<h1>Overridden</h1>";
  }) as unknown as ReturnType<typeof createApp>;

test.extend({ extra: "x" }).with({ createApp: overridden })(
  "after .extend(), .with({ createApp }) still takes a plain function",
  async ({ request, extra }) => {
    expect(extra).toBe("x");
    await request.visit("/").assertText("Overridden");
  },
);

test.with({ createApp: value(overridden) })("an explicit value(createApp) works too", async ({ request }) => {
  await request.visit("/").assertText("Overridden");
});

// A runner whose tests pass only if the test's setup fails with `message`.
const expectingSetupError = (message: RegExp) => ({
  test: (name: string, fn: () => Promise<void>) => bunTest(name, () => expect(fn()).rejects.toThrow(message)),
  afterAll,
});

const withBadCreateApp = (returned: unknown, message: RegExp) =>
  featherTest({ createApp: (() => returned) as unknown as typeof createApp, runner: expectingSetupError(message) });

withBadCreateApp(Promise.resolve(new Elysia()), /createApp must return an Elysia app synchronously \(got a Promise — make it synchronous; async plugins are awaited for you\)/)(
  "an async createApp is refused with advice",
  async ({ app }) => {
    expect(app).toBeUndefined(); // never reached
  },
);
withBadCreateApp(undefined, /createApp must return an Elysia app synchronously \(got undefined\)/)(
  "createApp returning nothing is refused",
  async ({ app }) => {
    expect(app).toBeUndefined();
  },
);
withBadCreateApp({ get: () => 1 }, /createApp must return an Elysia app synchronously \(got an object without handle\(\)\)/)(
  "createApp returning something else is refused",
  async ({ app }) => {
    expect(app).toBeUndefined();
  },
);

const noDbOption = featherTest({
  createApp,
  runner: expectingSetupError(/featherTest: `(db|sql|testDb|dbEngine)` needs the db option: featherTest\(\{ createApp, db: \{ migrations: '…' \} \}\)/),
});
noDbOption("db without the db option says what to configure", async ({ db }) => {
  expect(db).toBeUndefined(); // never reached
});
noDbOption("sql without the db option says what to configure", async ({ sql }) => {
  expect(sql).toBeUndefined();
});
noDbOption("testDb without the db option says what to configure", async ({ testDb }) => {
  expect(testDb).toBeUndefined();
});
noDbOption("dbEngine without the db option says what to configure", async ({ dbEngine }) => {
  expect(dbEngine).toBeUndefined();
});
