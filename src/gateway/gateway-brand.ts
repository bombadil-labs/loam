const real = new WeakSet<object>();
let claimed = false;

export function claimGatewayMarker(): (gateway: object) => void {
  if (claimed) throw new Error("the gateway marker is already claimed");
  claimed = true;
  return (gateway) => void real.add(gateway);
}

export function isGateway(value: unknown): boolean {
  return typeof value === "object" && value !== null && real.has(value);
}
