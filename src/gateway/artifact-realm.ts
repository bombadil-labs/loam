// A CONFINED REALM FOR RUNNING SOMEBODY ELSE'S RENDERER.
//
// A renderer bundle is `(node) => string`, and a host that runs one has to decide what that code can
// reach. This module is the answer in two parts: the realm itself, and the seal over what the realm
// cannot discard on its own.
//
// THE REALM. A Worker global scope has no `window` and no `document`, so anything a page kernel installed
// on the page realm is absent by CONSTRUCTION rather than filtered — which is the difference between a
// boundary and a scrub, because a same-realm filter is beaten by any surviving reference, closure, or
// re-derivation. Spawned per render, so a bundle handed a fresh realm cannot hold a copy of anything
// across renders: there is nothing for it to hold the copy in.
//
// THE SEAL, and why the realm alone is not enough. That per-render lifetime is what makes discarding the
// realm a real teardown — and it does not reach everything. A worker global scope has no `localStorage`,
// which is what makes the realm look sufficient at a glance; it DOES have `indexedDB`, `caches`,
// `BroadcastChannel`, and (in a dedicated worker) `navigator.storage` — OPFS, persistent bytes. A bundle
// calling `indexedDB.open("keep")` holds a copy across every render and every teardown, in a store no
// erasure order can reach and no host can enumerate. So the boundary is two things, and the seal is the
// second.
//
// Unlike a page realm, nothing here is kernel-installed and the host needs none of it, so removing it is
// a removal rather than theatre.
//
// THE PROTOCOL mirrors `render-worker.ts` message for message — `{ bundle, node }` in, `{ kind: "ok",
// html }` / `{ kind: "notHtml" }` / `{ kind: "fault" }` back — so a fault folds to a clean refusal that
// leaks nothing of the bundle's internals. The extra `{ kind: "live" }` is a second clock's start gun: a
// slow spawn under a loaded tab must not charge startup against the render's budget.

// The channels a Worker realm carries that would SURVIVE its teardown, plus the doors to them. A worker
// global scope has no `window` and no `localStorage`, which is what makes the realm look sufficient at a
// glance — but `indexedDB`, `caches`, and `BroadcastChannel` are bare identifiers there, so
// `terminate()` alone does NOT empty the compartment: a bundle calling `indexedDB.open("keep")` holds a
// copy across every render and every teardown, in a store §11 cannot reach and the shell cannot
// enumerate. That is the one memory §11 was invoked to reach, so the boundary is TWO things — the
// per-render realm AND this seal, beneath the pack-time refusal that is its cheap half.
export const SEALED_CHANNELS: readonly string[] = [
  "indexedDB",
  "caches",
  "BroadcastChannel",
  "importScripts",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "self",
  "window",
  "document",
  // `navigator` was in the pack-time refusal set and NOT here, which left the widest hole of all: a
  // dedicated worker's `navigator.storage.getDirectory()` is OPFS — persistent bytes that survive
  // `terminate()`, in a store §11 cannot reach and the shell cannot enumerate. Exactly the class this
  // seal exists to close, reachable through an identifier the scan was already refusing, which is the
  // tell that the two halves had drifted apart.
  "navigator",
];

// Seal a realm: make every named channel `undefined` and non-writable, and report which ones were
// actually there to seal. Returns the sealed names so a caller can tell "nothing to do" from "done" —
// a seal that silently sealed nothing is the shape of a guard that has stopped guarding.
//
// UNLIKE THE PAGE REALM, this is a boundary rather than theatre. Filtering a locked, kernel-installed
// object the shell itself needs would be defeated by any surviving reference; here nothing is
// kernel-installed, the shell needs none of these, and the realm is discarded after one render anyway.
//
// WRITTEN TO BE SERIALIZED. The realm program below embeds this function's OWN SOURCE, so the code a
// rail exercises in Node is the code that runs in the worker — there is no second implementation to
// drift. It therefore takes its scope and its list as ARGUMENTS and closes over nothing.
export function sealRealm(scope: object, channels: readonly string[]): string[] {
  const sealed: string[] = [];
  for (let i = 0; i < channels.length; i += 1) {
    const name = channels[i]!;
    if (!(name in scope)) continue;
    let took = false;
    // WALK THE PROTOTYPE CHAIN. In a real worker these are WebIDL attributes on
    // `WorkerGlobalScope.prototype`, not own properties — so an own `undefined` SHADOWS the accessor
    // for a bare identifier and leaves `getOwnPropertyDescriptor(getPrototypeOf(globalThis), "…").get`
    // callable, which is a filter rather than a removal. Redefining wherever the property actually
    // lives is what makes it a removal. A flat scope with own data properties is the one shape in
    // which shadowing and removal look identical, so a rail must fabricate the chain to see this.
    for (
      let holder: object | null = scope;
      holder !== null;
      holder = Object.getPrototypeOf(holder) as object | null
    ) {
      if (!Object.prototype.hasOwnProperty.call(holder, name)) continue;
      try {
        Object.defineProperty(holder, name, {
          value: undefined,
          writable: false,
          configurable: true,
        });
        took = true;
      } catch {
        // A non-configurable global stays; the pack-time reference refusal is the other half.
      }
    }
    // …and an own shadow on the scope itself, so a name inherited from a holder we could not take
    // still resolves to undefined for a bare identifier.
    if (!Object.prototype.hasOwnProperty.call(scope, name)) {
      try {
        Object.defineProperty(scope, name, {
          value: undefined,
          writable: false,
          configurable: true,
        });
        took = true;
      } catch {
        /* nothing more to try */
      }
    }
    // Report only what is ACTUALLY gone. Claiming a seal we could not take is H7 at this layer.
    if (took && (scope as Record<string, unknown>)[name] === undefined) sealed.push(name);
  }
  return sealed;
}

// The confined realm's whole program. It runs in a Worker global scope — no `window`, no `document`,
// and therefore no `window.claude`: absent by CONSTRUCTION rather than filtered, which is the
// difference between a boundary and a scrub. Then it seals what a teardown would not reach.
//
// Its protocol is `render-worker.ts`'s, message for message: `{ bundle, node }` in, `{ kind: "ok", html }`
// / `{ kind: "notHtml" }` / `{ kind: "fault" }` back, so a fault folds to a clean refusal leaking nothing
// of the bundle's internals. The extra `{ kind: "live" }` is the second clock's start gun (T73): a slow
// spawn under a loaded tab must not charge startup against the render's budget.
const REALM_SRC = `${sealRealm.toString()}
var held = {
  post: self.postMessage.bind(self),
  url: URL.createObjectURL.bind(URL),
  Blob: Blob,
};
self.addEventListener("message", function (ev) {
  sealRealm(globalThis, ${JSON.stringify(SEALED_CHANNELS)});
  var data = ev.data || {};
  var mod;
  try {
    mod = import(held.url(new held.Blob([data.bundle], { type: "text/javascript" })));
  } catch (mountFailed) {
    held.post({ kind: "fault" });
    return;
  }
  mod.then(function (m) {
    // The bundle's own THROW has to be caught HERE. A throw inside a then-success callback does not
    // reach that same then's rejection handler — it rejects the derived promise, which nobody is
    // holding — so without this the realm posts NOTHING and a faulting bundle is indistinguishable
    // from a silent one: the shell recovers only when its render clock expires, seconds later.
    try {
      var fn = m && m.default;
      if (typeof fn !== "function") { held.post({ kind: "notHtml" }); return; }
      var html = fn(data.node);
      if (typeof html !== "string") { held.post({ kind: "notHtml" }); return; }
      held.post({ kind: "ok", html });
    } catch (threwInside) {
      held.post({ kind: "fault" });
    }
  }, function (threw) { held.post({ kind: "fault" }); });
});
held.post({ kind: "live" });`;

// The realm program as the page carries it — exported so a rail can read the bytes that will run
// rather than a paraphrase of them.
export const realmProgram = (): string => REALM_SRC;
