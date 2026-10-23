// logInAs must not need happy-dom (core's request adapter) unless a test
// uses a request session. Checked in a child process where it is unloadable.
import { expect, test } from "bun:test";

test("logInAs works without happy-dom when only session and api are used", async () => {
  const child = Bun.spawn(
    [process.execPath, "test", "--preload", "./tests/no-happy-dom/preload.ts", "./tests/no-happy-dom/login.check.ts"],
    { stdout: "pipe", stderr: "pipe", env: process.env },
  );
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const report = out + err;
  expect(report).toContain(" 5 pass");
  expect(code).toBe(0);
}, 60_000);
