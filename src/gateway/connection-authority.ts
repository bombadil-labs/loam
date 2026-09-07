import type { ChannelStatus } from "../federation/channel.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { chainBreaksAt, openerStands, readContainerTable, receivesNow } from "./container.js";

/** An inbox can outlive its container; require the entire live parent chain too. */
export function connectionStands(gateway: Gateway, binding: ConnectionBinding): boolean {
  const table = readContainerTable(gateway.reactor, gateway.operatorAuthor);
  if (chainBreaksAt(table, binding.container) !== undefined) return false;
  return openerStands(gateway, { openedBy: binding.container, openedFrom: binding.inbox });
}

/** Check the caller independently of the channel's opener and current receive permission. */
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
