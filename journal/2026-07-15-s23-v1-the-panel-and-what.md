## 2026-07-15 — §23 v1: the panel, and what it caught

Ran the sanctioned three-angle panel (substrate-semantics · capability-security · correctness-API) on the
§23 v1 diff — the first surface where Loam executes author-provided code and serves it over HTTP. Strong
cross-confirmation between independent angles is a good signal the findings were real, not stylistic.

The load-bearing catch (substrate + correctness, both HIGH): a version-pinned renderer stored the numeric
vN alias, and §17's own law is "aliases shift when a version is withdrawn; the hash never lies." So the
"pin" wasn't frozen — withdraw an earlier registration version and the renderer silently slid to a
different reading (or dangled). The fix is the §17 discipline the arc keeps re-learning: pin the version's
CONTENT ADDRESS (its deltaId, resolved from the author's vN at push), so the pin resolves the exact frozen
version forever, and if that version is struck the renderer goes dark (§23.6) rather than serving the
wrong one. The twin finding: field-coverage (§23.4) was checked against the LATEST schema, not the pinned
version's — so the "refuse a renderer that reads what the lens cannot fill" guarantee was wrong in both
directions for a pinned renderer. Both now check the pinned version's own schema. A regression test pins
v2, withdraws v1, and asserts the reading is unchanged — the exact scenario the old code got wrong.

Capability-security traced authority, the anonymous existence oracle, injection, and erasure and found
them CLEAN: the lawful-slice discipline means a foreign renderer binds nothing and only the operator's
negations can strike a route; refusals are uniform (no 404-vs-401 oracle); the base64 `data:` import
can't be injected; and a struck/erased renderer stops serving because the binding is read live per
request. Its headline residual is the genuinely-new capability — a bundle runs SYNCHRONOUSLY with no
timeout, on the anonymous door, with an attacker-chosen entity, so a hanging operator bundle wedges every
mount. That is squarely the §23.9/§24 sandbox/resource-discipline work the design already defers; it is
now documented in `serveRoute` and surfaced to Myk as v1's accepted trust boundary (operator-authored
bundles in a governed store), not silently shipped. Smaller fixes: an unloaded bundle is now UNMOUNTED
(404) not a 500 (matching `loadedRenderer`'s own doctrine), with `prepareRoute` pre-loading on the serve
path so an operator-raw-appended renderer still mounts; the full/public doors check the schema symmetrically
(uniform 404, no message leak to a stranger); and `appRouteOf` requires exactly a non-empty route+entity.

Retro for the audit-paused era: this panel cost ~275k subagent tokens across three angles with NO separate
verify stage (the fixer verified while fixing, audit-1's lesson), and it earned its keep — the vN-shift
bug was a real durability regression a single generalist reviewer might have waved past as "pinning works,
tests green." The rule holds: reserve the panel for the executable/capability/federation surfaces the
CLAUDE.md names, and let one careful pass cover the rest.

`npm run check` green — 566 tests (test/gateway/renderers.test.ts now 19: adds pin-durability-under-
withdrawal, pinned-version field coverage both directions, non-string return, unmounted-404, schema-not-
in-surface 404). Village phase23 still 4/4.
