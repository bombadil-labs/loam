// The MOUNT TABLE (SPEC §27 × the served doors, ticket T78) — which gateway answers at /:mount/*,
// asked per request instead of frozen at boot. A container is a Gateway over its own store, and
// §28's wall governs writes, law-reach and trust-crossing — never VISIBILITY; so a module ingested
// at runtime should serve its whole door set at its own mount without a restart.
//
// Three tiers, consulted in this order, and the order is the safety property:
//
//   1. STATIC — `serve({ mounts })`, the operator's boot-time word. Nothing displaces it.
//   2. DYNAMIC — `addMount(name, gateway)`, an explicit runtime mount, removable by name.
//   3. CONTAINERS — the ATTACHED container of any currently-mounted gateway, at its declared entity
//      name.
//
// Tier 3 is derived, never registered: it reads the host gateway's own attachment registry live, so
// `openContainer` mounting and `drop()`/`detach()` unmounting need no callback into the server — the
// two facts cannot drift, and a dropped container leaves no zombie gateway behind to serve. Being
// LAST, a container can never displace a name the operator already spoke for; the reverse asymmetry
// is real and one-sided (a container attached after an `addMount` of the same name is simply
// unreachable — it does not shadow), because the server does not own the `openContainer` call and
// cannot refuse it. `add` refuses any name that already resolves, tier included.
//
// A container is reachable only while its gateway is ALSO in the host's `quarantinePools` — the same
// two-question liveness check the erasure guard uses, so a half-removed attachment serves nothing.
// A SHARED container has no gateway of its own and never appears here (T32 criterion 6). And a
// container whose declared name is not ROUTABLE is skipped rather than half-served: the name rule
// below is the same for all three tiers, and `unroutable()` lists what it skipped so an operator can
// see why their module went nowhere — a silent drop would be the same lie as a phantom mount.
//
// A container mount carries the HOST as well as the container, because two questions have two
// owners: the container answers WHAT a caller reads, the host answers WHETHER a tokenless caller may
// read at all. The operator's `loam:public` declaration lives at the host and is revocable there;
// the container holds only a seeded COPY of it, frozen until the next reseed (§24.2), so gating the
// anonymous door on the pool's own answer would make a §12 revocation unrevocable at every container
// mount.
//
// The write doors are OPEN on a container mount, and that is a deliberate consequence rather than an
// oversight: an operator or actor token may POST /<container>/append or /register straight into the
// container's own store, bypassing its `admit`/`membership` (which govern the SEEDING edge, not the
// door). Nothing there exceeds what the same token can already do to the host — a container shares
// the host's operator by §24.1 — so this widens no authority; a container that needs its own
// identities is a later design, and until then the token table is the host's, whole.

import type { Gateway } from "../gateway/gateway.js";

// A mount name has to survive one round trip through a URL path segment, or the mount it names is
// unreachable — a door that reports success and opens nothing (H7's shape). Applied to the static
// table and to `addMount` alike, so "validated like a static one" is one function, not two.
export function mountNameDefect(name: string): string | undefined {
  if (name.length === 0) return "a mount name must not be empty — no URL path could reach it";
  if (name.includes("/")) {
    return `a mount name must not contain "/" — "${name}" could never route as one path segment`;
  }
  // No control character — NUL (the one character the container mint forbids in a name), and CR/LF
  // for the header-splitting reason every URL-adjacent name refuses them.
  if ([...name].some((ch) => ch.codePointAt(0)! < 0x20)) {
    return `a mount name must not contain a control character`;
  }
  // The router matches the DECODED segment, so a name carrying its own percent-escape would be
  // reached under a spelling nobody mounted. Refuse the confusion rather than serve it.
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
  /** The gateway that answers — a static/dynamic mount, or a container's own store. */
  readonly gateway: Gateway;
  /**
   * For a CONTAINER mount, the host whose operator governs it: the anonymous door is the host's live
   * decision (`loam:public` is revocable there), never the container's frozen copy. Absent for a
   * mount the operator named directly, where the gateway IS its own authority.
   */
  readonly host?: Gateway;
}

export interface MountTable {
  /** What answers at this mount name right now, or undefined — the routing question. */
  resolve(name: string): ResolvedMount | undefined;
  /** Mount a gateway at a free name. Refuses a malformed name or a name that already resolves. */
  add(name: string, gateway: Gateway): void;
  /**
   * Take a DYNAMIC mount down; true if one was there, false if the name was already free. Refuses a
   * static mount (boot's word) and a container's own mount (drop/detach owns that door) rather than
   * answering false — a caller told "nothing to remove" would believe a door shut that stands open.
   */
  remove(name: string): boolean;
  /**
   * Attached container names that no URL can reach, sorted — the visible half of skipping them. An
   * operator reads this to learn that a module they loaded is serving nowhere, and why.
   */
  unroutable(): string[];
}

export function makeMountTable(statics: Record<string, Gateway>): MountTable {
  // Own-property lookup only, on both maps: an attacker-supplied mount name can never resolve a
  // prototype member (`__proto__`, `constructor`) into a phantom gateway.
  const fixed = new Map(Object.entries(statics));
  for (const name of fixed.keys()) {
    const defect = mountNameDefect(name);
    if (defect !== undefined) throw new Error(`loam serve: ${defect}`);
  }
  const dynamic = new Map<string, Gateway>();

  // The hosts a container may be attached to: everything mounted above. Deterministic order —
  // static mounts in boot order, then dynamic in mount order — so two hosts holding the same
  // container name resolve the same way on every request rather than by iteration luck.
  const hosts = (): Gateway[] => [...fixed.values(), ...dynamic.values()];

  const containerAt = (name: string): ResolvedMount | undefined => {
    // The name rule binds every tier: a container may not answer at a spelling no static mount could
    // have been given. (Checked here rather than at attach — the server does not own openContainer.)
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
  };
}
