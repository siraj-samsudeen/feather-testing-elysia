// A tiny Elysia app for the tests: log in with email + password, then see
// your own todos. The database is injected: createApp({ db }).
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, startSession, userForToken, type AppDb } from "./auth.ts";
import { todos, users } from "./schema.ts";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (body: string) =>
  new Response(`<!doctype html><html><head><title>Todos</title></head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const loginForm = (error = "") =>
  page(`<h1>Log in</h1>${error ? `<p role="alert">${escape(error)}</p>` : ""}
<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email" required>
  <label for="password">Password</label><input id="password" name="password" type="password" required>
  <button type="submit">Log in</button>
</form>`);

export function createApp({ db }: { db: AppDb }) {
  return new Elysia()
    .derive(async ({ cookie }) => ({
      currentUser: await userForToken(db, cookie[SESSION_COOKIE]?.value as string | undefined),
    }))
    .get("/login", () => loginForm())
    .post(
      "/login",
      async ({ body, cookie, redirect }) => {
        const [user] = await db.select().from(users).where(eq(users.email, body.email));
        if (!user || !(await Bun.password.verify(body.password, user.passwordHash))) {
          return loginForm("Wrong email or password");
        }
        const { token, expiresAt } = await startSession(db, user.id);
        cookie[SESSION_COOKIE]!.set({ value: token, httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
        return redirect("/", 303);
      },
      { body: t.Object({ email: t.String(), password: t.String() }) },
    )
    .get("/", async ({ currentUser, redirect }) => {
      if (!currentUser) return redirect("/login", 303);
      const mine = await db.select().from(todos).where(eq(todos.userId, currentUser.id)).orderBy(todos.id);
      return page(`<h1>${escape(currentUser.name)}'s todos</h1>
<ul class="todo-list">${mine.map((todo) => `<li>${escape(todo.title)}</li>`).join("")}</ul>`);
    })
    .get("/api/me", ({ currentUser, status }) => currentUser ?? status(401, { error: "not signed in" }))
    .get("/api/todos", async ({ currentUser, status }) => {
      if (!currentUser) return status(401, { error: "not signed in" });
      return db
        .select({ id: todos.id, title: todos.title, completed: todos.completed })
        .from(todos)
        .where(eq(todos.userId, currentUser.id))
        .orderBy(todos.id);
    });
}

export type App = ReturnType<typeof createApp>;
