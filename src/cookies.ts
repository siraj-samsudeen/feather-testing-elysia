// Cookie rules shared by the fixtures: identity, validation, and the
// Playwright shape of a minted cookie.
import type { SessionCookie } from "feather-testing-core";

/** The origin in-process clients address the app on: the request adapter's default baseUrl. */
export const APP_ORIGIN = "http://localhost";

/**
 * The domain a cookie lands on, as core's request jar resolves it: no
 * domain means the app's host; case and a leading dot don't matter. Two
 * cookies with the same name, path and effective domain are the same
 * cookie, so a later login replaces an earlier one.
 */
export function effectiveDomain(cookie: SessionCookie, appHost = new URL(APP_ORIGIN).hostname): string {
  return (cookie.domain ?? appHost).replace(/^\./, "").toLowerCase();
}

/** A cookie's identity: name, effective domain, path. */
export function cookieKey(cookie: SessionCookie): string {
  return `${cookie.name}\u0000${effectiveDomain(cookie)}\u0000${cookie.path ?? "/"}`;
}

/**
 * A negative `expires` (-1 in Playwright's cookies) means a session cookie.
 * Leave it out before handing cookies to Playwright, which accepts no
 * negative but -1. (Core's request jar reads any negative as a session cookie.)
 */
export function asSessionCookies(cookies: readonly SessionCookie[]): SessionCookie[] {
  return cookies.map(({ expires, ...rest }) => (expires !== undefined && expires >= 0 ? { ...rest, expires } : rest));
}

/** Core's cookie rule for Playwright: without a domain, set for baseUrl's host by domain + path. */
export function forPlaywright(cookies: SessionCookie[], baseUrl: string) {
  const origin = new URL(baseUrl);
  return asSessionCookies(cookies).map(({ domain, path, ...rest }) => {
    if (domain !== undefined) return { ...rest, domain, path: path ?? "/" };
    // domain + path, not url: a url makes Playwright take `secure` from its
    // scheme, overriding the cookie's own (as core's addCookies does).
    return { ...rest, domain: origin.hostname, path: path ?? "/" };
  });
}

/** 9999-12-31T23:59:59Z in seconds: a later `expires` is not seconds since the epoch. */
const MAX_EXPIRES_SECONDS = 253_402_300_799;

/**
 * Refuse a cookie no client would take, before anything changes, so a bad
 * mintSession result never half-applies a login.
 */
export function validateCookie(cookie: SessionCookie): void {
  const bad = (problem: string) =>
    new Error(`logInAs: mintSession's cookie '${cookie.name}' ${problem}`);
  if (cookie.name === "" || /[\s;=,\x00-\x1f\x7f]/.test(cookie.name)) {
    throw bad("has an invalid name: it must be non-empty, without spaces, ';', '=' or ','.");
  }
  if (/[;\x00-\x1f\x7f]/.test(cookie.value)) {
    throw bad("has an invalid value: it must not contain ';' or control characters.");
  }
  if (cookie.expires !== undefined) {
    if (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)) {
      throw bad(`has expires ${String(cookie.expires)}: give seconds since the epoch, -1 (or none) for a session cookie.`);
    }
    if (cookie.expires > MAX_EXPIRES_SECONDS) {
      throw bad(
        `has expires ${cookie.expires}, which looks like milliseconds: expires is in seconds since the epoch, ` +
          "e.g. Math.floor(date.getTime() / 1000).",
      );
    }
  }
  if (cookie.domain !== undefined && (typeof cookie.domain !== "string" || cookie.domain.replace(/^\./, "") === "")) {
    throw bad("has an empty domain: leave domain out for a host-only cookie.");
  }
  if (cookie.path !== undefined && (typeof cookie.path !== "string" || !cookie.path.startsWith("/"))) {
    throw bad(`has path ${JSON.stringify(cookie.path)}: a path starts with '/'.`);
  }
  if (cookie.sameSite !== undefined && !["Strict", "Lax", "None"].includes(cookie.sameSite)) {
    throw bad(`has sameSite ${JSON.stringify(cookie.sameSite)}: use "Strict", "Lax" or "None".`);
  }
}

export function toCookies(minted: unknown): SessionCookie[] {
  const cookies = Array.isArray(minted) ? minted : [minted];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw new Error(
        `logInAs: mintSession must return { name, value, ... } or an array of them; got ${JSON.stringify(minted)}.`,
      );
    }
    validateCookie(cookie as SessionCookie);
  }
  // The same cookie twice (same name, path and effective domain): the
  // last one wins, as it would in a browser's jar.
  const last = new Map<string, SessionCookie>();
  for (const cookie of cookies as SessionCookie[]) {
    const key = cookieKey(cookie);
    last.delete(key);
    last.set(key, { ...cookie });
  }
  return [...last.values()];
}

