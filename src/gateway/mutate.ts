import type { Peer } from "./peer.js";
import { seedSigner } from "./signer.js";
import { makeNegationClaims } from "@bombadil/rhizomatic";
import type { HVEntry, Primitive } from "@bombadil/rhizomatic";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { legalNameFor, queryFieldFor, type ClaimPointerSpec, type ResolvedNode } from "./gql.js";
import { edgeRoles, lensOf, referenceProps, type ReferenceProp } from "./registration.js";
import { delegatesEverOf, keysEverOf } from "./principal.js";
import { gatherPoolForRetraction, channelUsesUnboundGround } from "./reads.js";
import { attachedPool, bindingPeer, poolOwner } from "./container.js";
import { assertChannelSourceLegible } from "./reads.js";
import { declaredInboxes, readContainerTable } from "./container-law.js";
import { withStamp } from "./stamp.js";

function sinkFor(
  gw: Gateway,
  actorSeed: string | undefined,
  binding: ConnectionBinding | undefined,
): Peer {
  if (binding === undefined) return gw;
  if (actorSeed === undefined) {
    throw new Error(
      `a request bound to ${binding.inbox} names no actor, so it is refused — only the ` +
        `connection's own key writes into its inbox`,
    );
  }
  return bindingPeer(gw, binding);
}

export async function mutateEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  props: Record<string, Primitive>,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  const sink = sinkFor(gw, actorSeed, binding);
  const signer = actorSeed !== undefined ? seedSigner(actorSeed) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const entries = Object.entries(props);
  if (entries.length === 0) {
    throw new Error(`mutation of ${entity} names no properties to claim`);
  }
  assertNotReference(gw, name, Object.keys(props), binding);
  assertWritable(gw, name, Object.keys(props), binding);
  const author = signer.author;
  const stamp = gw.stamp(author);
  const deltas = entries.map(([prop, value]) =>
    signer.sign({
      ...stamp,
      author,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: entity, context: prop } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    }),
  );
  await sink.append(deltas);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

async function retract(
  gw: Gateway,
  name: string,
  entity: string,
  actorSeed: string | undefined,
  binding: ConnectionBinding | undefined,
  keep: (field: string, entry: HVEntry) => boolean,
): Promise<ResolvedNode> {
  const sink = sinkFor(gw, actorSeed, binding);
  const signer = actorSeed !== undefined ? seedSigner(actorSeed) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  gw.def(name, binding);
  const author = signer.author;
  const ownerCall = binding === undefined || ownerOf(bindingPeer(gw, binding)) === author;
  const pools =
    ownerCall && !channelUsesUnboundGround(gw, name, binding) ? ownedPools(gw, author) : [];
  for (const pool of pools) {
    if (channelUsesUnboundGround(gw, name, { container: pool.parent, inbox: pool.name })) {
      throw new Error(
        `${name}: this channel reading is outside owned inbox ${pool.name}'s retraction scope; refused before anything was signed`,
      );
    }
  }
  const hview = gw.gatherForRetraction(name, entity, binding);
  const mine = keysEverOf(gw.reactor, gw.validityNow(), { root: author }, gw.operatorAuthor);
  const targets = new Set<string>();
  for (const [field, entries] of hview.props) {
    for (const entry of entries) {
      if (mine.has(entry.delta.claims.author) && !entry.negated && keep(field, entry)) {
        targets.add(entry.delta.id);
      }
    }
  }
  if (targets.size > 0) {
    const stamp = gw.stamp(author);
    const negations = [...targets].map((id) =>
      signer.sign(withStamp(stamp, (t) => makeNegationClaims(author, t, id))),
    );
    await sink.append(negations);
  }
  const landed: string[] = [];
  const failed: string[] = [];
  for (const pool of pools) {
    const own = new Set([...mine, ...delegatesEverOf(pool.ground.reactor, mine, pool.name)]);
    const view = gatherPoolForRetraction(
      gw,
      name,
      entity,
      { container: pool.parent, inbox: pool.name },
      pool.ground,
    );
    const ids = new Set<string>();
    for (const [field, entries] of view.props) {
      for (const entry of entries) {
        const d = entry.delta;
        if (pool.ground.reactor.get(d.id) === undefined) continue;
        if (own.has(d.claims.author) && !entry.negated && keep(field, entry)) ids.add(d.id);
      }
    }
    if (ids.size === 0) continue;
    try {
      await pool.ground.strike([...ids], signer);
      landed.push(pool.name);
    } catch (err) {
      failed.push(`${pool.name} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `the retraction of ${entity} is partial: it landed in this store` +
        (landed.length === 0 ? "" : ` and in ${landed.join(", ")}`) +
        `, and failed in ${failed.join("; ")}. Run it again to finish; what is struck stays struck.`,
    );
  }
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

function ownerOf(pool: Peer): string | undefined {
  const owner = poolOwner(pool);
  return "refusal" in owner ? undefined : owner.key;
}

function ownedPools(
  gw: Gateway,
  author: string,
): { readonly name: string; readonly parent: string; readonly ground: Peer }[] {
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const out: { name: string; parent: string; ground: Peer }[] = [];
  const unreadable: string[] = [];
  for (const name of declaredInboxes(table)) {
    if (!name.startsWith("inbox:")) continue;
    const ground = attachedPool(gw, name);
    if (ground === undefined) {
      unreadable.push(`${name} (not attached)`);
      continue;
    }
    const owner = poolOwner(ground);
    if ("refusal" in owner) {
      unreadable.push(`${name} (${owner.refusal})`);
      continue;
    }
    if (owner.key === author)
      out.push({ name, parent: table.containers.get(name)!.inboxOf!, ground });
  }
  if (unreadable.length > 0) {
    throw new Error(
      `this retraction is refused before anything was signed: the inbox pools ` +
        `${unreadable.join(", ")} cannot be read here, and one of them might hold writes that are ` +
        `yours. Attach them, then run it again.`,
    );
  }
  return out;
}

export function clearEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  fields: readonly string[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  if (fields.length === 0) throw new Error(`clear of ${entity} names no fields to retract`);
  assertWritable(gw, name, fields, binding);
  const set = new Set(fields);
  return retract(gw, name, entity, actorSeed, binding, (field) => set.has(field));
}

export function removeEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  values: readonly Primitive[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  if (values.length === 0) {
    throw new Error(`remove from ${field} of ${entity} names no values to retract`);
  }
  assertWritable(gw, name, [field], binding);
  const wanted = new Set(values.map((v) => JSON.stringify(v)));
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === field &&
      entry.delta.claims.pointers.some(
        (p) =>
          p.role === "value" &&
          p.target.kind === "primitive" &&
          wanted.has(JSON.stringify(p.target.value)),
      ),
  );
}

const mintedRole = (roles: readonly string[], field: string): string | undefined =>
  roles.length === 1 ? roles[0] : roles.includes(field) ? field : undefined;

function edgeRoleFor(
  gw: Gateway,
  name: string,
  field: string,
  binding?: ConnectionBinding,
): string {
  const roles = edgeRoles(gw.def(name, binding).hyperschema.body);
  if (roles.length === 0) {
    throw new Error(
      `schema ${name} resolves no edges: its gather has no \`expand\`, so "${field}" takes a ` +
        `value, not a relation`,
    );
  }
  const role = mintedRole(roles, field);
  if (role === undefined) {
    throw new Error(
      `schema ${name} declares several edge roles (${roles.join(", ")}); wave A links a gather ` +
        `whose edge role is unambiguous for "${field}"`,
    );
  }
  return role;
}

export async function linkEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  target: string,
  context: string | undefined,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  const sink = sinkFor(gw, actorSeed, binding);
  const signer = actorSeed !== undefined ? seedSigner(actorSeed) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const def = gw.def(name, binding);
  if (!def.schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to link`);
  }
  const ref = referenceProps(def.hyperschema.body, def.refs).get(field);
  if (
    ref === undefined ||
    !ref.links ||
    ref.role !== mintedRole(edgeRoles(def.hyperschema.body), field)
  ) {
    assertWritable(gw, name, [field], binding);
  }
  const role = edgeRoleFor(gw, name, field, binding);
  const author = signer.author;
  const delta = signer.sign({
    ...gw.stamp(author),
    author,
    pointers: [
      { role: "subject", target: { kind: "entity", entity: { id: entity, context: field } } },
      {
        role,
        target: { kind: "entity", entity: { id: target, context: context ?? field } },
      },
    ],
  });
  await sink.append([delta]);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

export function severEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  targets: readonly string[] | undefined,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  if (!gw.def(name, binding).schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to sever`);
  }
  assertWritable(gw, name, [field], binding);
  const role = edgeRoleFor(gw, name, field, binding);
  const wanted = targets !== undefined && targets.length > 0 ? new Set(targets) : undefined;
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === field &&
      entry.delta.claims.pointers.some(
        (p) =>
          p.role === role &&
          p.target.kind === "entity" &&
          (wanted === undefined || wanted.has(p.target.entity.id)),
      ),
  );
}

function assertNotReference(
  gw: Gateway,
  name: string,
  fields: readonly string[],
  binding?: ConnectionBinding,
): void {
  const def = gw.def(name, binding);
  if (def.refs === undefined) return;
  const marked = referenceProps(def.hyperschema.body, def.refs);
  for (const field of fields) {
    const ref = marked.get(field);
    if (ref === undefined) continue;
    const pair = `link${queryFieldFor(lensOf(def))}_${legalNameFor(field)}`;
    throw new Error(
      `field "${field}" of ${name} is a reference (§51), never a primitive value: ` +
        (ref.links
          ? `link entities with the ${pair} / un${pair} mutations`
          : `its role family mints no single mutation — author the edge as an explicit _claim`),
    );
  }
}

function referencePropFor(
  gw: Gateway,
  name: string,
  prop: string,
  binding?: ConnectionBinding,
): ReferenceProp {
  const def = gw.def(name, binding);
  const ref = referenceProps(def.hyperschema.body, def.refs).get(prop);
  if (ref === undefined || !ref.links) {
    throw new Error(
      `schema ${name} declares no reference prop "${prop}" to link — a link mutation exists ` +
        `only for a prop named in the registration's \`refs\` with a single canonical role (§51)`,
    );
  }
  return ref;
}

export async function linkRefEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  prop: string,
  target: string,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  const sink = sinkFor(gw, actorSeed, binding);
  const signer = actorSeed !== undefined ? seedSigner(actorSeed) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const ref = referencePropFor(gw, name, prop, binding);
  const author = signer.author;
  const delta = signer.sign({
    ...gw.stamp(author),
    author,
    pointers: [
      {
        role: ref.role,
        target: {
          kind: "entity",
          entity: {
            id: target,
            ...(ref.reciprocal === undefined ? {} : { context: ref.reciprocal.context }),
          },
        },
      },
      {
        role: ref.reciprocal?.role ?? "subject",
        target: { kind: "entity", entity: { id: entity, context: prop } },
      },
    ],
  });
  await sink.append([delta]);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

export async function unlinkRefEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  prop: string,
  target: string,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  assertChannelSourceLegible(gw, name, binding);
  const ref = referencePropFor(gw, name, prop, binding);
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === prop &&
      entry.delta.claims.pointers.some(
        (p) => p.role === ref.role && p.target.kind === "entity" && p.target.entity.id === target,
      ),
  );
}

function assertWritable(
  gw: Gateway,
  name: string,
  fields: readonly string[],
  binding?: ConnectionBinding,
): void {
  const allowed = new Set(gw.def(name, binding).writable ?? []);
  for (const field of fields) {
    if (!allowed.has(field)) {
      throw new Error(
        `field "${field}" of ${name} is read-only: name it in the registration's \`writable\` ` +
          "list to open it for surface writes",
      );
    }
  }
}

export async function claimEntityImpl(
  gw: Gateway,
  pointers: readonly ClaimPointerSpec[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<{ delta: string }> {
  const sink = sinkFor(gw, actorSeed, binding);
  const signer = actorSeed !== undefined ? seedSigner(actorSeed) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  if (pointers.length === 0) {
    throw new Error("a claim carries at least one pointer");
  }
  const mapped = pointers.map((p, i) => {
    if (typeof p.role !== "string" || p.role === "") {
      throw new Error(`claim pointer ${i}: a pointer names a role`);
    }
    const hasAt = p.at !== undefined;
    const hasValue = p.value !== undefined;
    if (hasAt === hasValue) {
      throw new Error(`claim pointer ${i} ("${p.role}"): exactly one of at/value`);
    }
    if (hasAt) {
      if (p.at === "") {
        throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants an id`);
      }
      if (p.context === undefined || p.context === "") {
        throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants a context`);
      }
      return {
        role: p.role,
        target: { kind: "entity" as const, entity: { id: p.at, context: p.context } },
      };
    }
    return { role: p.role, target: { kind: "primitive" as const, value: p.value as Primitive } };
  });
  const delta = signer.sign({
    ...gw.stamp(signer.author),
    author: signer.author,
    pointers: mapped,
  });
  await sink.append([delta]);
  return { delta: delta.id };
}
