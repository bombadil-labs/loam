/** Exact experimental law operands. Source identity/completeness are caller assertions;
 * a manifest hash authenticates only its declared members. No capture, signer or cache. */
import {
  Reactor,
  evalTerm,
  HYPER_SCHEMA_SCHEMA,
  SCHEMA_SCHEMA,
  type Delta,
  type Term,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "./container-identity.js";
import { withNegationClosure } from "./ingest.js";
import {
  lawfulNegated,
  lawfulSnapshot,
  lensOf,
  readRegistrations,
  type Registration,
} from "./registration.js";
interface Selection {
  source: string;
  registrationId: string;
  memberIds: string[];
  versionId: string;
}
interface Binding {
  source?: string;
  sourceAuthor?: string;
  entity?: string;
  reading: string;
}
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && !v.includes("\0");
function manifest(value: unknown): Selection | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  if (
    Object.keys(s).length !== 4 ||
    ![s.source, s.registrationId, s.versionId].every(nonempty) ||
    !Array.isArray(s.memberIds) ||
    !s.memberIds.every(nonempty) ||
    new Set(s.memberIds).size !== s.memberIds.length
  )
    return undefined;
  return s as unknown as Selection;
}
function fromMembers(members: readonly Delta[]): Reactor {
  const r = new Reactor();
  // The caller verified EVERY input before deduplication; these are only held members.
  for (const d of members)
    if (r.ingest(d).status === "rejected") throw new Error("member rejected");
  return r;
}
function definitionId(r: Reactor, author: string, entity: string, body: Term): string {
  const rows = evalTerm(body, lawfulSnapshot(r, author), entity);
  if (rows.sort !== "hview") throw new Error("bootstrap sort");
  const definitions = rows.hview.props.get("definition") ?? [];
  const selected = [...definitions].sort(
    (a, b) =>
      b.delta.claims.timestamp - a.delta.claims.timestamp ||
      (a.delta.id < b.delta.id ? -1 : a.delta.id > b.delta.id ? 1 : 0),
  )[0];
  if (selected === undefined) throw new Error("missing definition");
  return selected.delta.id;
}
export function selectReceivingSnapshot(
  source: Reactor,
  binding: Binding,
  value: unknown,
  paused: boolean,
):
  | { status: "selected"; registration: Registration; operand: Reactor }
  | { status: "invalid-selection" | "unavailable" } {
  const s = manifest(value);
  if (s === undefined || s.source !== binding.source) return { status: "invalid-selection" };
  const members: Delta[] = [];
  for (const id of s.memberIds) {
    const d = source.get(id);
    if (d === undefined) return { status: "invalid-selection" };
    members.push(d);
  }
  if (freezeMembers(members).id !== s.versionId) return { status: "invalid-selection" };
  const original = fromMembers(members);
  const candidates = readRegistrations(original, binding.sourceAuthor).filter(
    (r) => r.entity === binding.entity && lensOf(r) === binding.reading,
  );
  if (candidates.length !== 1 || candidates[0]!.boundId !== s.registrationId)
    return { status: "invalid-selection" };
  const selected = candidates[0]!;
  const claims = original.get(s.registrationId)!.claims;
  const schemaRef = claims.pointers.find((p) => p.role === "schemaVersion")?.target;
  if (claims.author !== binding.sourceAuthor || schemaRef?.kind !== "entity")
    return { status: "invalid-selection" };
  // Derive authority identities BEFORE adding any forward strikes. Equal-content older
  // definitions cannot substitute for a withdrawn selected authorial act.
  const pinnedIds = [
    s.registrationId,
    definitionId(original, binding.sourceAuthor, binding.entity!, HYPER_SCHEMA_SCHEMA.body),
    definitionId(original, binding.sourceAuthor, schemaRef.entity.id, SCHEMA_SCHEMA.body),
  ];
  if (paused) {
    const closed = fromMembers(withNegationClosure({ reactor: source }, members));
    const negated = lawfulNegated(closed, binding.sourceAuthor);
    if (pinnedIds.some(negated)) return { status: "unavailable" };
  }
  return { status: "selected", registration: selected, operand: original };
}
