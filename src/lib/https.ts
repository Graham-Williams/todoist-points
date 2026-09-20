// HTTPS enforcement at the origin (defence in depth — see issue #21).
//
// Only the Cloudflare tunnel reaches this container, and cloudflared forwards
// the VISITOR's scheme as `X-Forwarded-Proto` (`http` or `https`). The zone's
// "Always Use HTTPS" already 307/301s at the edge, but that is one dashboard
// toggle away from regressing, so the app enforces it itself too.
//
// ---------------------------------------------------------------------------
// ⚠️ THE GOTCHA THAT SHAPES THIS WHOLE MODULE (measured against the BUILT
// standalone server, not reproducible from a hand-built NextRequest):
//
//   The Next standalone server SYNTHESIZES `x-forwarded-proto: http` (and
//   `x-forwarded-host`) when the client didn't send them.
//
// So by the time middleware runs there is no such thing as "no forwarded
// proto header" — `isForwardedPlainHttp(null)` is dead code at runtime. Any
// rule of the form "redirect when X-Forwarded-Proto is http" therefore really
// means "redirect UNLESS something says https", which fails CLOSED on a
// request that never went through Cloudflare: it would be bounced to the
// exact URL it already asked for → an infinite redirect loop.
// ---------------------------------------------------------------------------
//
// Three rules, all deliberately narrow. A request is redirected only when ALL
// of them hold; anything else fails OPEN (served normally), matching the four
// sibling Flask apps:
//
//   1. The request must carry a CLOUDFLARE MARKER — `CF-Connecting-IP`, or a
//      parseable `CF-Visitor`. Neither is ever synthesized by Next and neither
//      survives the edge from an outside client (Cloudflare overwrites both),
//      so their presence is the one honest "this arrived through Cloudflare"
//      signal available. Without a marker we cannot know the visitor's scheme,
//      so we do not guess — no marker, no redirect. This is what makes the
//      loop above impossible: a request that reaches the container some other
//      way (in-network probe, a future sidecar, a direct https terminator) is
//      simply served.
//
//   2. The visitor's scheme must be plainly `http`. `CF-Visitor`'s `scheme` is
//      authoritative when present (Cloudflare sets it at the edge); otherwise
//      `X-Forwarded-Proto` is used. `https`, an ambiguous multi-hop list, or
//      an unreadable value all mean "don't redirect".
//
//   3. The request's `Host` must equal the configured APP_HOST. In-network
//      callers (the deploy sanity check, `docker compose exec ... fetch(
//      'http://localhost:3000/api/health')`) must never be redirected, and the
//      Host check is what separates them from visitor traffic — the same fact
//      the CSRF/origin pin already relies on. There are no per-path exemptions.
//
// And one rule about the target:
//
//   Build it from the configured APP_HOST, NEVER from the request's own URL
//   or Host header:
//     - `req.url` inside the Next standalone server carries the container
//       bind address (`0.0.0.0:3000`), so a target derived from it sends the
//       browser to http://0.0.0.0/ → ERR_CONNECTION_REFUSED. That bug was
//       already shipped once here and fixed in PR #13; don't reintroduce it.
//     - Reflecting the request's `Host` header would be an open redirect.
//   If APP_HOST is unset/empty/malformed we DON'T redirect (fail open), so
//   local dev, `npm test` and CI keep working.
//
// The redirect itself is a TEMPORARY 307 with `Cache-Control: no-store`, never
// a 301: a permanent redirect is cached by browsers (and by Cloudflare for
// cacheable extensions), so any mistake here would outlive its own fix. 307
// also preserves the method, so a plain-http POST is re-sent over https
// instead of being silently downgraded to a bodiless GET. HSTS already
// provides the durable client-side upgrade, so permanence buys nothing.
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

/** Status for the http→https redirect: temporary, method-preserving. */
export const HTTPS_REDIRECT_STATUS = 307;

/**
 * Headers attached to the redirect alongside `Location`.
 *
 * `no-store` is the real protection — nothing may ever cache a scheme
 * redirect, because a cached one survives a fix to the code that produced it.
 * `Vary` is belt-and-braces documentation of what the response depends on;
 * it names `X-Forwarded-Proto` only, identically to the five sibling repos
 * (`CF-Visitor` is also consulted, but `no-store` already forbids caching, so
 * the list is kept the same everywhere rather than drifting per app).
 */
export const HTTPS_REDIRECT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  Vary: "X-Forwarded-Proto",
});

/**
 * Append a field name to a `Vary` header without clobbering what is already
 * there. Mirrors Werkzeug's `resp.vary.add()` in the five Flask siblings:
 * idempotent, case-insensitive, and it leaves an existing `Vary: Cookie`
 * (which Next/the session layer may add) intact. `Vary: *` already covers
 * everything, so it is left alone.
 */
export function addVary(headers: Headers, field: string): void {
  const current = headers.get("Vary");
  if (!current || current.trim().length === 0) {
    headers.set("Vary", field);
    return;
  }
  if (current.trim() === "*") return;
  const already = current
    .split(",")
    .some((token) => token.trim().toLowerCase() === field.toLowerCase());
  if (!already) headers.set("Vary", `${current}, ${field}`);
}

// A bare hostname with an optional port. Anything else (scheme, userinfo,
// slash, backslash, whitespace, control chars) is refused so a fat-fingered
// APP_HOST can never turn the redirect into an open redirect.
//
// ⚠️ The host part must contain a DOT and must not be a bare IP literal.
// APP_HOST is a PUBLIC origin pin and a public hostname always has a dot.
// Without those two guards `APP_HOST=localhost` VALIDATED, so every plain-http
// visitor was handed a live `Location: https://localhost/…` — a redirect
// broken for everyone, and silent precisely BECAUSE the value passed, so the
// fail-open branch never fired. Such a value now fails open instead, which is
// the safe outcome. An explicit `:port` is still allowed (this repo's
// deliberate difference from the four Flask siblings; their APP_HOST is a bare
// hostname). Measured on staging by the break-staging sweep, 2026-09-19.
//   (?=[^:]*\.)                     the host part (before any port) has a dot.
//                                   `[^:]*` cannot cross the port separator,
//                                   so `localhost:3000` fails here.
//   (?!.*\.\d+(?::\d{1,5})?$)       the FINAL label is not all-digits. That
//                                   rejects every IPv4 literal (`127.0.0.1`,
//                                   with or without a port) and keeps this in
//                                   step with the Flask siblings' matching
//                                   `\.(?![0-9]+\Z)` rule.
// IPv6 literals were never accepted: ':' only appears here as the port
// separator, and '[' ']' are outside the character class.
const SAFE_HOST_RE = /^(?=[^:]*\.)(?!.*\.\d+(?::\d{1,5})?$)[A-Za-z0-9.-]+(?::\d{1,5})?$/;

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
 * The scheme carried by Cloudflare's `CF-Visitor` header, or `null` when the
 * header is absent/unparseable/not a recognised scheme.
 *
 * Cloudflare sends it as a tiny JSON object: `{"scheme":"https"}`. It is added
 * at the edge and cannot be supplied by the client, which is why it is trusted
 * over `X-Forwarded-Proto` when both are present.
 */
export function cfVisitorScheme(cfVisitor: string | null | undefined): "http" | "https" | null {
  if (typeof cfVisitor !== "string" || cfVisitor.length === 0) return null;
  // Guard against a pathological value before handing it to JSON.parse.
  if (cfVisitor.length > 256) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cfVisitor);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const scheme = (parsed as { scheme?: unknown }).scheme;
  if (typeof scheme !== "string") return null;
  const normalized = scheme.trim().toLowerCase();
  return normalized === "http" || normalized === "https" ? normalized : null;
}

/**
 * True when the request carries at least one marker that only Cloudflare adds.
 *
 * This is the guard that makes a missing/synthesized `X-Forwarded-Proto` fail
 * OPEN instead of looping (see the module header). It is not an authentication
 * check — anything already inside the container's network could set these
 * headers — it only answers "did this plausibly come through the tunnel?",
 * which is exactly the question the scheme decision depends on.
 */
export function hasCloudflareSignal(
  cfConnectingIp: string | null | undefined,
  cfVisitor: string | null | undefined
): boolean {
  if (typeof cfConnectingIp === "string" && cfConnectingIp.trim().length > 0) return true;
  return cfVisitorScheme(cfVisitor) !== null;
}

/**
 * True only when the forwarded scheme is exactly `http` (case-insensitive,
 * surrounding whitespace ignored — schemes are case-insensitive and proxies
 * pad values). A missing header, `https`, or a multi-hop list such as
 * `"http, https"` all return false: we only act on an unambiguous signal.
 *
 * NOTE the missing-header case is unreachable behind the real standalone
 * server, which synthesizes the header (module header). It is kept because
 * this is a pure predicate over an arbitrary string, and because the
 * Cloudflare-signal guard — not this function — is what handles that case.
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

/** Everything `httpsRedirectTarget` needs, named so the order can't be got wrong. */
export interface HttpsRedirectInput {
  /** `X-Forwarded-Proto` (may be synthesized by Next — see module header). */
  forwardedProto: string | null | undefined;
  /** `Host` — used as a GUARD only, never copied into the target. */
  requestHost: string | null | undefined;
  /** `CF-Connecting-IP` — a Cloudflare marker. */
  cfConnectingIp: string | null | undefined;
  /** `CF-Visitor` — a Cloudflare marker AND the authoritative visitor scheme. */
  cfVisitor: string | null | undefined;
  /** `process.env.APP_HOST` — the only source of the redirect's host. */
  appHost: string | null | undefined;
  /** `req.nextUrl.pathname`. */
  pathname: string;
  /** `req.nextUrl.search`. */
  search: string;
}

/**
 * The absolute https URL to redirect a plain-http request to, or `null` when
 * no redirect should happen.
 *
 * Fails OPEN (returns `null`) whenever anything is missing or ambiguous — in
 * particular when there is no Cloudflare marker at all, which is what stops a
 * non-Cloudflare request being redirected to the URL it already asked for.
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
export function httpsRedirectTarget(input: HttpsRedirectInput): string | null {
  const {
    forwardedProto,
    requestHost,
    cfConnectingIp,
    cfVisitor,
    appHost,
    pathname,
    search,
  } = input;

  // (1) No Cloudflare marker → we have no trustworthy view of the visitor's
  // scheme, so serve the request rather than guessing and risking a loop.
  if (!hasCloudflareSignal(cfConnectingIp, cfVisitor)) return null;

  // (2) The visitor's scheme must be unambiguously http. CF-Visitor wins when
  // it is present and readable; otherwise fall back to X-Forwarded-Proto.
  const visitorScheme = cfVisitorScheme(cfVisitor);
  const isPlainHttp =
    visitorScheme !== null ? visitorScheme === "http" : isForwardedPlainHttp(forwardedProto);
  if (!isPlainHttp) return null;

  // (3) Target host must be configured and safe, and the request must be
  // addressed to it.
  if (!isSafeRedirectHost(appHost)) return null;
  if (!hostMatches(requestHost, appHost)) return null;

  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = !search ? "" : search.startsWith("?") ? search : `?${search}`;
  return `https://${appHost}${encodeUnsafe(path)}${encodeUnsafe(query)}`;
}
