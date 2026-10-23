// The test's login state: the cookies of the latest login, the two-phase
// login itself, the login lock, and the refusals around running steps.
import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionCookie } from "feather-testing-core";
import { cookieKey } from "./cookies";

/**
 * Marks the async context of a mintSession call with a per-call token,
 * active only until that call settles: tasks it leaves behind (a timer, an
 * unawaited promise) keep the token but not the exemptions.
 */
export interface MintToken {
  active: boolean;
  /** The mintSession call's promise, when it returned one. */
  pending?: Promise<unknown>;
}
export const minting = new AsyncLocalStorage<MintToken>();

/**
 * Inside a mintSession call that has not settled yet. A microtask the mint
 * queued on its way out runs before any await after the call can switch
 * the token off, so with a promise, ask whether it has already settled
 * (Bun.peek.status; elsewhere the finally after the await is the fallback).
 */
export function insideMintSession(): boolean {
  const token = minting.getStore();
  if (!token?.active) return false;
  const peek = (globalThis as { Bun?: { peek: { status(p: Promise<unknown>): string } } }).Bun?.peek;
  if (token.pending && peek) return peek.status(token.pending) === "pending";
  return true;
}

/** The cookies the test is signed in with, and who to tell when they change. */
export class AuthState {
  cookies: SessionCookie[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `login` after every login started before it has settled (passed or failed). */
  serialize<T>(login: () => Promise<T>): Promise<T> {
    const run = this.tail.then(login);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Chains of the test's session and request that are running now, by which. */
  private running = new Map<Promise<unknown>, "session" | "request">();

  /** Logins started and not yet settled (passed or failed). */
  private logins = 0;

  beginLogin(): void {
    this.logins++;
  }

  endLogin(): void {
    this.logins--;
  }

  /**
   * The rule: await your steps before logInAs, and await logInAs before
   * your next steps. logInAs calls this first: it refuses while a chain of
   * the test's session or request is running, naming which.
   */
  refuseWhileRunning(): void {
    const which = [...new Set(this.running.values())].sort();
    if (which.length > 0) {
      throw new Error(
        `logInAs needs your ${which.join(" and ")} steps to be finished — await them before logging in.`,
      );
    }
  }

  /**
   * Record when a chain of `session` runs (await, then() and run() all go
   * through run()). A chain started while a login is in progress refuses
   * at once (unless mintSession itself started it), and its queued steps
   * are dropped so they don't run on the next await.
   */
  track<S extends { run(): Promise<void>; discard(): number }>(session: S, which: "session" | "request"): S {
    const run = session.run.bind(session);
    session.run = () => {
      if (this.logins > 0 && !insideMintSession()) {
        session.discard(); // drop the refused steps, so they don't run on the next await
        return Promise.reject(
          new Error(`${which} steps were started while logInAs(…) was in progress — await logInAs first.`),
        );
      }
      const chain = run();
      this.running.set(chain, which);
      const done = () => void this.running.delete(chain);
      chain.then(done, done);
      return chain;
    };
    return session;
  }

  /** Phase 1, may fail: e.g. add the cookies to a live browser context. */
  prepare: ((cookies: SessionCookie[]) => Promise<void>)[] = [];
  /** Phase 2, after every prepare succeeded: must not fail (e.g. put the cookies in the request's jar). */
  commit: ((cookies: SessionCookie[]) => void | Promise<void>)[] = [];

  /**
   * Two-phase: if any prepare step fails, the login is refused and nothing
   * else changes (auth, api, request keep the previous user).
   */
  async logIn(cookies: SessionCookie[]): Promise<void> {
    for (const prepare of this.prepare) await prepare(cookies);
    const replaced = new Set(cookies.map(cookieKey));
    this.cookies = [...this.cookies.filter((c) => !replaced.has(cookieKey(c))), ...cookies];
    for (const commit of this.commit) await commit(cookies);
  }
}

