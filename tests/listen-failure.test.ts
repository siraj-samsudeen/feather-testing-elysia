// A baseUrl whose app fails to start (a throwing onStart hook) must not
// leave its server listening.
import { afterAll, expect, test as bunTest } from "bun:test";
import { Elysia } from "elysia";
import { featherTest } from "../src/index.ts";

let port: number | undefined;
let server: unknown;

const createApp = () =>
  new Elysia().get("/", () => "up").onStart(({ server: started }) => {
    server = started;
    port = started?.port;
    throw new Error("onStart failed");
  });

// The fixture's setup fails, so this test is expected to fail.
const failing = featherTest({ createApp, runner: { test: bunTest.failing, afterAll } });

failing("baseUrl setup fails when onStart throws", async ({ baseUrl }) => {
  expect(baseUrl).toBeUndefined(); // never reached
});

bunTest("its port has been released", async () => {
  expect(port).toBeNumber();
  await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  const again = Bun.serve({ port, fetch: () => new Response("mine") });
  expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe("mine");
  again.stop(true);
  expect(server).toBeDefined();
});
