// The surface seam (SPEC §17). GraphQL was never the surface; it was the first surface. A
// registration — (HyperSchema, Policy), filed as deltas — is interface-agnostic truth, and
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

import type { HyperSchema, Policy, Primitive, View } from "@bombadil/rhizomatic";
import type { ClaimTemplates } from "../gateway/registration.js";

// One registered lens, as a generator receives it: the schema, its resolution policy, the
// roots it holds live, and (optionally) the claim templates its mutations compile to.
export interface Registered {
  readonly schema: HyperSchema;
  readonly policy: Policy;
  readonly roots: readonly string[];
  readonly mutations?: ClaimTemplates;
}

// What flows from a root resolution to a door's field readers: one resolution, many reads.
// `hex` is the content address of the resolved view — the same value through EVERY door.
export interface ResolvedNode {
  readonly entity: string;
  readonly view: Record<string, View>;
  readonly hex: string;
  readonly hviewHex: string;
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
  resolve(schemaName: string, entity: string): ResolvedNode;
  mutate(
    schemaName: string,
    entity: string,
    props: Record<string, Primitive>,
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
