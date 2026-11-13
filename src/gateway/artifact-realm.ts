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
  "navigator",
];

export function sealRealm(scope: object, channels: readonly string[]): string[] {
  const sealed: string[] = [];
  for (let i = 0; i < channels.length; i += 1) {
    const name = channels[i]!;
    if (!(name in scope)) continue;
    let took = false;
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
      } catch {}
    }
    if (!Object.prototype.hasOwnProperty.call(scope, name)) {
      try {
        Object.defineProperty(scope, name, {
          value: undefined,
          writable: false,
          configurable: true,
        });
        took = true;
      } catch {}
    }
    if (took && (scope as Record<string, unknown>)[name] === undefined) sealed.push(name);
  }
  return sealed;
}

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

export const realmProgram = (): string => REALM_SRC;
