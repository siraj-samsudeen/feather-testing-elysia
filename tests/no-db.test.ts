// featherTest without a database: app, handler, request, overrides.
import { expect } from "bun:test";
import { Elysia } from "elysia";
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
