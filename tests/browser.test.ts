// baseUrl and the Playwright session, without a database.
import { expect } from "bun:test";
import { Elysia } from "elysia";
import { featherTest } from "../src/index.ts";

const html = (body: string) =>
  new Response(`<!doctype html><title>t</title>${body}`, { headers: { "content-type": "text/html; charset=utf-8" } });

const createApp = () =>
  new Elysia()
    .get("/", () => html(`<h1>Hello</h1><form method="post" action="/echo"><label>Name <input name="name"></label><button>Send</button></form>`))
    .post("/echo", ({ body }) => html(`<p>Hi ${(body as { name: string }).name}</p>`));

const test = featherTest({ createApp });

let lastBaseUrl = "";

test("baseUrl is the app listening on a free port", async ({ baseUrl, app }) => {
  expect(baseUrl).toBe(`http://localhost:${app.server!.port}`);
  expect(await (await fetch(`${baseUrl}/`)).text()).toContain("Hello");
  lastBaseUrl = baseUrl;
});

test("the app is stopped after the test", async ({}) => {
  expect(lastBaseUrl).not.toBe("");
  await expect(fetch(`${lastBaseUrl}/`)).rejects.toThrow();
});

test("session drives a real browser against baseUrl", async ({ session }) => {
  await session.visit("/").assertText("Hello").fillIn("Name", "Ada").clickButton("Send").assertText("Hi Ada");
});
