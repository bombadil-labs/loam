// A person's reach in the container tree (SPEC §40, §58): the container named exactly after them,
// every descendant by `parent` edge, and every pool (`inboxOf` — a connection's inbox, §39, or a
// channel's, §46) hanging off a reachable container. Two doors ask this question — the admin page
// for every act it gates, and the consent page for the containers it may offer as a binding — so
// the walk lives here, once.

import type { ContainerTable } from "../gateway/container.js";
import { CONTROL } from "./oauth-file.js";

/**
 * A fixpoint rather than one pass, because an edge can hang off a pool and the table's iteration
 * order guarantees nothing. Empty when no container bears the root's name.
 */
export function subtreeOf(table: ContainerTable, root: string): ReadonlySet<string> {
  const reach = new Set<string>();
  if (!table.containers.has(root)) return reach;
  reach.add(root);
  for (;;) {
    let grew = false;
    for (const [name, rec] of table.containers) {
      if (reach.has(name)) continue;
      const under =
        (rec.parent !== undefined && reach.has(rec.parent)) ||
        (rec.inboxOf !== undefined && reach.has(rec.inboxOf));
      if (under) {
        reach.add(name);
        grew = true;
      }
    }
    if (!grew) return reach;
  }
}

/**
 * A name a binding may carry: one the connector records will hold. The predicate IS the record's
 * own, so the page can never offer a name its store would then refuse to write. Declaration is
 * looser than this today; the binding is where the stricter shape is needed.
 */
export const isBindableName = (name: string): boolean => name.length > 0 && !CONTROL(name);

/**
 * The containers a binding may name (SPEC §58 position 1): the person's reach minus the home
 * itself and minus every pool — the two levels that are never bound, and the pools (a
 * connection's or a channel's) that receive into the reach — and minus any name the record could
 * not carry.
 * Sorted, so a page lists them stably.
 */
export function bindableOf(table: ContainerTable, root: string): string[] {
  return [...subtreeOf(table, root)]
    .filter(
      (name) =>
        name !== root && table.containers.get(name)?.inboxOf === undefined && isBindableName(name),
    )
    .sort();
}
