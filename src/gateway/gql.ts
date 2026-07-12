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
import type { ClaimTemplates } from "./registration.js";
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

// The pass-through output scalar: a resolved View value — primitive, list, or nested object —
// exactly as the policy adjudicated it.
const ViewValue = new GraphQLScalarType({
  name: "ViewValue",
  description: "A resolved view value — primitive, list, or nested view — passed through as-is.",
  serialize: (v) => v,
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

// A GraphQL-legal name from a store-native one; the original stays in the resolver closure.
const legal = (s: string): string => {
  const cleaned = s.replace(/[^_A-Za-z0-9]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
};

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
  };
}

function propFields<N extends ResolvedNode>(def: Registered): GraphQLFieldConfigMap<N, unknown> {
  const fields: GraphQLFieldConfigMap<N, unknown> = {};
  for (const [prop, pp] of def.policy.props) {
    fields[legal(prop)] = {
      type: fieldTypeOf(pp),
      resolve: (node) => node.view[prop] ?? null,
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
      "_fromHex",
      "_changed",
      "entity",
    ]);
    for (const [prop] of def.policy.props) {
      const name = legal(prop);
      if (seen.has(name) || name === "__proto__") {
        throw new Error(
          `schema ${def.schema.name}: property "${prop}" collides with field "${name}"`,
        );
      }
      seen.add(name);
    }

    const typeName = legal(def.schema.name);
    const viewType = new GraphQLObjectType<ResolvedNode>({
      name: `${typeName}View`,
      description: `The ${def.schema.name} hyperschema, resolved under its registered policy.`,
      fields: () => ({ ...metaFields<ResolvedNode>(), ...propFields<ResolvedNode>(def) }),
    });
    const patchType = new GraphQLObjectType<PatchNode>({
      name: `${typeName}Patch`,
      description: `A live ${def.schema.name} view: an initial snapshot, then one patch per change.`,
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

    const fieldName = typeName.replace(/^[A-Z]/, (c) => c.toLowerCase());
    // Own properties only: a schema named "toString" collides with nothing but itself.
    if (Object.hasOwn(queryFields, fieldName)) {
      throw new Error(
        `schema ${def.schema.name}: its query field "${fieldName}" collides with an earlier schema`,
      );
    }

    const entityArg = { entity: { type: new GraphQLNonNull(GraphQLID) } };

    queryFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description: `Resolve ${def.schema.name} at an entity. Absence is an answer, not an error.`,
      args: entityArg,
      resolve: (_src, args: { entity: string }) => hooks.resolve(def.schema.name, args.entity),
    };

    subscriptionFields[fieldName] = {
      type: new GraphQLNonNull(patchType),
      description: `Hold ${def.schema.name} live at an entity: a snapshot, then patches.`,
      args: entityArg,
      subscribe: (_src, args: { entity: string }) => hooks.watch(def.schema.name, args.entity),
      resolve: (payload: PatchNode) => payload,
    };

    // The read surface stops here: no mutation fields are even built — the definitions below
    // were already validated when the FULL surface bound (the read set is a subset of it).
    if (surface === "read") continue;

    const propArgs: Record<string, { type: typeof PrimitiveValue }> = {};
    for (const [prop] of def.policy.props) propArgs[legal(prop)] = { type: PrimitiveValue };
    // The mutation namespace is shared between per-prop fields and TEMPLATE fields of every
    // schema — check it explicitly (queryFields' check does not cover an earlier schema's
    // template landing on this schema's field name).
    if (Object.hasOwn(mutationFields, fieldName)) {
      throw new Error(
        `schema ${def.schema.name}: its mutation field "${fieldName}" collides with an existing mutation`,
      );
    }
    mutationFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Claim properties of an entity under ${def.schema.name}: every provided argument ` +
        `becomes one signed delta. Returns the re-resolved view.`,
      args: { ...entityArg, ...propArgs },
      resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
        const actor = (ctx as { actor?: string } | undefined)?.actor;
        // A null prototype: no store-named property can ever reach a real Object.prototype key.
        const props: Record<string, Primitive> = Object.create(null) as Record<string, Primitive>;
        for (const [prop] of def.policy.props) {
          const v = args[legal(prop)];
          if (v !== undefined && v !== null) props[prop] = v as Primitive;
        }
        return hooks.mutate(def.schema.name, args["entity"] as string, props, actor);
      },
    };

    // The schema's declared write shapes: one mutation per template, one DELTA per call.
    for (const [templateName, template] of Object.entries(def.mutations ?? {})) {
      if (Object.hasOwn(mutationFields, templateName)) {
        throw new Error(
          `schema ${def.schema.name}: template "${templateName}" collides with an existing mutation`,
        );
      }
      const argSpec = templateArgs(def.schema.name, templateName, template);
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
          `${def.schema.name}'s "${templateName}" claim: one call, one signed delta, ` +
          `exactly the declared shape.`,
        args: gqlArgs,
        resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
          const actor = (ctx as { actor?: string } | undefined)?.actor;
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
          return hooks.claim(pointers, actor);
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
      const actor = (ctx as { actor?: string } | undefined)?.actor;
      return hooks.claim(args.pointers, actor);
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
