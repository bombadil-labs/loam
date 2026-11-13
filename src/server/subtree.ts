import { type ContainerTable } from "../gateway/container-law.js";
import { CONTROL } from "./oauth-file.js";

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

export const isBindableName = (name: string): boolean => name.length > 0 && !CONTROL(name);

export function bindableOf(table: ContainerTable, root: string): string[] {
  return [...subtreeOf(table, root)]
    .filter(
      (name) =>
        name !== root && table.containers.get(name)?.inboxOf === undefined && isBindableName(name),
    )
    .sort();
}
