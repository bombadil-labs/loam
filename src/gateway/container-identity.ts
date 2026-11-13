import { contentAddress, type Delta } from "@bombadil/rhizomatic";

export interface ModuleVersion {
  readonly id: string;
  readonly members: readonly Delta[];
}

const addressOf = (memberIds: readonly string[]): string =>
  contentAddress(
    new TextEncoder().encode(`loam.container.v1\u0000${[...memberIds].sort().join("\u0000")}`),
  );

export function freezeMembers(members: readonly Delta[]): ModuleVersion {
  const frozen = Object.freeze([...members]);
  return Object.freeze({
    id: addressOf(frozen.map((d) => d.id)),
    members: frozen,
  });
}
