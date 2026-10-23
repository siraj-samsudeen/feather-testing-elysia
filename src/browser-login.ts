// The browser side of a login: put a login's cookies in a live Playwright
// context so that the login replaces the previous user's cookies, and a
// refused add leaves the context as it was.
import type { Page } from "playwright";
import type { SessionCookie } from "feather-testing-core";
import { effectiveDomain, forPlaywright } from "./cookies";

/**
 * The browser step of a login, for the session on `page` at `baseUrl`.
 * Snapshot, clear the cookies this login replaces (by identity, whatever
 * their value; partitioned cookies are never replaced), put back what the
 * clear took by accident, then add; if the add fails, restore the
 * snapshot.
 */
export function browserLogin(page: Page, baseUrl: string): (cookies: SessionCookie[]) => Promise<void> {
  const host = new URL(baseUrl).hostname;
  return async (cookies: SessionCookie[]) => {
    const context = page.context();
    type Stored = Awaited<ReturnType<typeof context.cookies>>[number];
    const same = (a: Stored, b: Stored) =>
      a.name === b.name && a.domain === b.domain && a.path === b.path && a.partitionKey === b.partitionKey;
    /** Re-add whichever of `wanted` the context no longer holds. */
    const keep = async (wanted: Stored[]) => {
      const now = await context.cookies();
      const lost = wanted.filter((c) => !now.some((r) => same(r, c)));
      if (lost.length > 0) await context.addCookies(lost);
    };
    // Which stored cookies this login replaces, decided before the add
    // and by identity, whatever their value: unpartitioned, same name,
    // path and effective domain (a host-only and a Domain cookie are two
    // cookies to the browser, and the browser may store a domain
    // differently from how it was given, e.g. .localhost as localhost,
    // so where a new cookie lands can't be read back reliably). A
    // partitioned cookie is another cookie, never replaced here.
    const touches = (stored: Stored) =>
      !stored.partitionKey &&
      cookies.some(
        (c) =>
          c.name === stored.name &&
          (c.path ?? "/") === stored.path &&
          effectiveDomain(c, host) === stored.domain.replace(/^\./, "").toLowerCase(),
      );
    const before = await context.cookies();
    const replaced = before.filter(touches);
    try {
      for (const stored of replaced) {
        await context.clearCookies({ name: stored.name, domain: stored.domain, path: stored.path });
      }
      // clearCookies can't filter by partition: put back what it took
      // that was not meant to go (a partitioned twin).
      await keep(before.filter((c) => !replaced.includes(c)));
      await context.addCookies(forPlaywright(cookies, baseUrl));
    } catch (error) {
      // Any step failed (the clear, the put-back, or the browser refusing
      // a cookie): put the previous login back, so a failed login leaves
      // the context as it was. The add may have
      // installed some cookies before failing (Chromium's batches have
      // been all-or-nothing, but nothing promises it), so first clear
      // every cookie with one of this login's identities, then restore
      // the snapshot.
      await (async () => {
        for (const stored of (await context.cookies()).filter(touches)) {
          await context.clearCookies({ name: stored.name, domain: stored.domain, path: stored.path });
        }
        await keep(before);
      })().catch((rollbackError: unknown) => {
        // The original error is the one thrown; a failed rollback rides along as its cause.
        if (error instanceof Error && error.cause === undefined) error.cause = rollbackError;
      });
      throw error;
    }
  };
}
