// Where a sign-in may RESUME (SPEC §37 phase 14, T148) — the one fence between the login door and
// the authorize door, and its own file because neither door may own it. `oauth.ts` imports
// `session.ts` for the SessionGate, so the login door cannot import the authorize door back; and
// the rule itself belongs to neither page. It belongs to the path.
//
// THE RULE IS A CONSTRUCTION, NOT A CHECK. A continuation is a QUERY STRING, never a destination:
// the caller's text is parsed as parameters, every name outside the authorize allowlist is dropped,
// and the survivors are re-encoded and appended to a PATH LITERAL this file holds. No caller text
// ever reaches the path, the scheme, or the host, so there is nothing to validate away — an
// absolute url, a scheme-relative `//evil.example`, an encoded traversal and a CRLF injection all
// arrive as parameter names nobody asked for and leave as nothing.
//
// WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE. This is the page a person types a password into.
// An open redirect on the sign-in path is a credential-phishing gift: the victim signs in to a
// REAL Loam store, sees a real refusal or a real success, and is then handed to a page the
// attacker wrote. Round-tripping a caller-supplied absolute url — even one this store checks —
// is how that ships, so this file never holds one.

/** The consent page's path. The ONE destination a sign-in may resume, held as a literal. */
export const AUTHORIZE_PATH = "/oauth/authorize";

/** The hidden field the login form round-trips, and the body field the login POST reads. */
export const CONTINUE_FIELD = "continue";

/**
 * The authorize parameters a continuation may carry — an ALLOWLIST, in the order a resumed query
 * writes them. RFC 6749 §4.1.1 and RFC 7636 §4.3 name the first six; `resource` is RFC 8707's,
 * which an MCP client sends. Anything else a caller puts in the field is dropped, so the resumed
 * query can never grow a parameter the authorize door did not expect to read.
 */
const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

/**
 * A ceiling on the field, well above a real authorize query (a `state` alone is capped at 2048 by
 * the consent door) and far below anything worth parsing. A continuation over it is not truncated —
 * truncation would change a parameter's value — it is simply not a continuation.
 */
const MAX_CONTINUATION = 8192;

/**
 * The continuation an authorize request earns: its own query, filtered to the allowlist and
 * re-encoded. `undefined` when nothing survives — a request with no recognised parameter is not a
 * flow worth resuming, and rendering an empty field would only invite a caller to fill it.
 *
 * The filter runs on the WAY OUT as well as the way in, so the hidden field a person's browser
 * holds already carries nothing this store would refuse to re-attach.
 */
export function authorizeContinuation(query: string): string | undefined {
  if (query.length > MAX_CONTINUATION) return undefined;
  const presented = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const kept = new URLSearchParams();
  for (const name of AUTHORIZE_PARAMS) {
    const value = presented.get(name);
    if (value !== null) kept.set(name, value);
  }
  const carried = kept.toString();
  return carried === "" ? undefined : carried;
}

/**
 * Where a successful sign-in goes when the form carried `carried`, or `undefined` for the ordinary
 * sign-in that carried nothing this store recognises.
 *
 * The answer is a ROOT-RELATIVE path built from a literal plus a `URLSearchParams` serialization,
 * which percent-encodes every byte that could change a url's meaning — `/`, `?`, `#`, and the CR
 * and LF a header injection would need. So the destination is same-origin and exactly
 * `AUTHORIZE_PATH` by construction. Whether that RESUMED request is honoured is then the authorize
 * door's own business: its exact-match redirect fence and its PKCE gate run unchanged.
 */
export function resumeTarget(carried: string): string | undefined {
  const query = authorizeContinuation(carried);
  return query === undefined ? undefined : `${AUTHORIZE_PATH}?${query}`;
}
