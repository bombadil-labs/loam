# Premortem — §37 phase 13 connector registration (answered as a fresh independent read)

The phase shipped and then failed. Concrete, mechanistic causes, ranked by how likely each is to
have been the one:

## FOLDED — real causes now covered by the spec

1. **`owns("/oauth/register")` was not gated on the registration config, so phase 12's frozen rail
   (n) turned red.** `oauth-discovery.test.ts` serves with `publicUrl` set and NO connectors, and
   asserts `/oauth/register` is an ordinary 401. If the door claims that path the moment `publicUrl`
   exists, that assertion breaks and I am forced to edit a rail file another phase owns — the exact
   coupling the plan's §1 rule forbids. FOLD: the door is owned only when `registration !== undefined`,
   and a new rail asserts the opt-in from the other side (configured → the door answers).

2. **A `:443` allowlist entry silently never matches, so every registration is refused with a
   confusing message.** `url.origin` drops a default port, so `allowed.includes(url.origin)` can
   never equal an operator's `https://claude.ai:443`. Without a boot check the operator sees "not at
   a permitted origin" for a uri that looks identical to what they configured. FOLD: criterion (8) —
   `serve()` validates each allowlist origin with `redirectOriginDefect` at boot and refuses, turning
   a typo into a startup error instead of a silent all-refuse.

3. **The eviction "oldest" is a wall-clock read, so two registrations in one millisecond tie and the
   strict-ordering rail flakes.** `registeredAt: Date.now()` cannot gain a monotonic tiebreaker
   without changing `OAuthClient`'s frozen shape (a phase-11 migration). FOLD: criterion (4)'s
   ordering rail puts a real delay between the three registrations so `registeredAt` differs; the
   flood/pin rails (5) never depend on order because a pinned client is excluded from the candidate
   set entirely.

4. **Registration configured without `--public-url` builds no door at all, so the flag looks ignored.**
   `serve()` builds the OAuth doors only when `publicUrl` is set. FOLD: criterion (8) — `serve()`
   throws a named refusal when `connectors` is set without `publicUrl`, rather than silently serving
   a store where `--oauth-allow-redirect` did nothing.

## CONSIDERED — already handled by the design, no fold needed

- **Concurrent registrations lose an update.** `postRegister` awaits only the body read; the
  `withOAuthFile` write is fully synchronous with no interleaving await, and it re-reads inside the
  lock, so two in-process registrations serialize cleanly. The cross-process case is phase 11's lock.
- **The `full` refusal or the fault refusal leaks the home path.** Both are constant strings; the
  detail goes to `onFault`. Criterion (7) rails the body contains neither the path nor a flag name,
  with a positive control that `onFault` DID receive the detail.
- **A hostile `redirect_uri` with a control byte parses clean through `new URL()`.** `uriTextDefect`
  runs BEFORE `new URL()`. Criterion (3) rails it at the door and in the file, with a non-ASCII
  positive control.
- **The fixture plants an invalid grant and `writeOAuthFile` throws.** It builds a valid grant
  (`actor = authorForSeed(actorSeed)`, 32-byte hex seed); a bad one fails setup VISIBLY, not silently.
