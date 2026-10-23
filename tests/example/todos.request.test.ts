// The same app without a browser: the request adapter and Eden, in-process.
import { expect } from "bun:test";
import { test, todos, users } from "./fixtures.ts";

test("a signed-in user sees their todos", async ({ db, logInAs, request }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });

  await logInAs(alice);

  await request.visit("/").assertText("Alice's todos").assertHas("li", { text: "Buy milk" });
});

test("the JSON API answers for the signed-in user", async ({ db, logInAs, api }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });

  await logInAs(alice);

  const { data } = await api.todos.get();
  expect(data).toEqual([{ id: expect.any(Number), title: "Buy milk", completed: false }]);
});

test("signed out, the API refuses", async ({ api }) => {
  const { status } = await api.todos.get();
  expect(status).toBe(401);
});

test("logging in through the form", async ({ db, request }) => {
  await users.insert(db, { email: "alice@example.com", name: "Alice", passwordHash: await Bun.password.hash("s3cret") });

  await request
    .visit("/")
    .assertPath("/login")
    .fillIn("Email", "alice@example.com")
    .fillIn("Password", "s3cret")
    .clickButton("Log in")
    .assertPath("/")
    .assertText("Alice's todos");
});

test("a wrong password is refused", async ({ db, request }) => {
  await users.insert(db, { email: "alice@example.com", passwordHash: await Bun.password.hash("s3cret") });

  await request
    .visit("/login")
    .fillIn("Email", "alice@example.com")
    .fillIn("Password", "nope")
    .clickButton("Log in")
    .assertText("Wrong email or password");
});
