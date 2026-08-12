// The emitted artifact page (SPEC §30): one file, everything inlined, no external host referenced
// anywhere. Two halves live here — the HTML skeleton and the SHELL, the client host adapter that holds
// the coordinates, talks to the viewer's own connector, and mounts the bundle in a confined realm.
//
// WHAT THE PAGE NAMES, and what it deliberately does not. It names a connector DISPLAY NAME, a tool name
// or two, a lens name, an entity, and the `consumes` list. It does not name a host, an origin, a mount, a
// token, a seed, or a single byte of view data — the data path is `window.claude.mcp`, the connector holds
// the URL and the credential, and the page holds coordinates. So the same bytes read whichever store the
// connector points at.
//
// DOM ORDER IS LOAD-BEARING, twice. The host's writer-identity statement and the shell's status line
// render OUTSIDE and AFTER the mount point, so whatever a §23.3-compliant renderer says about its own pen
// — and it must say something, which is why the page cannot be required to omit the pen NAME — the host
// gets the last sentence and the viewer reads the host's.
//
// THE SHELL IS THE ONLY HOLDER OF AN MCP HANDLE, which is what makes the confinement assertable at all:
// traffic can be counted at one seam. It is also the MEDIATOR — it intercepts `data-loam-read` gestures on
// the markup the bundle returned, composes one uncached `loam_query`, folds the answer into `node.reads`,
// and re-renders. It adjudicates nothing: the read boundary is the schema the viewer installed and the
// mount their connector points at, and a page-side allow-list would constrain the APP while claiming to
// constrain the viewer.

import { realmProgram } from "./artifact-realm.js";
import type { RendererBinding } from "./renderers.js";

// The connector display-name ceiling. Not a security bound — a decidable one, so an unusable name refuses
// at pack time rather than emitting a page that can never connect to anything.
export const MAX_CONNECTOR_NAME = 128;

// The ceiling on the page's SPAWN wait: worker thread start plus the blob: module import, measured from
// `new Worker` to the realm's `live` signal. Sized to a contended device rather than to a bundle —
// measured spawn on a 16-core box was 4 ms idle, 91 ms at load ~150 and 803 ms worst at load ~550, so
// 10 s is roughly twelve times the worst observed rather than a guess. It is a CONSTANT and not an
// operator option, unlike the server host's: the server's spawn ceiling bounds how long one anonymous
// caller may hold a `maxPublicRenders` slot, and this clock holds nothing but the viewer's own tab.
export const ARTIFACT_SPAWN_TIMEOUT_MS = 10_000;

// A GraphQL-legal name from a store-native one — the SAME mangling `legal()` runs in gql.ts, which is
// where the store-side truth lives. It is duplicated here because the shell is a standalone page that
// cannot import from the gateway, and `test/gateway/artifact-reads.test.ts` pins the two to agree.
// THE STORE HAS TWO MANGLINGS AND THEY DIFFER BY ONE CHARACTER, so the page carries two. Mirrors
// `legalNameFor` and `queryFieldFor` in gql.ts exactly, and the split is the whole point:
//
//   `legalName(s)`  — GraphQL-legal only. The VIEW TYPE, every PROP FIELD, and every per-prop MUTATION
//                     ARGUMENT (`gql.ts` builds those with `legal(prop)`). `Height` stays `Height`.
//   `rootField(s)`  — the same, then initial-lowercased. The QUERY-ROOT and MUTATION-ROOT field of a
//                     lens. Lens `Plant` is served at field `plant`.
//
// A page carrying only one of them spells one of the two sites wrong for exactly the names whose
// initial is an uppercase ASCII letter — and only the WRITE site, since a read names no prop. The
// failure looks like nothing: the page paints correctly and every form is quietly dead.
//
// Duplicated here because the shell is a standalone page that cannot import from the gateway;
// `test/gateway/artifact-reads.test.ts` pins BOTH against the REAL GraphQL schema, and executes the
// page's own composed query AND its own composed mutation against the live door — a stub that echoes
// the document back agrees with either spelling, which is how this survived a green suite once.
const LEGAL_JS = `function legalName(s) {
    var cleaned = String(s).replace(/[^_A-Za-z0-9]/g, "_");
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : "_" + cleaned;
  }
  function rootField(s) {
    return legalName(s).replace(/^[A-Z]/, function (c) { return c.toLowerCase(); });
  }`;

// The confined realm's whole program. It runs in a Worker global scope — no `window`, no `document`, and
// therefore no `window.claude`: absent by CONSTRUCTION rather than filtered, which is the difference
// between a boundary and a scrub.
//
// Its protocol is `render-worker.ts`'s, message for message: `{ bundle, node }` in, `{ kind: "ok", html }`
// / `{ kind: "notHtml" }` / `{ kind: "fault" }` back, so a fault folds to a clean refusal leaking nothing
// of the bundle's internals. The extra `{ kind: "live" }` is the second clock's start gun (T73): a slow
// spawn under a loaded tab must not charge startup against the render's budget.

// The coordinates the page holds. Everything here is pack-time text from the store that packed the page;
// nothing is view data (criterion 3 asserts that at the bytes).
export interface ArtifactCoordinates {
  readonly server: string;
  readonly route: string;
  readonly lens: string;
  readonly entity: string;
  readonly consumes: readonly string[];
  readonly manifest: readonly string[];
  // The `writable` set the operator was ACKNOWLEDGED for — a receipt of a human decision, not a
  // boundary (the viewer could always send the document themselves). What it buys: widening the
  // schema's `writable` in a v2 registration does not widen an already-emitted page.
  readonly writable: readonly string[];
  // Text a viewer READS, never a target the page requests — the one place a store address appears.
  readonly storeAddress: string;
  readonly refetchInterval: number;
  readonly renderTimeoutMs: number;
  readonly renderSpawnTimeoutMs: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// JSON destined for a `<script type="application/json">` body. `<` is escaped to its JSON unicode form so
// no payload can spell a closing tag, and the bytes still `JSON.parse` back byte-identical — which is what
// lets criterion 1 recover the bundle and content-address it equal to the binding's.
const inlineJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
// The shell: the client HOST ADAPTER. Deliberately one function of its coordinates, in plain ES5-shaped
// JS, with no build step of its own — the page is what was audited.
function shellSource(): string {
  return `(function () {
  "use strict";
  ${LEGAL_JS}
  var read = function (id) { return document.getElementById(id); };
  var C = JSON.parse(read("loam-coordinates").textContent);
  var BUNDLE = JSON.parse(read("loam-bundle").textContent);
  var mount = read("loam-app");
  var line = read("loam-status");
  var onboarding = read("loam-onboarding");

  // The accumulated readings are MEMORY-ONLY and dropped WHOLE. No localStorage, no sessionStorage, no
  // IndexedDB, no cookie: a re-boot starts with an empty map and nothing but the page's own coordinates,
  // so no pre-erasure answer can be replayed from the viewer's side of the wall.
  var reads = {};
  var state = {};
  var root = null;
  var realmUrl = null;
  var live = 0;

  var REALM = ${JSON.stringify(realmProgram())};

  function realm() {
    if (realmUrl !== null) return realmUrl;
    try {
      realmUrl = URL.createObjectURL(new Blob([REALM], { type: "text/javascript" }));
    } catch (noBlob) {
      realmUrl = "data:text/javascript;charset=utf-8," + encodeURIComponent(REALM);
    }
    return realmUrl;
  }

  // One render, one realm. The bundle rides VERBATIM into a worker spawned for this render and
  // terminated after it — which is both the time bound and the whole answer to what a compartment may
  // RETAIN: a bundle handed a fresh realm per render cannot hold a copy across renders, because there is
  // nothing for it to hold the copy in.
  //
  // TWO CLOCKS, AND TWO NUMBERS, because the two waits measure different things. The SPAWN window runs
  // to the realm's live signal and measures the viewer's DEVICE — worker thread start plus the realm's
  // own module import, machinery the bundle has no part in. It reads C.renderSpawnTimeoutMs and says
  // "could not start", never "timed out", which would claim the renderer ran. Only the RENDER window
  // reads the operator's budget. Charging spawn to that budget refuses healthy bundles on a busy
  // device: measured through a real Chrome on a 16-core box, spawn is 4 ms idle, 91 ms at load average
  // 150, and 803 ms at load 550, against a 500 ms default.
  //
  // WHAT THE RENDER WINDOW STILL COVERS, stated because the number is not small. The realm signals live
  // when ITS module has evaluated, which is before the bundle arrives — so the render window carries the
  // bundle's own blob: import and module evaluation as well as its call. Measured the same way with a
  // trivial bundle: 2 ms idle, 127 ms median and 801 ms at load 550. It cannot be split further, because
  // import() resolves only AFTER the bundle's top-level has run — the loader plumbing and the bundle's
  // own code share one window and no signal can sit between them. So on a device past roughly load 500,
  // a trivial bundle can still be reported as timing out. Closing that needs a wider operator budget,
  // which is a §23.9 decision and not this shell's to make.
  //
  // Both windows are HARD, and the live re-arm fires ONCE — a bundle that reaches a bare postMessage
  // (self is sealed in the realm; the bare identifier is not) could otherwise re-arm the render clock
  // forever and hold its own worker alive.
  // Every render carries an EPOCH, and a render whose epoch has passed paints nothing. Without this a
  // real spawn plus a blob: module import is tens of milliseconds during which the world can move: root
  // answer A arrives, worker A spawns, an erasure lands and clears the mount, then worker A posts and
  // writes the PRE-ERASURE markup back into the DOM from a node captured before the teardown. The
  // teardown has to be final, not merely first. darken and the loss path both bump the epoch, so a
  // stale render is discarded rather than raced.
  function stale(epoch) {
    return epoch !== live;
  }

  // The STOP function of the render last started — at most one, since every paint discards before
  // pushing its own. A settled render's entry stays until the next discard and re-invoking it is a
  // no-op, so this is "not yet discarded" rather than "still running". Stopping paints nothing by
  // construction: stop() takes no message and touches no DOM, so discard() cannot report anything,
  // whatever epoch the caller left behind.
  var crew = [];
  function discard() {
    var held = crew;
    crew = [];
    for (var i = 0; i < held.length; i += 1) held[i]();
  }

  function paint(node) {
    // THE EPOCH MOVES BEFORE ANYTHING CAN FAIL. Bumping it after the Worker constructor left the
    // failure path neither final nor first: the refusal painted below, then a render still in flight
    // kept a live epoch and overwrote it with markup composed from the PREVIOUS node — a stale view
    // presented as current, with nothing saying so. Worker construction fails exactly on the loaded
    // device this whole clock is written for, so that path is not hypothetical.
    live += 1;
    var epoch = live;
    // Every render already in flight stops HERE, rather than when its own clock expires. Without this a
    // superseded render that has not yet gone live waits out the whole spawn ceiling before its worker is
    // terminated, so a viewer clicking through gestures on a slow device accumulates worker threads and
    // deepens the very contention that made the spawn slow.
    discard();
    var worker;
    try {
      worker = new Worker(realm(), { type: "module" });
    } catch (noWorker) {
      mount.textContent = "this renderer could not be mounted in this viewer";
      return;
    }
    var settled = false;
    var started = false;
    var timer = setTimeout(function () { done({ kind: "noStart" }); }, C.renderSpawnTimeoutMs);
    // STOP is the internal teardown and it takes NO message. Keeping it off the reporting ladder is
    // what stops the compartment reaching the shell's own bookkeeping: done() is called with whatever
    // the worker posted, and a bundle can reach a bare postMessage, so any kind the ladder handles
    // specially is a kind a bundle can send. An unknown kind is a fault, which is the right answer.
    function stop() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch (gone) { /* already down */ }
    }
    function done(msg) {
      if (settled) return;
      stop();
      // A render the world has moved past writes NOTHING. Its worker is still terminated above, so a
      // superseded bundle cannot keep running either.
      if (stale(epoch)) return;
      if (msg.kind === "ok") { mount.innerHTML = msg.html; return; }
      // A spawn overrun gets its OWN sentence. Saying "timed out" would claim the renderer ran.
      mount.textContent = msg.kind === "noStart"
        ? "the renderer could not start"
        : msg.kind === "timeout"
          ? "the renderer timed out"
          : msg.kind === "notHtml"
            ? "the renderer did not return HTML"
            : "the renderer faulted";
    }
    crew.push(stop);
    worker.addEventListener("message", function (ev) {
      var msg = ev.data || {};
      if (msg.kind === "live") {
        if (settled || started) return;
        if (stale(epoch)) { stop(); return; }
        started = true;
        clearTimeout(timer);
        timer = setTimeout(function () { done({ kind: "timeout" }); }, C.renderTimeoutMs);
        return;
      }
      done(msg);
    });
    worker.addEventListener("error", function () { done({ kind: "fault" }); });
    worker.postMessage({ bundle: BUNDLE, node: node });
  }

  function nodeNow() {
    return {
      entity: root === null ? C.entity : root.entity,
      view: root === null ? {} : root.view,
      hex: root === null ? "" : root.hex,
      reads: reads,
      state: state
    };
  }

  function rerender() { if (root !== null) paint(nodeNow()); }

  // A non-data event never leaves a previous view painted — not in the mount point and not in the
  // accumulated readings. Clearing the paint while drilled-down copies survive in a map would be a
  // completeness claim the bytes do not have.
  function darken(text) {
    root = null;
    reads = {};
    state = {};
    // Bump the epoch so any render already in flight paints nothing when it lands. Clearing the mount
    // without this leaves a race whose loser is the viewer: the old markup comes back a moment later.
    live += 1;
    // …and stop them now rather than at their own clocks: darkening is a teardown, and a worker still
    // running someone else's bundle behind a cleared mount is the residue a teardown is supposed to take.
    discard();
    mount.textContent = "";
    line.textContent = text;
  }

  // Degraded states branch on CODE, never on message text, and the enumeration is exhaustive: an
  // unlisted code names ITSELF rather than joining a catch-all, so a code added to the runtime cannot
  // silently become "something went wrong".
  function fixFor(code, message, server) {
    switch (code) {
      case "server_not_connected":
        return "no connector answers to \\u201c" + server + "\\u201d. Add it in claude.ai Settings \\u2192 Connectors, "
          + "pointing at your Loam store\\u2019s MCP door: " + C.storeAddress;
      case "selection_required":
        return "more than one connector answers to \\u201c" + server + "\\u201d \\u2014 choose which one this page should read.";
      case "needs_reauth":
        return "the connector \\u201c" + server + "\\u201d needs reconnecting in claude.ai Settings \\u2192 Connectors.";
      case "not_granted":
        return "this view was not granted MCP, so no store can be reached from it.";
      case "capability_disabled":
      case "capability_removed":
        return "MCP is not usable in this view.";
      case "server_unavailable":
        return "your store is unreachable right now.";
      case "tool_error":
        return "your store answered and refused the lens \\u201c" + C.lens + "\\u201d: " + message;
      case "not_in_manifest":
        return "this page asked for a tool outside the scope you consented to.";
      case "blocked_by_policy":
        return "your organization\\u2019s policy blocks this tool.";
      case "approval_required":
        return "this tool needs per-call approval, which an artifact cannot ask for.";
      case "bad_request":
        return "the page made a malformed request: " + message;
      default:
        return "your store reported \\u201c" + code + "\\u201d: " + message;
    }
  }

  // The floor's four codes. An MCP code never crosses into the bundle's node: the server-rendered host
  // has no broker and could never produce one, so a bundle branching on needs_reauth would behave
  // differently on one host behind one content address.
  function floorCode(code) {
    switch (code) {
      case "server_not_connected":
      case "selection_required":
      case "needs_reauth":
      case "not_granted":
      case "capability_disabled":
      case "capability_removed":
        return "needs_connection";
      case "server_unavailable":
      case "rate_limited":
      case "cancelled":
        return "unavailable";
      default:
        return "refused";
    }
  }

  // Codes a repeat can NEVER fix, whatever the error is stamped with. The runtime's own doctrine: a
  // needs_reauth means credential refresh was already exhausted upstream, a server_not_connected means
  // no connector is configured at all, and a selection_required persists until the viewer chooses. A
  // retryable stamp on one of these is a lie, or an older shell's mistake, and honouring it turns a
  // dead end into a loop. So the exclusion is by CODE and the stamp is only ever a second condition.
  function neverRetry(code) {
    return code === "needs_reauth" || code === "server_not_connected" || code === "selection_required"
      || code === "not_granted" || code === "capability_disabled" || code === "capability_removed";
  }

  var retried = {};
  function degrade(err) {
    var code = (err && err.code) || "upstream_error";
    darken(fixFor(code, (err && err.message) || "", C.server));
    if (code === "server_not_connected" || code === "selection_required" || code === "needs_reauth"
      || code === "not_granted" || code === "capability_disabled") {
      onboarding.removeAttribute("hidden");
    }
    // Retry only what a repeat can fix, and at most once per visible refresh.
    if (err && err.retryable === true && !neverRetry(code) && retried[code] !== true) {
      retried[code] = true;
      var wait = typeof err.retryAfterMs === "number" ? err.retryAfterMs : 1000;
      setTimeout(function () { void window.claude.mcp.invalidate(C.server, "loam_query"); }, wait);
    }
  }

  // The projection is a FIXED selection set on BOTH reads — never a field list. A gesture-chosen lens's
  // field names are legal()-mangled store-side and the page cannot know them; and _view is the whole
  // resolved view, which is exactly what the server host already hands the bundle. Asking for consumes
  // instead would hand the same bundle a strictly NARROWER view on one host.
  function document_for(lens, entity) {
    return "query { " + rootField(lens) + "(entity: " + JSON.stringify(entity) + ") { _entity _hex _view } }";
  }

  function payloadOf(result) {
    var p = result && result.payload;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (notJson) { return null; } }
    return p && typeof p === "object" ? p : null;
  }

  // A GraphQL refusal is the only evidence a store gives that it does not serve a lens: the document
  // named a query field the schema never built, so validation refuses it. That is not_served; anything
  // else the store answered and declined is refused.
  function readErrorOf(errors, lens) {
    var text = errors.map(function (e) { return typeof e === "string" ? e : (e && e.message) || ""; }).join("; ");
    // ANCHORED on the quoted field, never a bare substring. A derived name can be one character long —
    // lens A is served at field a, and a message naming an unknown SUBfield of AView contains
    // that letter inside the word "Cannot", so a substring probe reports not_served for a lens the store
    // DOES serve. The floor's four codes are what a bundle branches on across both hosts, so a miscoded
    // refusal is a cross-host divergence behind one content address.
    var named = text.indexOf('field "' + rootField(lens) + '"') >= 0;
    var unknownField = /Cannot query field/.test(text) && named;
    return { code: unknownField ? "not_served" : "refused", message: text };
  }

  // DID THE ROOT READING MOVE AT ALL? That, not "did a top-level key vanish", is the teardown trigger,
  // and the correction matters because a top-level key vanishing is NOT what erasure usually looks like:
  // a cleared prop under an absentAs(false) policy reads false rather than absent (§14), an all or
  // conflicts policy resolves to a LIST that merely gets shorter, and a nested value (a bytes envelope,
  // an object-typed resolver output) can lose a member with its outer key intact. A key-presence probe
  // sees none of those, and on a schema whose consumed props are all absentAs it is dead code.
  //
  // _hex is the content address of the WHOLE resolved view, so it moves for every one of those shapes.
  // Using it means the shell cannot tell an erasure from an ordinary write — and it does not need to: a
  // drilled-down reading fetched before the root moved is no longer known-good, so discarding it is
  // right either way. A poll that changes nothing leaves _hex equal and keeps the drill-downs a viewer
  // is looking at, which is the only thing that made the narrower probe attractive.
  //
  // WHAT THIS STILL DOES NOT REACH, named here because a comment is the only place a reader will find
  // it: an erasure at a DRILLED-DOWN entity while the root is untouched. A drill-down is a one-shot —
  // nothing ever re-reads that entity — so the root's _hex does not move and the entry survives. The
  // two ways to close it both change what §30 promises rather than repair it (re-issue every accumulated
  // read per poll, which the criteria that COUNT traffic would have to be re-decided; or expire the map
  // on a clock, a rule §30 does not state), so it is stated rather than chosen. lostView below is kept
  // as the belt for a store that serves no _hex.
  function rootMoved(beforeHex, afterHex, beforeView, afterView) {
    if (beforeHex === null) return false;
    if (typeof afterHex === "string" && typeof beforeHex === "string" && afterHex !== "") {
      return afterHex !== beforeHex;
    }
    return lostView(beforeView, afterView);
  }

  function lostView(before, after) {
    if (before === null) return false;
    for (var k in before) {
      if (!Object.prototype.hasOwnProperty.call(before, k)) continue;
      if (before[k] === undefined || before[k] === null) continue;
      if (after[k] === undefined || after[k] === null) return true;
    }
    return false;
  }

  function foldRoot(result) {
    var p = payloadOf(result);
    if (p === null) { degrade({ code: "tool_error", message: "the store returned no readable payload" }); return; }
    if (p.errors && p.errors.length > 0) { degrade({ code: "tool_error", message: readErrorOf(p.errors, C.lens).message }); return; }
    var node = p.data && p.data[rootField(C.lens)];
    if (!node) { degrade({ code: "tool_error", message: "the store served no view for the lens \\u201c" + C.lens + "\\u201d" }); return; }
    line.textContent = "";
    onboarding.setAttribute("hidden", "");
    retried = {};
    var view = node._view || {};
    if (
      rootMoved(root === null ? null : root.hex, node._hex, root === null ? null : root.view, view)
    ) {
      reads = {};
      state = {};
      // Bump the epoch too: a render in flight was composed from the map we just dropped.
      live += 1;
      void window.claude.mcp.invalidate(C.server, "loam_query");
    }
    root = { entity: node._entity, view: view, hex: node._hex };
    paint(nodeNow());
  }

  // A mediated read is an uncached ONE-SHOT, never a watch. A watch IS a cache by design (it replays a
  // stored entry on registration), its per-view ceiling is 64 and a duplicate registration is
  // bad_request — so watch-per-drill-down is a defect that arrives as a bug report about page 65. And
  // cache: false is a stronger statement than the gcTime: 0 a watch can express.
  function gesture(lens, entity, carried) {
    var key = lens + "@" + entity;
    for (var k in carried) { if (Object.prototype.hasOwnProperty.call(carried, k)) state[k] = carried[k]; }
    window.claude.mcp.callTool(C.server, "loam_query", { query: document_for(lens, entity) }, { cache: false }).then(
      function (result) {
        var p = payloadOf(result);
        if (p === null) { reads[key] = { error: { code: "refused", message: "the store returned no readable payload" } }; }
        else if (p.errors && p.errors.length > 0) { reads[key] = { error: readErrorOf(p.errors, lens) }; }
        else {
          var node = p.data && p.data[rootField(lens)];
          reads[key] = node
            ? { entity: node._entity, view: node._view || {}, hex: node._hex }
            : { error: { code: "not_served", message: "this store does not serve the lens \\u201c" + lens + "\\u201d" } };
        }
        if (reads[key].error) { line.textContent = fixFor("tool_error", reads[key].error.message, C.server); }
        rerender();
      },
      function (err) {
        var code = (err && err.code) || "upstream_error";
        reads[key] = { error: { code: floorCode(code), message: (err && err.message) || code } };
        line.textContent = fixFor(code, (err && err.message) || "", C.server);
        rerender();
      }
    );
  }

  function carriedFrom(el) {
    var out = {};
    var attrs = el.attributes || [];
    for (var i = 0; i < attrs.length; i += 1) {
      var name = attrs[i].name;
      if (name.indexOf("data-loam-") === 0 && name !== "data-loam-read" && name !== "data-loam-entity") {
        out[name.slice("data-loam-".length)] = attrs[i].value;
      }
    }
    return out;
  }

  // ONE interception seam, two verbs: a read gesture becomes loam_query, a <form> submit becomes
  // loam_mutate. The author wrote ordinary markup for both, and the same markup works unenhanced on the
  // server-rendered host.
  function onClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-loam-read]") : null;
    if (el === null || el.tagName === "FORM") return;
    ev.preventDefault();
    gesture(el.getAttribute("data-loam-read"), el.getAttribute("data-loam-entity") || C.entity, carriedFrom(el));
  }

  function onSubmit(ev) {
    var form = ev.target;
    if (!form || form.tagName !== "FORM") return;
    // Preventing default is not cosmetic: an un-intercepted form would attempt a cross-origin POST,
    // which CSP kills silently — a form that looks like it worked and did nothing.
    ev.preventDefault();
    var fields = {};
    var elements = form.elements || [];
    for (var i = 0; i < elements.length; i += 1) {
      var f = elements[i];
      if (f.name) fields[f.name] = f.value;
    }
    var lens = form.getAttribute("data-loam-read");
    if (lens !== null) {
      gesture(lens, fields[form.getAttribute("data-loam-entity-field") || "entity"] || C.entity, carriedFrom(form));
      return;
    }
    if (C.manifest.indexOf("loam_mutate") < 0) { line.textContent = "this page is read-only."; return; }
    // Only fields inside the ACKNOWLEDGED writable set. A receipt of the operator's decision, not a
    // boundary — so widening a v2 schema's writable cannot widen a page already emitted.
    var args = [];
    for (var name in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
      if (C.writable.indexOf(name) < 0) {
        line.textContent = "this page was not published to write \\u201c" + name + "\\u201d.";
        return;
      }
      // legalName, NOT rootField: gql.ts builds a per-prop mutation argument with legal(prop)
      // and no lowercasing, so a writable prop named Height is the argument Height. This is the one
      // site where the two manglings diverge.
      args.push(legalName(name) + ": " + JSON.stringify(fields[name]));
    }
    if (args.length === 0) { line.textContent = "the form wrote no fields."; return; }
    var doc = "mutation { " + rootField(C.lens) + "(entity: " + JSON.stringify(C.entity) + ", "
      + args.join(", ") + ") { _entity _hex _view } }";
    // A store REFUSAL arrives on the RESOLVED branch, not the rejected one: handleMcp answers a
    // GraphQL error as a 200 whose text block is { errors: [...] }, so a mutate the store declined
    // resolves exactly like one it accepted. Both read paths already inspect p.errors for this reason;
    // the write path did not, so a refused write and a successful write were byte-identical to a viewer
    // — no status line either way — on the one surface a viewer ACTS on. That is H7 at the page layer.
    window.claude.mcp.callTool(C.server, "loam_mutate", { mutation: doc }).then(
      function (result) {
        var p = payloadOf(result);
        if (p !== null && p.errors && p.errors.length > 0) {
          line.textContent = fixFor("tool_error", readErrorOf(p.errors, C.lens).message, C.server);
          return;
        }
        line.textContent = "saved.";
        void window.claude.mcp.invalidate(C.server, "loam_query");
      },
      function (err) { line.textContent = fixFor((err && err.code) || "upstream_error", (err && err.message) || "", C.server); }
    );
  }

  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);

  // The MEMBER check is the availability gate — never a probing call, and never gating render on a
  // permissions read equalling "granted". The static shell has already rendered, so a top-level
  // navigation (where window.claude is absent entirely) shows something legible rather than nothing.
  if (typeof window === "undefined" || !window.claude || !window.claude.mcp) {
    line.textContent = "this page is inert until it runs where a Loam connector can be reached.";
    return;
  }

  // EXACTLY ONE watch, for the root reading, with its cache pinned OFF. Zero gcTime is the only way to
  // express "keep nothing" — a watch takes no cache: false — and it must be written even though
  // staleTime 0 is the default, because the default that matters is the FIVE-MINUTE gcTime that comes
  // with readOnlyHint: true. Unpinned, a re-boot inside that window replays the last answer and paints
  // it: pre-erasure content on the viewer's side of the wall, where §11 cannot reach.
  window.claude.mcp.watchTool(
    C.server,
    "loam_query",
    { query: document_for(C.lens, C.entity) },
    function (ev) {
      if (ev.type === "data") { foldRoot(ev.result); return; }
      degrade(ev.error);
    },
    { refetchInterval: C.refetchInterval, cache: { staleTime: 0, gcTime: 0 } }
  );
})();`;
}

// The whole page. `capability` is the DERIVED statement (Recommendation 17) — it renders above the
// onboarding copy, because the page is inert until a connector exists, so "connect your store" IS the
// acceptance gesture and the statement sits in front of it.
export function artifactPage(args: {
  readonly coordinates: ArtifactCoordinates;
  readonly binding: RendererBinding;
  readonly capability: readonly string[];
}): string {
  const { coordinates: c, binding, capability } = args;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(binding.route)} — a Loam app</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem; }
#loam-capability { border-left: 3px solid currentColor; padding-left: .75rem; opacity: .85; }
#loam-capability li { margin: .15rem 0; }
#loam-onboarding[hidden] { display: none; }
#loam-writer, #loam-status { margin-top: 1rem; opacity: .8; font-size: .9em; }
</style>
</head>
<body>
<h1>${escapeHtml(binding.route)}</h1>
<section id="loam-capability" aria-label="what this app may read and write">
<ul>
${capability.map((s) => `<li>${escapeHtml(s)}</li>`).join("\n")}
</ul>
</section>
<section id="loam-onboarding">
<p><strong>Connect your store.</strong> This page reads and writes nothing until a Loam connector named
“${escapeHtml(c.server)}” is available to you. Add it in claude.ai Settings → Connectors,
pointing at your store’s MCP door:</p>
<p><code>${escapeHtml(c.storeAddress)}</code></p>
<p>A page with no connector is in its first run, not in a failure.</p>
</section>
<div id="loam-app"></div>
<p id="loam-writer">This page writes as <strong>you</strong> — your own author standing, in the store
your connector points at. It holds no key of its own and no pen: whatever the app above says about which
identity it writes under, this is the sentence that is true here.</p>
<p id="loam-status"></p>
<script type="application/json" id="loam-coordinates">${inlineJson(c)}</script>
<script type="application/json" id="loam-bundle">${inlineJson(binding.bundle)}</script>
<script>${shellSource()}</script>
</body>
</html>
`;
}

// Recover the bundle source a page carries — the inverse of the emission, used by the rail that asserts
// the recovered bytes content-address EQUAL to the binding's (§23.1's attestation held across the seam).
export function bundleFromPage(page: string): string | undefined {
  const m = /<script type="application\/json" id="loam-bundle">([\s\S]*?)<\/script>/.exec(page);
  if (m === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(m[1]!);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The coordinates a page carries — the same inverse, for a rail that reads them and for a harness that
// drives the page against a different store.
export function coordinatesFromPage(page: string): ArtifactCoordinates | undefined {
  const m = /<script type="application\/json" id="loam-coordinates">([\s\S]*?)<\/script>/.exec(
    page,
  );
  if (m === null) return undefined;
  try {
    return JSON.parse(m[1]!) as ArtifactCoordinates;
  } catch {
    return undefined;
  }
}
