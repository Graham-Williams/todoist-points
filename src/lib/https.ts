// HTTPS enforcement at the origin (defence in depth — see issue #21).
//
// Only the Cloudflare tunnel reaches this container, and cloudflared forwards
// the VISITOR's scheme as `X-Forwarded-Proto` (`http` or `https`). The zone's
// "Always Use HTTPS" already 301s at the edge, but that is one dashboard
// toggle away from regressing, so the app enforces it itself too.
//
// Two rules, both deliberately narrow:
//
//   1. Redirect ONLY when `X-Forwarded-Proto` is exactly `http` AND the
//      request's `Host` is the configured APP_HOST. In-network callers (the
//      deploy sanity check, `docker compose exec ... fetch(
//      'http://localhost:3000/api/health')`) must never be redirected, and the
//      forwarded-proto header alone CANNOT tell them apart:
//
//        ⚠️ MEASURED against the standalone server — the Next server SYNTHESIZES
//        `x-forwarded-proto: http` (and `x-forwarded-host`) when the client
//        didn't send them. So "no header" does not exist by the time middleware
//        runs, and a proto-only rule 301s the healthcheck (which asserts 200 and
//        would fail every deploy).
//
//      The Host check is what separates them: real visitor traffic arrives via
//      the tunnel carrying the public hostname (the same fact the CSRF/origin
//      pin below already relies on), while in-network probes carry
//      `localhost:3000`. There are still no per-path exemptions.
//
//   2. Build the target from the configured APP_HOST, NEVER from the
//      request's own URL or Host header:
//        - `req.url` inside the Next standalone server carries the container
//          bind address (`0.0.0.0:3000`), so a target derived from it sends
//          the browser to http://0.0.0.0/ → ERR_CONNECTION_REFUSED. That bug
//          was already shipped once here and fixed in PR #13; don't
//          reintroduce it.
//        - Reflecting the request's `Host` header would be an open redirect.
//      If APP_HOST is unset/empty/malformed we DON'T redirect (fail open), so
//      local dev, `npm test` and CI keep working.
//
// This module is dependency-free on purpose (no `next/*`, no npm imports) so
// it can be unit-tested directly under `node --test` — same reason
// `src/lib/order.ts` is split out.

/** Header name for HSTS. */
export const HSTS_HEADER = "Strict-Transport-Security";

/**
 * One year. Deliberately NO `includeSubDomains` and NO `preload`: each host
 * under graham-williams.com owns its own policy, and this app must not speak
 * for its siblings. Matches the apex landing page's
 * `snippets/security-headers.conf`, which is the reference implementation.
 */
export const HSTS_VALUE = "max-age=31536000";

// A bare hostname with an optional port. Anything else (scheme, userinfo,
// slash, backslash, whitespace, control chars) is refused so a fat-fingered
// APP_HOST can never turn the redirect into an open redirect.
const SAFE_HOST_RE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/** True when `host` is a plain host[:port] safe to put in a Location header. */
export function isSafeRedirectHost(host: string | null | undefined): host is string {
  return (
    typeof host === "string" &&
    host.length > 0 &&
    host.length <= 255 &&
    SAFE_HOST_RE.test(host)
  );
}

/**
 * True only when the forwarded scheme is exactly `http` (case-insensitive,
 * surrounding whitespace ignored — schemes are case-insensitive and proxies
 * pad values). A missing header, `https`, or a multi-hop list such as
 * `"http, https"` all return false: we only act on an unambiguous signal.
 */
export function isForwardedPlainHttp(proto: string | null | undefined): boolean {
  return typeof proto === "string" && proto.trim().toLowerCase() === "http";
}

// Percent-encode anything that must never appear raw in a Location header
// (CR/LF header injection, NULs, stray spaces). NextURL already yields an
// encoded path, so this is belt-and-braces rather than the main defence.
function encodeUnsafe(part: string): string {
  return part.replace(/[\x00-\x20\x7f]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    return `%${hex}`;
  });
}

/** Case-insensitive Host comparison (hostnames are case-insensitive). */
function hostMatches(requestHost: string | null | undefined, appHost: string): boolean {
  return (
    typeof requestHost === "string" &&
    requestHost.trim().toLowerCase() === appHost.toLowerCase()
  );
}

/**
 * The absolute https URL to redirect a plain-http request to, or `null` when
 * no redirect should happen.
 *
 * `requestHost` is only ever used as a GUARD (does this look like real
 * visitor traffic?) — it is never copied into the result, so a crafted Host
 * can't turn this into an open redirect. The target host is always APP_HOST.
 *
 * `pathname`/`search` must come from the parsed request URL (e.g.
 * `req.nextUrl.pathname` / `req.nextUrl.search`) and are copied through
 * untouched, so percent-encoding survives. (One caveat measured on the real
 * server: Next's own URL parsing re-serializes `%20` as `+` in the QUERY
 * before middleware ever sees it — equivalent for query semantics, and
 * nothing this code can undo. The path is untouched.)
 */
export function httpsRedirectTarget(
  forwardedProto: string | null | undefined,
  requestHost: string | null | undefined,
  appHost: string | null | undefined,
  pathname: string,
  search: string
): string | null {
  if (!isForwardedPlainHttp(forwardedProto)) return null;
  if (!isSafeRedirectHost(appHost)) return null;
  if (!hostMatches(requestHost, appHost)) return null;

  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = !search ? "" : search.startsWith("?") ? search : `?${search}`;
  return `https://${appHost}${encodeUnsafe(path)}${encodeUnsafe(query)}`;
}
