// The surface seam (SPEC §17). GraphQL was never the surface; it was the first surface. A
// registration — (HyperSchema, Schema), filed as deltas — is interface-agnostic truth, and
// every door a store answers through is a MATERIALIZATION derived from it. This module is
// that seam, published exactly as the store seam is (src/store/backend.ts): the gateway owns
// STATE and provides these hooks; a generator owns SHAPE and derives a door; every generator
// is an interchangeable witness to the registrations.
//
// Doors share one law. The hooks are the only way through — resolve/mutate/watch/claim all
// run the gateway's own authorization, admission, and tombstone discipline — so a generator
// CANNOT invent authority or widen a projection; it can only narrow one (a read-only door
// passes "read"). Two doors that disagree about lawful data are a bug by definition; the
// contract test for any new generator is agreement with the doors that already exist — one
// ground, one registration, the same view, _hex for _hex.

import type { HyperSchema, Schema, Primitive, View } from "@bombadil/rhizomatic";
import type { ClaimTemplates } from "../gateway/registration.js";

// One registered lens, as a generator receives it: the hyperschema (gather), its resolution
// schema, the roots it holds live, and (optionally) the claim templates its mutations compile to.
export interface Registered {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly mutations?: ClaimTemplates;
  // Front-door writability (SPEC §14, immutable-by-default): the fields that accept a surface write;
  // the rest are read-only (assert / clear / remove / link / sever refused). Absent → NO field is
  // writable (§21's deny-by-default posture).
  readonly writable?: readonly string[];
}

// What flows from a root resolution to a door's field readers: one resolution, many reads.
// `hex` is the content address of the resolved view — the same value through EVERY door.
export interface ResolvedNode {
  readonly entity: string;
  readonly view: Record<string, View>;
  readonly hex: string;
  readonly hviewHex: string;
  // The time pin (SPEC §26): present only on an AS-OF read — the moment T this view was
  // resolved against ("the ground as it stood at T"). Absent on a present-tense read, which is
  // the live materialization by construction. It rides the response beside `hex`, never inside
  // the resolved data.
  readonly asOf?: number;
  // The erasure annotation (SPEC §26/§11): on an as-of read, the sorted timestamps at which this
  // ground lawfully forgot something SINCE the moment T — an erasure spoken after T may have
  // redacted a fact that stood at T, so the read confesses each discontinuity's moment (never the
  // content: a tombstone remembers THAT it forgot and WHEN, not what; the count is their length).
  // Absent on a present read (the present already reflects every erasure as ordinary absence).
  readonly forgotten?: number[];
}

// A subscription event: the re-resolved node plus where it came from and what moved.
export interface PatchNode extends ResolvedNode {
  readonly fromHex: string | null; // null on the initial snapshot
  readonly changed: readonly string[] | null; // null on the initial snapshot
}

// One concrete pointer of a claim, as a door hands it to the gateway: either an entity
// pointer (at + context) or a primitive (value) — never both, never neither.
export interface ClaimPointerSpec {
  readonly role: string;
  readonly at?: string;
  readonly context?: string;
  readonly value?: Primitive;
}

// The hooks the gateway provides to every generator. Nothing here speaks any interface's
// language: resolve answers a view, mutate compiles a write to a signed claim through the
// door discipline, watch streams re-resolutions, claim lands raw signed pointers. The
// GATEWAY owns all four; a door only translates its dialect into these calls.
export interface SurfaceHooks {
  // Resolve a view at an entity. An optional `asOf` (SPEC §26) reads a MOMENT: the ground as it
  // stood at timestamp T, resolved by the same program — omit it and the read is present-tense.
  resolve(schemaName: string, entity: string, asOf?: number): ResolvedNode;
  mutate(
    schemaName: string,
    entity: string,
    props: Record<string, Primitive>,
    actorSeed?: string,
  ): Promise<ResolvedNode>;
  // Clearing is retraction (SPEC §14): negate the caller's OWN surviving contributions to each
  // named field, so it resolves to what survives — the next pick, the remaining tags, the
  // withdrawn addend — or, if the caller was its only voice, to absence (rendered per absentAs).
  // Retract-your-own is the whole reach: a clear never touches a delta the caller did not author.
  clear(
    schemaName: string,
    entity: string,
    fields: readonly string[],
    actorSeed?: string,
  ): Promise<ResolvedNode>;
  // Remove ONE value (SPEC §14 amendment): retract only the caller's own contribution(s) to `field`
  // whose claimed value is one of `values` — the rest of the field, theirs and everyone's, stands.
  remove(
    schemaName: string,
    entity: string,
    field: string,
    values: readonly Primitive[],
    actorSeed?: string,
  ): Promise<ResolvedNode>;
  // Link an edge (SPEC §14 edge verbs): assert an edge delta — the same per-prop shape as a write,
  // but its value pointer targets an ENTITY, followed by the gather's `expand` into the child's
  // view. Pure sugar over `assert`; offered only for a field whose schema declares an edge role.
  link(
    schemaName: string,
    entity: string,
    field: string,
    target: string,
    context: string | undefined,
    actorSeed?: string,
  ): Promise<ResolvedNode>;
  // Sever an edge (SPEC §14 edge verbs): retract YOUR OWN edge deltas in `field` — all of them, or
  // only those pointing at one of `targets`. Pure sugar over `retract`; the dual of link.
  sever(
    schemaName: string,
    entity: string,
    field: string,
    targets: readonly string[] | undefined,
    actorSeed?: string,
  ): Promise<ResolvedNode>;
  watch(schemaName: string, entity: string): AsyncGenerator<PatchNode>;
  claim(pointers: readonly ClaimPointerSpec[], actorSeed?: string): Promise<{ delta: string }>;
}

// A projection is a door's capability posture (SPEC §17): "full" derives reads and writes;
// "read" derives a smaller world — narrowing is a generator's right, widening never is.
export type SurfaceProjection = "full" | "read";

// The seam itself: a generator derives a door (of whatever type — a GraphQLSchema, an OpenAPI
// document + router, a compiled artifact) from the registrations and the hooks. buildGqlSchema
// (src/gateway/gql.ts) is the first witness; the REST door is the second.
export type SurfaceGenerator<Door> = (
  defs: readonly Registered[],
  hooks: SurfaceHooks,
  projection?: SurfaceProjection,
) => Door;
