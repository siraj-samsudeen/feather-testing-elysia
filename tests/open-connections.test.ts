// A page holding a connection open (an SSE stream) must not hang teardown:
// the browser context closes before the server stops, the server is
// force-stopped, and the db fixture's rollback still runs.
import { afterAll, expect, test as bunTest } from "bun:test";
import { featherTest } from "../src/index.ts";
import { createApp } from "./example/app.ts";
import * as schema from "./example/schema.ts";

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

const test = featherTest({
  createApp: (deps: Parameters<typeof createApp>[0]) =>
    createApp(deps)
      .get("/live", () =>
        html(`<!doctype html><title>live</title><p id="state">connecting</p>
<script>
  const events = new EventSource("/events");
  events.onmessage = () => { document.getElementById("state").textContent = "streaming"; };
</script>`),
      )
      .get("/events", () => {
        let timer: ReturnType<typeof setInterval>;
        const stream = new ReadableStream({
          start(controller) {
            const tick = () => controller.enqueue(new TextEncoder().encode("data: tick\n\n"));
            tick();
            timer = setInterval(tick, 200); // never closes on its own
          },
          cancel() {
            clearInterval(timer);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }),
  db: { migrations: "./tests/example/drizzle", schema },
  // A short budget, so a hanging teardown fails fast instead of at core's 30 s.
  runner: { test: (name, fn) => bunTest(name, fn, 8000), afterAll },
});

let bodyEndedAt = 0;

test("a page streaming server-sent events", async ({ db, session }) => {
  await db.insert(schema.users).values({ email: "sse@example.com", name: "Streamer", passwordHash: "x" });
  await session.visit("/live").assertText("streaming");
  bodyEndedAt = Date.now();
});

test("tore down promptly, and the db rolled back", async ({ db }) => {
  expect(bodyEndedAt).toBeGreaterThan(0);
  expect(Date.now() - bodyEndedAt).toBeLessThan(3000);
  expect(await db.select().from(schema.users)).toEqual([]);
});
