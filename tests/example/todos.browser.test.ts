// End to end in a real browser: insert rows, log in, drive the page.
import { test, todos, users } from "./fixtures.ts";

test("a signed-in user sees their todos", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  await todos.insert(db, { userId: alice.id, title: "Buy milk" });

  await logInAs(alice);

  await session.visit("/").assertText("Alice's todos").assertHas("li", { text: "Buy milk" });
});

test("someone else's todos stay hidden", async ({ db, logInAs, session }) => {
  const alice = await users.insert(db, { name: "Alice" });
  const bob = await users.insert(db, { name: "Bob" });
  await todos.insert(db, { userId: bob.id, title: "Bob's secret" });

  await logInAs(alice);

  await session.visit("/").assertText("Alice's todos").refuteText("Bob's secret");
});

test("logging in through the form", async ({ db, session }) => {
  await users.insert(db, { email: "alice@example.com", name: "Alice", passwordHash: await Bun.password.hash("s3cret") });

  await session
    .visit("/")
    .assertPath("/login")
    .fillIn("Email", "alice@example.com")
    .fillIn("Password", "s3cret")
    .clickButton("Log in")
    .assertPath("/")
    .assertText("Alice's todos");
});
