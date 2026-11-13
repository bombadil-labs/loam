import type { ChannelStatus } from "../federation/channel.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { openerStands } from "./container.js";
import { chainBreaksAt, readContainerTable, receivesNow } from "./container-law.js";

export function connectionStands(gateway: Gateway, binding: ConnectionBinding): boolean {
  const table = readContainerTable(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor);
  if (chainBreaksAt(table, binding.container) !== undefined) return false;
  return openerStands(gateway, { openedBy: binding.container, openedFrom: binding.inbox });
}

export function boundChannelAdmits(
  gateway: Gateway,
  binding: ConnectionBinding,
  channel: ChannelStatus,
): boolean {
  return (
    connectionStands(gateway, binding) &&
    channel.openedFrom === binding.inbox &&
    openerStands(gateway, channel) &&
    receivesNow(
      readContainerTable(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor),
      channel.into,
    )
  );
}
