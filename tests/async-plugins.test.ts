// The app fixture is handed out only once its async plugins have loaded.
import { expect } from "bun:test";
import { Elysia } from "elysia";
import { featherTest } from "../src/index.ts";
import { createApp as createExampleApp } from "./example/app.ts";
import * as schema from "./example/schema.ts";

const latePlugin = async () => {
  await Bun.sleep(30);
  return new Elysia().get("/late", () => new Response("<p>Loaded late</p>", { headers: { "content-type": "text/html" } }));
};

type Late = { late: { get(): Promise<{ status: number }> } };

const withoutDb = featherTest({ createApp: () => new Elysia().use(latePlugin()) });
const withDb = featherTest({
  createApp: ({ db }: Parameters<typeof createExampleApp>[0]) => createExampleApp({ db }).use(latePlugin()),
  db: { migrations: "./tests/example/drizzle", schema },
});

// The fixtures used here (api, request, handler, session) don't depend on the app's routes' types.
function suite(label: string, test: typeof withoutDb) {
  test(`a delayed plugin's route answers through api (${label})`, async ({ api }) => {
    expect((await (api as unknown as Late).late.get()).status).toBe(200);
  });
  test(`a delayed plugin's route answers through request (${label})`, async ({ request }) => {
    await request.visit("/late").assertText("Loaded late");
  });
  test(`a delayed plugin's route answers through handler (${label})`, async ({ handler }) => {
    expect((await handler(new Request("http://localhost/late"))).status).toBe(200);
  });
  test(`a delayed plugin's route answers through session (${label})`, async ({ session }) => {
    await session.visit("/late").assertText("Loaded late");
  });
}

suite("no db", withoutDb);
suite("with a db", withDb as unknown as typeof withoutDb);
