// @elysiajs/eden is an optional peer: needed only by the api fixture (and
// the api logInAs returns). Checked in a copy of the project whose
// node_modules has everything but @elysiajs/eden.
import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function linkModulesExcept(from: string, to: string, skip: (name: string) => boolean) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (skip(entry)) continue;
    if (entry.startsWith("@")) {
      await linkModulesExcept(join(from, entry), join(to, entry), (name) => skip(`${entry}/${name}`));
    } else {
      await symlink(join(from, entry), join(to, entry));
    }
  }
}

test("everything but api works without @elysiajs/eden; api says what to install", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fte-no-eden-"));
  try {
    for (const path of ["src", "tests/example", "tests/no-eden", "package.json", "tsconfig.json"]) {
      await cp(join(root, path), join(dir, path), { recursive: true });
    }
    await linkModulesExcept(join(root, "node_modules"), join(dir, "node_modules"), (name) => name === "@elysiajs/eden");
    const child = Bun.spawn([process.execPath, "test", "./tests/no-eden/login.check.ts"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const report = out + err;
    expect(report).toContain(" 4 pass");
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
