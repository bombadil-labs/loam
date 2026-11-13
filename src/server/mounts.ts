import type { Gateway } from "../gateway/gateway.js";

function mountNameDefect(name: string): string | undefined {
  if (name.length === 0) return "a mount name must not be empty — no URL path could reach it";
  if (name.includes("/")) {
    return `a mount name must not contain "/" — "${name}" could never route as one path segment`;
  }
  if ([...name].some((ch) => ch.codePointAt(0)! < 0x20)) {
    return `a mount name must not contain a control character`;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return `a mount name must not carry a percent-escape — "${name}" is not one a router matches`;
  }
  if (decoded !== name) {
    return (
      `a mount name must not carry a percent-escape — "${name}" would be reached as "${decoded}", ` +
      `a spelling it was never mounted under`
    );
  }
  return undefined;
}

export interface ResolvedMount {
  readonly gateway: Gateway;

  readonly host?: Gateway;
}

export interface MountTable {
  resolve(name: string): ResolvedMount | undefined;
  add(name: string, gateway: Gateway): void;

  remove(name: string): boolean;

  unroutable(): string[];

  live(): string[];
}

export function makeMountTable(statics: Record<string, Gateway>): MountTable {
  const fixed = new Map(Object.entries(statics));
  for (const name of fixed.keys()) {
    const defect = mountNameDefect(name);
    if (defect !== undefined) throw new Error(`loam serve: ${defect}`);
  }
  const dynamic = new Map<string, Gateway>();

  const hosts = (): Gateway[] => [...fixed.values(), ...dynamic.values()];

  const containerAt = (name: string): ResolvedMount | undefined => {
    if (mountNameDefect(name) !== undefined) return undefined;
    for (const host of hosts()) {
      const attached = host.attachedContainers.get(name);
      if (attached !== undefined && host.quarantinePools.has(attached)) {
        return { gateway: attached, host };
      }
    }
    return undefined;
  };

  const named = (gateway: Gateway | undefined): ResolvedMount | undefined =>
    gateway === undefined ? undefined : { gateway };

  const resolve = (name: string): ResolvedMount | undefined =>
    named(fixed.get(name)) ?? named(dynamic.get(name)) ?? containerAt(name);

  return {
    resolve,
    add(name, gateway) {
      const defect = mountNameDefect(name);
      if (defect !== undefined) throw new Error(`addMount refused: ${defect}`);
      if (resolve(name) !== undefined) {
        throw new Error(
          `addMount refused: "${name}" already answers here — a mount is a whole world, and ` +
            `replacing one silently would re-point every live consumer of that name`,
        );
      }
      dynamic.set(name, gateway);
    },
    remove(name) {
      if (fixed.has(name)) {
        throw new Error(
          `removeMount refused: "${name}" is a static mount, named at serve() — boot's word is ` +
            `not revocable at runtime`,
        );
      }
      if (!dynamic.has(name) && containerAt(name) !== undefined) {
        throw new Error(
          `removeMount refused: "${name}" is an attached container's own mount — its door lives ` +
            `and dies with the container, so drop() or detach() it instead`,
        );
      }
      return dynamic.delete(name);
    },
    unroutable() {
      const names = new Set<string>();
      for (const host of hosts()) {
        for (const [name, attached] of host.attachedContainers) {
          if (mountNameDefect(name) !== undefined && host.quarantinePools.has(attached)) {
            names.add(name);
          }
        }
      }
      return [...names].sort();
    },
    live() {
      const names = new Set<string>([...fixed.keys(), ...dynamic.keys()]);
      for (const host of hosts()) {
        for (const [name, attached] of host.attachedContainers) {
          if (mountNameDefect(name) === undefined && host.quarantinePools.has(attached)) {
            names.add(name);
          }
        }
      }
      return [...names].sort();
    },
  };
}
