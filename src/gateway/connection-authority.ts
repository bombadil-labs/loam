import type { ChannelStatus } from "../federation/channel.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { chainBreaksAt, openerStands, readContainerTable, receivesNow } from "./container.js";

/**
 * Does this connection still stand? TWO QUESTIONS, NOT ONE, and every road that acts on a
 * binding's authority asks both.
 *
 * `openerStands` proves the inbox pool is attached and that the write grant in it survives. It
 * says nothing about the CONTAINER, and a pool outlives the container it was bound under: dropping
 * a shared container strikes that container's declarations and leaves the pool declared and
 * attached. A connection whose container was dropped must not act — least of all through a walk
 * that declares missing levels, which would re-declare the container the person just dropped, with
 * the store's own key, at the request of the party the drop was aimed at.
 */
export function connectionStands(gateway: Gateway, binding: ConnectionBinding): boolean {
  const table = readContainerTable(gateway.reactor, gateway.operatorAuthor);
  // THE WHOLE CHAIN, NOT THE NAME. A shared drop strikes only the container it names, so a
  // descendant keeps its own declaration and stands alone: absent from every parent-edge walk the
  // person's pages make, and reachable only by the connection bound to it. Asking the chain means
  // dropping a container ends the connections bound beneath it too, which is what a person
  // dropping a room expects.
  if (chainBreaksAt(table, binding.container) !== undefined) return false;
  return openerStands(gateway, { openedBy: binding.container, openedFrom: binding.inbox });
}

/**
 * May this bound connection see or act on THIS channel? THE CONNECTION FIRST, THE CHANNEL SECOND.
 * `openerStands` weighs the CHANNEL's opener against its pool; it says nothing about whether the
 * container this connection is bound to still stands. A channel's own `into` survives its
 * container's drop, so without the first conjunct a dropped connection could still flip a channel
 * back on and keep pulling a peer's data into the subtree the person removed.
 */
export function boundChannelAdmits(
  gateway: Gateway,
  binding: ConnectionBinding,
  channel: ChannelStatus,
): boolean {
  return (
    connectionStands(gateway, binding) &&
    channel.openedFrom === binding.inbox &&
    openerStands(gateway, channel) &&
    receivesNow(readContainerTable(gateway.reactor, gateway.operatorAuthor), channel.into)
  );
}
