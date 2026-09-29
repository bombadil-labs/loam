// Which objects are real gateways, for a guard that must not trust a look-alike. A leaf module:
// the guard can ask without importing the gateway class, and so without joining its import cycle.
//
// The marker is handed out ONCE, to `gateway.ts` as it loads. Any later claim throws, so no other
// module can brand an object; a module that claimed first would make `gateway.ts` fail to load.

const real = new WeakSet<object>();
let claimed = false;

/** @internal — claimed by `gateway.ts` alone, at module load. */
export function claimGatewayMarker(): (gateway: object) => void {
  if (claimed) throw new Error("the gateway marker is already claimed");
  claimed = true;
  return (gateway) => void real.add(gateway);
}

export function isGateway(value: unknown): boolean {
  return typeof value === "object" && value !== null && real.has(value);
}
