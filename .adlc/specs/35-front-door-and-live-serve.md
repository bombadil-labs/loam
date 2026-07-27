# The front door and the served store that says so (T103 a+b, T104)

One lane, one surface (`src/cli/cli.ts`, `src/server/http.ts`): three small behaviors, each
making the served store more honest to the person actually standing at it.

## T103(a) — a pull into a served home says the server will not see it

`loam pull` and `loam register` open their own handle on the sqlite file. A `loam serve` holding
the same store keeps answering from its boot-time reactor, so the pull prints "N accepted" while
the running server serves none of it — an operation reporting a success whose visible effect has
not happened (H7 at the ops layer). The repair is honesty, not machinery: say it.

**Mechanism.** `loam serve` writes a serving record (`serving.json`, beside `config.json` in the
home): `{ pid, url, store, startedAt }`, removed on clean shutdown. `loam pull` and
`loam register`, after their own success report, consult it: record present + pid alive + same
store file → warn on stderr that a running server will not see these deltas until it restarts.
The check FAILS TOWARD WARNING (H9's direction, inverted for a probe whose silence licenses the
trap): an unreadable or unparseable record, a record missing its fields, a pid whose liveness
cannot be determined — all warn. Only two silences are earned: no record at all, and a record
whose pid is provably dead (`ESRCH` — checked, and no). A crash leaves a stale record; the dead
pid is what keeps that stale record quiet. A server started by an older build wrote no record and
stays invisible for exactly one generation — named in the PR, not papered over.

The warning never blocks: the pull landed, the deltas are durable, exit stays 0. It qualifies the
success rather than revoking it.

**Not built here (Myk-tier, recommendations in the PR body):** the pull door
(`POST /:mount/pull`) and the sqlite foreign-append watcher — both change what `serve` promises.

## T103(b) — `loam serve --host`

`ServeOptions.host` already exists; the CLI hardcodes `127.0.0.1`, so a LAN-reachable store (the
phone case) cannot be served by the CLI at all. Expose `--host` on `loam serve`; default
unchanged. The flag rides the existing allowlist/help machinery, so the manual cannot drift.

## T104 — `GET /` greets a human

The most human-visited path answered `{"errors":["a bearer token is required, and this one opens
nothing"]}` — a refusal naming a remedy that would not work, since no token opens `/`; the mounts
are the doors. `GET /` now answers a small constant HTML greeting: a Loam store serves here, its
doors are at `/<mount>`, what the operator declared public answers without a token, everything
else wants one. `GET /favicon.ico` answers 204, because every browser asks.

**Care.** The greeting is one constant string — independent of the mount table, the token
presented, and every public declaration — because anything it varied on would be an oracle the
uniform-refusal discipline just paid for. It is served before identity resolution, HTML only (no
content negotiation: two bodies are two things to keep constant, and a human is the only caller
with a reason to GET `/`). Every path other than exactly `/` and `/favicon.ico` (GET) answers
precisely as before; the frozen rails in `test/server/dynamic-mounts.test.ts` stay untouched.

## Acceptance criteria

- (a) A pull into a home a live server holds warns on stderr — the warning names the running
  server and says it will not see these deltas until restart — while the pull itself still
  reports its accepted count and exits 0. Verified by `test/cli/serve-staleness-warning.test.ts`.
- (b) `loam register` against the same served home warns the same way. Verified by
  `test/cli/serve-staleness-warning.test.ts`.
- (c) The silence is earned, both ways: after the server closes cleanly, the identical pull warns
  nothing; and a serving record whose pid is provably dead warns nothing. Verified by
  `test/cli/serve-staleness-warning.test.ts`.
- (d) Uncertainty warns: a corrupt serving record (unparseable JSON, or fields missing) produces
  the warning rather than silence. Verified by `test/cli/serve-staleness-warning.test.ts`.
- (e) A pull into a DIFFERENT store file in the same home does not warn — the running server's
  world is not the one that moved. Verified by `test/cli/serve-staleness-warning.test.ts`.
- (f) `loam serve --http --host 0.0.0.0` answers a connection arriving via `127.0.0.2` — an
  address the DEFAULT bind provably refuses in the same test — and `loam serve --help` lists
  `--host`. Verified by `test/cli/serve-host.test.ts`.
- (g) `GET /` answers 200 `text/html` to a tokenless caller, and the body says a Loam store
  serves here, that the doors are at `/<mount>`, and that public surfaces answer without a token.
  Verified by `test/server/front-door.test.ts`.
- (h) The greeting is byte-identical across worlds: a server with three mounts and a public
  declaration, a server with zero mounts, a caller with a bearer token and one without, and the
  same server after `addMount`/`removeMount` — one body, compared as bytes. Verified by
  `test/server/front-door.test.ts`.
- (i) The greeting enumerates nothing: the body contains no mount name of the serving store.
  Verified by `test/server/front-door.test.ts` (the fixture's mount names are distinctive
  strings asserted absent).
- (j) `GET /favicon.ico` answers 204 with an empty body, tokenless. Verified by
  `test/server/front-door.test.ts`.
- (k) The greeting lives at exactly `/`: a tokenless GET of an existing mount's bare root and of
  an absent mount's are byte-identical refusals (as today), and `POST /` refuses as before.
  Verified by `test/server/front-door.test.ts`.
- (l) The frozen uniform-refusal rails are untouched and green: `git diff --name-only origin/main
  -- test/server/dynamic-mounts.test.ts` answers empty, `node scripts/rails-guard-ci.mjs
  origin/main` passes, and `npm run check` is green with counts read.
