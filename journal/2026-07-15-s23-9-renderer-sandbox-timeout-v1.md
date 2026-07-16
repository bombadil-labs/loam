## 2026-07-15 — §23.9 renderer sandbox + timeout, v1 build: the wedge is closed

The third §23 build slice (stacked on T10). It closes the capability-security panel's HEADLINE residual on
the §23 v1 build (#99): `serveRoute` executed the author's bundle SYNCHRONOUSLY on the event loop with no
timeout, so an infinite-loop bundle wedged EVERY mount — and on the anonymous door, with an attacker-chosen
entity, that is a one-line denial of service. Each render now runs in a Node `worker_threads` Worker with a
hard timeout (`terminate()` on overrun — which `node:vm`'s timeout cannot guarantee against an async
escape) and `resourceLimits`.

Three things made the build cleaner than feared. (1) T9's envelope did double duty: because `serveRoute`
already hands the renderer the §23.7-enveloped view (bytes are `{ mime, ref, base64url }` strings, not
`Uint8Array`s), the node is already JSON/structured-clone-safe to `postMessage` across the thread boundary
— no extra serialization. (2) The worker runs via `new Worker(src, { eval: true })`, which is CommonJS even
in this `type: module` package, so `require('worker_threads')` + dynamic `import(dataUrl)` both work and no
separate worker file must ship in dist. I verified empirically before wiring it in: a `while(true){}` bundle
times out at ~550ms, is terminated, and the main event loop survives — the test asserts exactly that (a
second route answers 200 while the hanging render spins). (3) Authority never crosses the boundary: the
read-discipline + resolve stay on the main thread, and only the untrusted render runs in the worker; every
failure folds to a clean 500 that leaks nothing of the bundle's internals.

Two decisions worth recording. The async ripple: `serveRoute` became `async`, so every caller awaits —
~29 test call sites (transformed mechanically) plus the two HTTP `app` cases (already in async handlers).
And the browser-bundle wall: the worker module is Node-only (its worker-source string names
`worker_threads`), and the browser/site bundles are a zero-`node:`, no-`require(` invariant
(test/browser/bundle.test.ts). Aliasing `node:worker_threads` alone was NOT enough — the worker-source
STRING still carried a literal `require(` into the bundle. The right fix keeps the whole module out: a
shared esbuild resolve plugin (`scripts/esbuild-stub-render-worker.mjs`) redirects any `render-worker`
import to a browser stub that refuses, used by both `build-bundles.mjs` and `build-site.mjs`.

Honest scope, stated in code and spec: a Worker bounds the HANG / crash / memory — it is NOT full
object-capability isolation. A worker can still reach `node:fs` or the network. True no-fs/no-net ocap
(SES-in-worker or isolated-vm) is a FURTHER hardening, deferred to §24 / a deeper slice. And v1 spawns a
worker per render (~ms) — acceptable, noted; a small warm pool is the obvious follow-on. Overselling a
worker as a sandbox is exactly the trap the ticket warned against, so the deferral is loud, not buried.

Learning: a "bound the bad bundle" feature's real surface area is the async ripple and the bundle
invariants, not the worker itself — the Worker was ~40 lines and worked first try (after a 20-line
empirical spike); the day went to the ~29 awaited call sites and the browser bundle's no-`require(` line,
which a literal worker-source string quietly violated. Grep the invariants, don't assume an alias covers a
string.

`npm run check` green — 595 tests (test/gateway/render-sandbox.test.ts 4: happy path unchanged; infinite
loop → 500 timeout while a second route still answers, proving the event loop is not wedged; a throwing
bundle → clean 500, no leak; a memory-hog is bounded and the host survives; all serveRoute callers now
await). Village phase23/phase-bytes/phase-pinned still pass (their renders now ride the worker). Additive/
non-breaking → no §20 migration. Executable/capability surface → Myk's merge (P6), opened stacked on T10.
