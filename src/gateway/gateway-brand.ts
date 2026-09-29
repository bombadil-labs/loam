// Which objects are real gateways, for a guard that must not trust a look-alike. A leaf module:
// the guard can ask without importing the gateway class, and so without joining its import cycle.

const real = new WeakSet<object>();

/** @internal — the gateway constructor marks itself. */
export function markGateway(gateway: object): void {
  real.add(gateway);
}

export function isGateway(value: unknown): boolean {
  return typeof value === "object" && value !== null && real.has(value);
}
