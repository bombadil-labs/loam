// GraphQL derived from (HyperSchema, Schema) — not reflected from the data. The policy is the
// contract: its props name the fields, and each Policy's kind names the field's shape
// (pick → one value; all/conflicts → a list; merge → its reduction's type; absentAs → the
// pass-through scalar, because its primitive constant and its inner policy's shape need not
// agree). Values pass through the ViewValue scalar untyped-but-faithful — a resolved View is
// already the policy's adjudicated answer, and nested expansions ride through it as objects.
// A name that would collide — two schemas, two props, or a prop against a built-in — is
// refused at build time, never silently shadowed.
//
// Three operations per registered schema: a query field (resolve once → snapshot), a mutation
// field (one argument per policy prop; each provided argument becomes a signed property claim;
// the response is the re-resolved view), and a subscription field (an initial snapshot, then a
// patch per relevant change: `_fromHex → _hex` + `_changed`). Every view carries `_entity`,
// `_hex` (the content-addressed snapshot), and `_view` (the whole resolved view).

import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  type GraphQLFieldConfigMap,
  type GraphQLInputType,
  type GraphQLOutputType,
} from "graphql";
import type { Primitive, Policy } from "@bombadil/rhizomatic";
import { isWithheldResolver } from "./adopt-law.js";
import type { ConnectionBinding } from "./gateway.js";
import { bytesEnvelope } from "./bytes.js";
import {
  lensOf,
  edgeRoles,
  referenceProps,
  type ClaimTemplates,
  type ResolverOutputType,
} from "./registration.js";
import type {
  ClaimPointerSpec,
  PatchNode,
  Registered,
  ResolvedNode,
  SurfaceGenerator,
  SurfaceHooks,
  SurfaceProjection,
} from "../surface/surface.js";

// The shared surface vocabulary lives at the seam (SPEC §17, src/surface/surface.ts); this
// module is the seam's FIRST WITNESS — GraphQL as one materialization among peers. The
// re-exports keep every existing import path standing; `GqlHooks` stays as the historical
// name of what the seam calls SurfaceHooks.
export type {
  ClaimPointerSpec,
  PatchNode,
  Registered,
  ResolvedNode,
  SurfaceHooks as GqlHooks,
} from "../surface/surface.js";

// The request context a door supplies (`RequestContext`): the acting seed and, for a §58
// connection, its binding. Read leniently — a door that passes nothing acts as the operator.
const contextOf = (ctx: unknown): { actor?: string; binding?: ConnectionBinding } =>
  (ctx as { actor?: string; binding?: ConnectionBinding } | undefined) ?? {};

// The pass-through output scalar: a resolved View value — primitive, list, or nested object —
// exactly as the policy adjudicated it. One transformation only (SPEC §23.7): a BytesView anywhere in
// the value (a bytes leaf, or one nested in a list/object) becomes the self-describing { mime, ref,
// base64url? } envelope — raw bytes are not JSON, and this is the value-level detection that fires for
// ANY bytes leaf, whether or not the field was declared `bytes`. Everything else passes through as-is.
const ViewValue = new GraphQLScalarType({
  name: "ViewValue",
  description: "A resolved view value — primitive, list, nested view, or a bytes envelope (§23.7).",
  serialize: (v) => bytesEnvelope(v),
});

// The type-level face of a bytes field (SPEC §23.7): a field DECLARED `bytes` (a §22.6 resolver output
// type) is typed BytesValue so a consumer knows it is bytes from the schema, not by inspecting a value.
// Serialization is the same envelope — the two knowings are independent, the transformation is one.
const BytesValue = new GraphQLScalarType({
  name: "BytesValue",
  description:
    "A bytes value (§23.7): { mime, ref, base64url? } — fetch raw bytes at /bytes/<ref>.",
  serialize: (v) => bytesEnvelope(v),
});

// The write-side input scalar: exactly a rhizomatic Primitive.
const PrimitiveValue = new GraphQLScalarType({
  name: "PrimitiveValue",
  description: "A claimable value: string, number, or boolean.",
  serialize: (v) => v,
  parseValue: (v) => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    throw new Error("a property value must be a string, number, or boolean");
  },
  parseLiteral: (ast) => {
    switch (ast.kind) {
      case Kind.STRING:
        return ast.value;
      case Kind.INT:
        return parseInt(ast.value, 10);
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.BOOLEAN:
        return ast.value;
      default:
        throw new Error("a property value must be a string, number, or boolean literal");
    }
  },
});

// THERE ARE TWO MANGLINGS AND THEY DIFFER BY ONE CHARACTER. Both are exported, because a caller
// composing a document from store-native names needs BOTH and needs to know which goes where — and a
// caller carrying only one of them will spell one of the two sites wrong for exactly the names whose
// initial is an uppercase ASCII letter. Nothing else about them diverges.
//
//   `legalNameFor`  — a GraphQL-legal name. Used for the VIEW TYPE, every PROP FIELD, and every
//                     per-prop MUTATION ARGUMENT. `Height` stays `Height`.
//   `queryFieldFor` — the same, then initial-lowercased. Used for the QUERY-ROOT and MUTATION-ROOT
//                     field of a lens. Lens `Plant` is served at field `plant`.
//
// The original store-native name stays in the resolver closure either way.
export const legalNameFor = (s: string): string => {
  const cleaned = s.replace(/[^_A-Za-z0-9]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
};
const legal = legalNameFor;

// The QUERY-ROOT and MUTATION-ROOT field name for a lens: legal, then initial-lowercased. Exported
// because it is not derivable by eye — a caller composing a document from a lens NAME needs exactly
// this, and `Plant` (the VIEW TYPE's name) is not it. Anything that composes a document against a lens
// must route through here or it will name a field the schema never built.
export const queryFieldFor = (lens: string): string =>
  legalNameFor(lens).replace(/^[A-Z]/, (c) => c.toLowerCase());

function fieldTypeOf(pp: Policy): GraphQLOutputType {
  switch (pp.kind) {
    case "pick":
      return ViewValue;
    case "all":
    case "conflicts":
      return new GraphQLList(new GraphQLNonNull(ViewValue));
    case "merge":
      switch (pp.fn) {
        case "count":
          return GraphQLInt;
        case "sum":
          return GraphQLFloat;
        case "and":
        case "or":
          return GraphQLBoolean;
        case "concatSorted":
          return new GraphQLList(new GraphQLNonNull(ViewValue));
        case "max":
        case "min":
          return ViewValue; // any primitive kind may win
      }
      break;
    case "absentAs":
      // The constant is a bare primitive; the inner policy may be list-shaped. The only type
      // that honestly covers both outcomes is the pass-through.
      return ViewValue;
  }
}

// The meta fields every node type carries, parameterized over the node flavor.
function metaFields<N extends ResolvedNode>(): GraphQLFieldConfigMap<N, unknown> {
  return {
    _entity: {
      type: new GraphQLNonNull(GraphQLID),
      description: "The root entity this view is about.",
      resolve: (node) => node.entity,
    },
    _hex: {
      type: new GraphQLNonNull(GraphQLString),
      description: "The content address of the resolved view — the snapshot, the answer.",
      resolve: (node) => node.hex,
    },
    _hviewHex: {
      type: new GraphQLNonNull(GraphQLString),
      description:
        "The content address of the gathered hyperview — the evidence before any policy. " +
        "Two lenses over the same body and root share it while their _hex may differ. " +
        "On live streams, frames are emitted when the ANSWER moves — between frames the " +
        "evidence may have grown without changing it; query for the current value.",
      resolve: (node) => node.hviewHex,
    },
    _view: {
      type: new GraphQLNonNull(ViewValue),
      description: "The whole resolved view, dynamic properties included.",
      resolve: (node) => node.view,
    },
    _asOf: {
      // A timestamp is milliseconds — beyond Int32 — so Float is the honest carrier.
      type: GraphQLFloat,
      description:
        "The time pin (SPEC §26): the moment T this view was resolved against, on an AS-OF " +
        "read; null on a present-tense read (the live materialization by construction).",
      resolve: (node) => node.asOf ?? null,
    },
    _forgotten: {
      type: new GraphQLList(new GraphQLNonNull(GraphQLFloat)),
      description:
        "The erasure annotation (SPEC §26/§11): on an as-of read, the sorted timestamps at which " +
        "this ground lawfully forgot something SINCE the moment T — each moment flags a " +
        "discontinuity where this reconstruction of the past may be missing a since-erased fact " +
        "(the content stays forgotten; only THAT and WHEN an erasure fell in the window is " +
        "revealed; the count is the list's length). Null on a present read.",
      resolve: (node) => node.forgotten ?? null,
    },
  };
}

// A resolved field's GraphQL type comes from the resolver's DECLARED output type (SPEC §22.6), not
// the Policy — a resolver changes what the value IS, so the door must advertise the field it actually
// serves. The tags map to the honest GraphQL carriers; `bytes` types the §23.7 envelope, `object` and
// the pass-through fall to ViewValue, exactly as a policy-shaped dynamic value already does.
function resolverTypeOf(type: ResolverOutputType): GraphQLOutputType {
  switch (type) {
    case "string":
      return GraphQLString;
    case "number":
      return GraphQLFloat;
    case "boolean":
      return GraphQLBoolean;
    case "list":
      return new GraphQLList(new GraphQLNonNull(ViewValue));
    case "bytes":
      return BytesValue;
    case "object":
      return ViewValue;
  }
}

/** What a withheld field says when it is asked — the state, and the act that clears it. */
const withheldReason = (def: Registered, prop: string): string =>
  `"${prop}" on "${lensOf(def)}" is computed by RESOLVER CODE this store has not been told to ` +
  "run. Law that arrives on a federation channel binds a NAME; running the code behind a computed " +
  "field is a second decision (§24.6). Until it is taken, this field has no honest value to give: " +
  `\`loam federate bless-app --channel <name> --resolvers "${lensOf(def)}"\` is the act that ` +
  "supplies one.";

function propFields<N extends ResolvedNode>(def: Registered): GraphQLFieldConfigMap<N, unknown> {
  const fields: GraphQLFieldConfigMap<N, unknown> = {};
  for (const [prop, pp] of def.schema.props) {
    const resolver = def.resolvers?.[prop];
    // A WITHHELD RESOLVER REFUSES ITS FIELD, and it must not fall back the way a broken one does.
    // §22's availability rule — a resolver that throws leaves the Policy value — is right about a
    // resolver this store RAN and that failed. This field is not that: the code behind it was never
    // run, deliberately, so the Policy value here is a number nobody computed and nothing would say
    // so. The read answers with a reason instead, at the blast radius of the one field.
    const withheld = resolver !== undefined && isWithheldResolver(resolver.code, lensOf(def), prop);
    fields[legal(prop)] = {
      type: resolver === undefined ? fieldTypeOf(pp) : resolverTypeOf(resolver.type),
      resolve: withheld
        ? (): never => {
            throw new Error(withheldReason(def, prop));
          }
        : (node) => node.view[prop] ?? null,
    };
  }
  return fields;
}

// The receipt a claim mutation returns: one fact may serve many entities, so no single view is
// THE result — the delta id is.
const ClaimReceipt = new GraphQLObjectType<{ delta: string }>({
  name: "ClaimReceipt",
  description: "The signed delta a claim landed as.",
  fields: {
    delta: {
      type: new GraphQLNonNull(GraphQLID),
      resolve: (r: { delta: string }) => r.delta,
    },
  },
});

// The generic claim's pointer input: exactly one of at/value; at wants a context.
const PointerInput = new GraphQLInputObjectType({
  name: "PointerInput",
  fields: {
    role: { type: new GraphQLNonNull(GraphQLString) },
    at: { type: GraphQLID, description: "entity pointer target id (wants context too)" },
    context: { type: GraphQLString },
    value: { type: PrimitiveValue },
  },
});

// The argument holes a template declares, each with its kind and arity — conflicting reuse of
// one name is refused at build.
function templateArgs(
  schemaName: string,
  templateName: string,
  template: { pointers: readonly ClaimTemplates[string]["pointers"][number][] },
): Map<string, { kind: "entity" | "value"; each: boolean }> {
  const args = new Map<string, { kind: "entity" | "value"; each: boolean }>();
  const claimArg = (arg: string, kind: "entity" | "value", each: boolean): void => {
    const prior = args.get(arg);
    if (prior !== undefined && (prior.kind !== kind || prior.each !== each)) {
      throw new Error(
        `schema ${schemaName}: template "${templateName}" reuses arg "${arg}" with a different shape`,
      );
    }
    args.set(arg, { kind, each });
  };
  for (const p of template.pointers) {
    if (p.at !== undefined) claimArg(p.at.arg, "entity", p.each === true);
    else if (typeof p.value === "object" && p.value !== null) claimArg(p.value.arg, "value", false);
  }
  return args;
}

// `surface: "read"` builds the restricted schema the anonymous door serves: query +
// subscription only, NO Mutation type at all. Structural, not policed — `hooks.mutate` with no
// actor signs as the OPERATOR, so a write reachable anonymously would be an authority leak;
// with no mutation root, a mutation operation is a validation impossibility, and introspection
// honestly reveals a world in which writing does not exist.
export function buildGqlSchema(
  defs: readonly Registered[],
  hooks: SurfaceHooks,
  surface: SurfaceProjection = "full",
): GraphQLSchema {
  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const mutationFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const subscriptionFields: GraphQLFieldConfigMap<PatchNode, unknown> = {};

  for (const def of defs) {
    // Refuse collisions NOW, at build time — a lazy fields thunk would only complain when the
    // type is first used, long after register() reported success. "__proto__" is refused too:
    // plain-object assignment silently swallows it (the prototype setter), so a schema carrying
    // it would build cleanly and then quietly lose every read and write of that property.
    const seen = new Set([
      "_entity",
      "_hex",
      "_hviewHex",
      "_view",
      "_asOf",
      "_forgotten",
      "_fromHex",
      "_changed",
      "entity",
    ]);
    for (const [prop] of def.schema.props) {
      const name = legal(prop);
      if (seen.has(name) || name === "__proto__") {
        throw new Error(`schema ${lensOf(def)}: property "${prop}" collides with field "${name}"`);
      }
      seen.add(name);
    }

    const typeName = legal(lensOf(def));
    const viewType = new GraphQLObjectType<ResolvedNode>({
      name: `${typeName}View`,
      description: `The ${lensOf(def)} hyperschema, resolved under its registered policy.`,
      fields: () => ({ ...metaFields<ResolvedNode>(), ...propFields<ResolvedNode>(def) }),
    });
    const patchType = new GraphQLObjectType<PatchNode>({
      name: `${typeName}Patch`,
      description: `A live ${lensOf(def)} view: an initial snapshot, then one patch per change.`,
      fields: () => ({
        ...metaFields<PatchNode>(),
        ...propFields<PatchNode>(def),
        _fromHex: {
          type: GraphQLString,
          description: "The prior snapshot's content address; null on the initial snapshot.",
          resolve: (node) => node.fromHex,
        },
        _changed: {
          type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
          description: "The properties this patch moved; null on the initial snapshot.",
          resolve: (node) => node.changed,
        },
      }),
    });

    const fieldName = queryFieldFor(lensOf(def));
    // Own properties only: a schema named "toString" collides with nothing but itself.
    if (Object.hasOwn(queryFields, fieldName)) {
      throw new Error(
        `schema ${lensOf(def)}: its query field "${fieldName}" collides with an earlier schema`,
      );
    }

    const entityArg = { entity: { type: new GraphQLNonNull(GraphQLID) } };

    queryFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description: `Resolve ${lensOf(def)} at an entity. Absence is an answer, not an error.`,
      // The time pin (SPEC §26): an optional field argument, exactly like any other. Omit it and
      // the read is present-tense; supply a timestamp and it resolves the ground as it stood at T.
      // It rides the READ, not the connection — one query may pin different moments per field.
      args: {
        ...entityArg,
        asOf: {
          type: GraphQLFloat,
          description:
            "Resolve against the ground as it stood at this moment (a millisecond timestamp). " +
            "Omit to read the present. Erasure still wins: purged content never reappears (§11).",
        },
      },
      resolve: (_src, args: { entity: string; asOf?: number }, ctx: unknown) =>
        hooks.resolve(lensOf(def), args.entity, args.asOf ?? undefined, contextOf(ctx).binding),
    };

    subscriptionFields[fieldName] = {
      type: new GraphQLNonNull(patchType),
      description: `Hold ${lensOf(def)} live at an entity: a snapshot, then patches.`,
      args: entityArg,
      subscribe: (_src, args: { entity: string }) => hooks.watch(lensOf(def), args.entity),
      resolve: (payload: PatchNode) => payload,
    };

    // The read surface stops here: no mutation fields OR LISTING fields are even built — the
    // definitions below were already validated when the FULL surface bound (the read set is a
    // subset of it). The listing door (T110) is deliberately on this side of the line: public
    // enumeration is exactly what the uniform-refusal discipline prevents (§12 defers it behind
    // a per-lens `enumerable` flag), so on the public surface a listing field is a validation
    // impossibility, indistinguishable from a field that never existed.
    if (surface === "read") continue;

    // The listing field (T110): `plants(limit, after)` — one page of the entities whose evidence
    // the lens's backing container holds, each resolved through this lens. Refuse a collision
    // NOW, at build time, exactly as the singular field does: a lens named "Plants" beside a lens
    // named "Plant" is a world where "plants" means two things, and silence would pick one.
    const listField = `${fieldName}s`;
    if (Object.hasOwn(queryFields, listField)) {
      throw new Error(
        `schema ${lensOf(def)}: its listing field "${listField}" collides with an earlier schema`,
      );
    }
    queryFields[listField] = {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(viewType))),
      description:
        `List the entities holding ${lensOf(def)} evidence, resolved through this lens — ` +
        `ascending by _entity. One page per call; pass the last _entity as \`after\` for the ` +
        `next. An entity may resolve sparse: evidence-level membership, absence stays absence.`,
      args: {
        limit: {
          type: GraphQLInt,
          description: "Page size (each entity costs a resolution); bounded, defaults small.",
        },
        after: {
          type: GraphQLID,
          description: "The previous page's last _entity, exclusive.",
        },
      },
      // `== null` on purpose: GraphQL hands an omitted argument as undefined and an explicit
      // null as null, and both mean "not asked for" here — one comparison covers the pair.
      resolve: (_src, args: { limit?: number | null; after?: string | null }, ctx: unknown) =>
        hooks.list(
          lensOf(def),
          {
            ...(args.limit == null ? {} : { limit: args.limit }),
            ...(args.after == null ? {} : { after: args.after }),
          },
          contextOf(ctx).binding,
        ),
    };

    // Only WRITABLE props are offered as per-prop mutation args (SPEC §14): a read-only field is
    // simply absent from the write surface. Immutable-by-default (§21): absent `writable` → NO prop
    // is writable, so a registration that names none offers a bare mutate field (entity only).
    // A REFERENCE prop (SPEC §51) never takes a primitive argument, whatever `writable` says —
    // a prop is a reference or a primitive, never both; keeping the argument would regenerate the
    // string-fossil path the derived link mutations exist to close. Skipping a ref naming a prop
    // the schema lacks is deliberate: publish refuses that loudly, and a stray on replayed ground
    // must not unbind the lens.
    const writable = new Set(def.writable ?? []);
    const refSpecs = referenceProps(def.hyperschema.body, def.refs);
    const references = [...def.schema.props.keys()].filter((prop) => refSpecs.has(prop));
    const propArgs: Record<string, { type: typeof PrimitiveValue }> = {};
    for (const [prop] of def.schema.props) {
      if (writable.has(prop) && !refSpecs.has(prop))
        propArgs[legal(prop)] = { type: PrimitiveValue };
    }
    // The mutation namespace is shared between per-prop fields and TEMPLATE fields of every
    // schema — check it explicitly (queryFields' check does not cover an earlier schema's
    // template landing on this schema's field name).
    if (Object.hasOwn(mutationFields, fieldName)) {
      throw new Error(
        `schema ${lensOf(def)}: its mutation field "${fieldName}" collides with an existing mutation`,
      );
    }
    // An unopened prop has no argument at all, so GraphQL refuses it with a bare "Unknown
    // argument" — true, and no help to a reader who cannot see WHY the field is missing. The
    // description is the only place left to hand them the thread: it names the knob (`writable`)
    // and the props this registration left shut — and, separately, the REFERENCE props, which are
    // not shut at all: each writes through its own link/unlink mutation pair (§51), or is typed a
    // reference with no single canonical role to author (a prefix/inSet family).
    const shut = [...def.schema.props.keys()].filter(
      (prop) => !writable.has(prop) && !refSpecs.has(prop),
    );
    mutationFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Claim properties of an entity under ${lensOf(def)}: every provided argument ` +
        `becomes one signed delta. Returns the re-resolved view.` +
        (shut.length === 0
          ? "" // nothing is shut: no argument is missing, so there is nothing to explain
          : ` Read-only here, absent from the registration's \`writable\` list and so offered as ` +
            `no argument (immutable-by-default, §21): ${shut.join(", ")}.`) +
        (references.length === 0
          ? ""
          : ` Reference props (§51), never a primitive argument — write each through its own ` +
            `link/unlink mutation pair where one is served: ${references.join(", ")}.`),
      args: { ...entityArg, ...propArgs },
      resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
        const { actor, binding } = contextOf(ctx);
        // A null prototype: no store-named property can ever reach a real Object.prototype key.
        const props: Record<string, Primitive> = Object.create(null) as Record<string, Primitive>;
        for (const [prop] of def.schema.props) {
          const v = args[legal(prop)];
          if (v !== undefined && v !== null) props[prop] = v as Primitive;
        }
        return hooks.mutate(lensOf(def), args["entity"] as string, props, actor, binding);
      },
    };

    // The retract half (SPEC §14): clearing is not `set(null)`, it is retraction — negate the
    // caller's OWN contributions to the named fields, so each resolves to what survives, or to
    // absence (rendered per absentAs). One field per schema, `clear<Type>`.
    const clearField = `clear${typeName}`;
    if (Object.hasOwn(mutationFields, clearField)) {
      throw new Error(
        `schema ${lensOf(def)}: its mutation field "${clearField}" collides with an existing mutation`,
      );
    }
    mutationFields[clearField] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Retract YOUR OWN contributions to the named fields of a ${lensOf(def)} ` +
        `entity — each falls to what survives, or to absence. Returns the re-resolved view.`,
      args: {
        ...entityArg,
        fields: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
      },
      resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
        const { actor, binding } = contextOf(ctx);
        const fields = args["fields"] as string[];
        // Refuse a typo against THIS lens's fields — a silent no-op would read as a successful
        // clear when nothing was cleared. (REST does the same against its addressed version.)
        for (const field of fields) {
          if (!def.schema.props.has(field)) {
            throw new Error(`schema ${lensOf(def)} has no field "${field}" to clear`);
          }
        }
        return hooks.clear(lensOf(def), args["entity"] as string, fields, actor, binding);
      },
    };

    // remove<Type> (SPEC §14 amendment): value-scoped retraction — withdraw the ONE value you
    // contributed to a field (a tag you added, a `merge` addend), the rest of the field untouched.
    const removeField = `remove${typeName}`;
    if (Object.hasOwn(mutationFields, removeField)) {
      throw new Error(
        `schema ${lensOf(def)}: its mutation field "${removeField}" collides with an existing mutation`,
      );
    }
    mutationFields[removeField] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Retract YOUR OWN contribution(s) of specific values to one field of a ` +
        `${lensOf(def)} entity — the rest of the field stands. Returns the re-resolved view.`,
      args: {
        ...entityArg,
        field: { type: new GraphQLNonNull(GraphQLString) },
        values: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PrimitiveValue))) },
      },
      resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
        const { actor, binding } = contextOf(ctx);
        const field = args["field"] as string;
        if (!def.schema.props.has(field)) {
          throw new Error(`schema ${lensOf(def)} has no field "${field}"`);
        }
        return hooks.remove(
          lensOf(def),
          args["entity"] as string,
          field,
          args["values"] as Primitive[],
          actor,
          binding,
        );
      },
    };

    // Edge verbs (SPEC §14): a gather that `expand`s a role resolves relations, so its fields take
    // ENTITY-pointer writes — `link<Type>` asserts an edge, `sever<Type>` retracts your own. Read
    // from the published hyperschema gather, NOT the resolution Schema; a gather with no `expand`
    // resolves no edges and is offered neither verb (so a primitive schema refuses entity pointers).
    if (edgeRoles(def.hyperschema.body).length > 0) {
      const linkField = `link${typeName}`;
      if (Object.hasOwn(mutationFields, linkField)) {
        throw new Error(
          `schema ${lensOf(def)}: its mutation field "${linkField}" collides with an existing mutation`,
        );
      }
      mutationFields[linkField] = {
        type: new GraphQLNonNull(viewType),
        description:
          `Link an edge on a ${lensOf(def)} entity: assert that \`field\` points at the ` +
          `\`target\` entity, resolved into its child view. Returns the re-resolved view.`,
        args: {
          ...entityArg,
          field: { type: new GraphQLNonNull(GraphQLString) },
          target: { type: new GraphQLNonNull(GraphQLID) },
          context: {
            type: GraphQLString,
            description: "The child pointer's context; defaults to the field name.",
          },
        },
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const { actor, binding } = contextOf(ctx);
          const field = args["field"] as string;
          if (!def.schema.props.has(field)) {
            throw new Error(`schema ${lensOf(def)} has no field "${field}" to link`);
          }
          return hooks.link(
            lensOf(def),
            args["entity"] as string,
            field,
            args["target"] as string,
            (args["context"] as string | undefined) ?? undefined,
            actor,
            binding,
          );
        },
      };

      const severField = `sever${typeName}`;
      if (Object.hasOwn(mutationFields, severField)) {
        throw new Error(
          `schema ${lensOf(def)}: its mutation field "${severField}" collides with an existing mutation`,
        );
      }
      mutationFields[severField] = {
        type: new GraphQLNonNull(viewType),
        description:
          `Sever edges on a ${lensOf(def)} entity: retract YOUR OWN edges in \`field\` — ` +
          `all of them, or only those pointing at a named \`target\`. Returns the re-resolved view.`,
        args: {
          ...entityArg,
          field: { type: new GraphQLNonNull(GraphQLString) },
          targets: { type: new GraphQLList(new GraphQLNonNull(GraphQLID)) },
        },
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const { actor, binding } = contextOf(ctx);
          const field = args["field"] as string;
          if (!def.schema.props.has(field)) {
            throw new Error(`schema ${lensOf(def)} has no field "${field}" to sever`);
          }
          return hooks.sever(
            lensOf(def),
            args["entity"] as string,
            field,
            (args["targets"] as string[] | undefined) ?? undefined,
            actor,
            binding,
          );
        },
      };
    }

    // Lens-derived edge mutations (SPEC §51): for each declared reference prop with a single
    // canonical role, the adjoint of the read program — `link<n>_<P>` asserts the symmetric
    // two-pointer edge delta the lens's `expand` follows, `unlink<n>_<P>` retracts the caller's
    // own. Typed ID! on both args, so a cold introspecting client is taught the truth instead of
    // the string-fossil path. A prefix/inSet family (`links: false`) types the prop as a
    // reference (its primitive argument is already gone, above) and mints nothing here.
    for (const [prop, ref] of refSpecs) {
      if (!ref.links || !def.schema.props.has(prop)) continue;
      const edgeArgs = {
        entity: { type: new GraphQLNonNull(GraphQLID) },
        target: { type: new GraphQLNonNull(GraphQLID) },
      };
      const linkRefField = `link${fieldName}_${legal(prop)}`;
      if (Object.hasOwn(mutationFields, linkRefField)) {
        throw new Error(
          `schema ${lensOf(def)}: its mutation field "${linkRefField}" collides with an existing mutation`,
        );
      }
      mutationFields[linkRefField] = {
        type: new GraphQLNonNull(viewType),
        description:
          `Link \`target\` into ${lensOf(def)}.${prop}: one signed delta carrying the ` +
          `"${ref.role}" edge role, resolved into the target's nested view` +
          (ref.reciprocal === undefined
            ? ""
            : ` and folding into the target's own "${ref.reciprocal.context}"`) +
          `. Returns the re-resolved view.`,
        args: edgeArgs,
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const { actor, binding } = contextOf(ctx);
          return hooks.linkRef(
            lensOf(def),
            args["entity"] as string,
            prop,
            args["target"] as string,
            actor,
            binding,
          );
        },
      };
      const unlinkRefField = `unlink${fieldName}_${legal(prop)}`;
      if (Object.hasOwn(mutationFields, unlinkRefField)) {
        throw new Error(
          `schema ${lensOf(def)}: its mutation field "${unlinkRefField}" collides with an existing mutation`,
        );
      }
      mutationFields[unlinkRefField] = {
        type: new GraphQLNonNull(viewType),
        description:
          `Retract YOUR OWN "${ref.role}" edge(s) at \`target\` from ${lensOf(def)}.${prop} — ` +
          `history survives, another author's edge stands. Returns the re-resolved view.`,
        args: edgeArgs,
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const { actor, binding } = contextOf(ctx);
          return hooks.unlinkRef(
            lensOf(def),
            args["entity"] as string,
            prop,
            args["target"] as string,
            actor,
            binding,
          );
        },
      };
    }

    // The schema's declared write shapes: one mutation per template, one DELTA per call.
    for (const [templateName, template] of Object.entries(def.mutations ?? {})) {
      if (Object.hasOwn(mutationFields, templateName)) {
        throw new Error(
          `schema ${lensOf(def)}: template "${templateName}" collides with an existing mutation`,
        );
      }
      const argSpec = templateArgs(lensOf(def), templateName, template);
      const gqlArgs: Record<string, { type: GraphQLInputType }> = {};
      for (const [arg, meta] of argSpec) {
        const base: GraphQLInputType = meta.kind === "entity" ? GraphQLID : PrimitiveValue;
        gqlArgs[arg] = {
          type: meta.each
            ? new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(base)))
            : new GraphQLNonNull(base),
        };
      }
      mutationFields[templateName] = {
        type: new GraphQLNonNull(ClaimReceipt),
        description:
          `${lensOf(def)}'s "${templateName}" claim: one call, one signed delta, ` +
          `exactly the declared shape.`,
        args: gqlArgs,
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const { actor, binding } = contextOf(ctx);
          const pointers: ClaimPointerSpec[] = [];
          for (const p of template.pointers) {
            if (p.at !== undefined) {
              const supplied = args[p.at.arg];
              const targets = p.each === true ? (supplied as string[]) : [supplied as string];
              for (const id of targets) {
                pointers.push({
                  role: p.role,
                  at: id,
                  ...(p.context === undefined ? {} : { context: p.context }),
                });
              }
            } else if (typeof p.value === "object" && p.value !== null) {
              pointers.push({ role: p.role, value: args[p.value.arg] as Primitive });
            } else {
              pointers.push({ role: p.role, value: p.value as Primitive });
            }
          }
          return hooks.claim(pointers, actor, binding);
        },
      };
    }
  }

  if (surface === "read") {
    return new GraphQLSchema({
      query: new GraphQLObjectType({ name: "Query", fields: queryFields }),
      subscription: new GraphQLObjectType({ name: "Subscription", fields: subscriptionFields }),
    });
  }

  // The generic claim: for shapes no template anticipated. Same signing, same standing.
  if (Object.hasOwn(mutationFields, "_claim")) {
    throw new Error(`a schema's mutation field collides with the built-in "_claim"`);
  }
  mutationFields["_claim"] = {
    type: new GraphQLNonNull(ClaimReceipt),
    description:
      "Emit one signed delta from an explicit pointer list — the general form every " +
      "template is sugar for. Each pointer is entity (at + context) or primitive (value).",
    args: {
      pointers: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PointerInput))),
      },
    },
    resolve: (_src, args: { pointers: ClaimPointerSpec[] }, ctx: unknown) => {
      const { actor, binding } = contextOf(ctx);
      return hooks.claim(args.pointers, actor, binding);
    },
  };

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: "Query", fields: queryFields }),
    mutation: new GraphQLObjectType({ name: "Mutation", fields: mutationFields }),
    subscription: new GraphQLObjectType({ name: "Subscription", fields: subscriptionFields }),
  });
}

// The seam witnessed (SPEC §17): GraphQL is one SurfaceGenerator among peers — this binding
// is the compile-time proof, and the name new call sites should prefer.
export const graphqlSurface: SurfaceGenerator<GraphQLSchema> = buildGqlSchema;
