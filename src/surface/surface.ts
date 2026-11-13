import type { HyperSchema, Schema, Primitive, View } from "@bombadil/rhizomatic";
import type { ConnectionBinding } from "../gateway/gateway.js";
import type { ClaimTemplates, RefSpecs, ResolverSpecs } from "../gateway/registration.js";

export interface Registered {
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly lensName?: string;
  readonly mutations?: ClaimTemplates;
  readonly writable?: readonly string[];
  readonly resolvers?: ResolverSpecs;
  readonly refs?: RefSpecs;
}

export interface ResolvedNode {
  readonly entity: string;
  readonly view: Record<string, View>;
  readonly hex: string;
  readonly hviewHex: string;
  readonly asOf?: number;
  readonly forgotten?: number[];
  readonly suppressed?: number;
}

export interface PatchNode extends ResolvedNode {
  readonly fromHex: string | null;
  readonly changed: readonly string[] | null;
}

export interface ClaimPointerSpec {
  readonly role: string;
  readonly at?: string;
  readonly context?: string;
  readonly value?: Primitive;
}

export interface SurfaceHooks {
  assertSource?(schemaName: string, binding?: ConnectionBinding): void;
  resolve(
    schemaName: string,
    entity: string,
    asOf?: number,
    binding?: ConnectionBinding,
  ): ResolvedNode;
  resolveRead?(
    schemaName: string,
    entity: string,
    asOf?: number,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  mutate(
    schemaName: string,
    entity: string,
    props: Record<string, Primitive>,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  clear(
    schemaName: string,
    entity: string,
    fields: readonly string[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  remove(
    schemaName: string,
    entity: string,
    field: string,
    values: readonly Primitive[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  link(
    schemaName: string,
    entity: string,
    field: string,
    target: string,
    context: string | undefined,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  sever(
    schemaName: string,
    entity: string,
    field: string,
    targets: readonly string[] | undefined,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  linkRef(
    schemaName: string,
    entity: string,
    prop: string,
    target: string,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  unlinkRef(
    schemaName: string,
    entity: string,
    prop: string,
    target: string,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode>;
  watch(schemaName: string, entity: string): AsyncGenerator<PatchNode>;
  claim(
    pointers: readonly ClaimPointerSpec[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<{ delta: string }>;
  list(
    schemaName: string,
    opts?: { limit?: number; after?: string },
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode[]>;
}

export type SurfaceProjection = "full" | "read";

export type SurfaceGenerator<Door> = (
  defs: readonly Registered[],
  hooks: SurfaceHooks,
  projection?: SurfaceProjection,
) => Door;
