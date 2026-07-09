// GraphQL derived from (HyperSchema, Policy) — not reflected from the data. The policy is the
// contract: its props name the fields, and each PropPolicy's kind names the field's shape
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
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
} from "graphql";
import type { HyperSchema, Policy, Primitive, PropPolicy, View } from "@bombadil/rhizomatic";

export interface Registered {
  readonly schema: HyperSchema;
  readonly policy: Policy;
  readonly roots: readonly string[];
}

// What flows from the root resolver to the field resolvers: one resolution, many reads.
export interface ResolvedNode {
  readonly entity: string;
  readonly view: Record<string, View>;
  readonly hex: string;
}

// A subscription event: the re-resolved node plus where it came from and what moved.
export interface PatchNode extends ResolvedNode {
  readonly fromHex: string | null; // null on the initial snapshot
  readonly changed: readonly string[] | null; // null on the initial snapshot
}

// The seams the gateway provides; gql.ts owns shape, the gateway owns state.
export interface GqlHooks {
  resolve(schemaName: string, entity: string): ResolvedNode;
  mutate(
    schemaName: string,
    entity: string,
    props: Record<string, Primitive>,
  ): Promise<ResolvedNode>;
  watch(schemaName: string, entity: string): AsyncGenerator<PatchNode>;
}

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

function fieldTypeOf(pp: PropPolicy): GraphQLOutputType {
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
      description: "The content address of the resolved view — the snapshot.",
      resolve: (node) => node.hex,
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

export function buildGqlSchema(defs: readonly Registered[], hooks: GqlHooks): GraphQLSchema {
  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const mutationFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const subscriptionFields: GraphQLFieldConfigMap<PatchNode, unknown> = {};

  for (const def of defs) {
    // Refuse collisions NOW, at build time — a lazy fields thunk would only complain when the
    // type is first used, long after register() reported success. "__proto__" is refused too:
    // plain-object assignment silently swallows it (the prototype setter), so a schema carrying
    // it would build cleanly and then quietly lose every read and write of that property.
    const seen = new Set(["_entity", "_hex", "_view", "_fromHex", "_changed", "entity"]);
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
    if (fieldName in queryFields) {
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

    const propArgs: Record<string, { type: typeof PrimitiveValue }> = {};
    for (const [prop] of def.policy.props) propArgs[legal(prop)] = { type: PrimitiveValue };
    mutationFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Claim properties of an entity under ${def.schema.name}: every provided argument ` +
        `becomes one signed delta. Returns the re-resolved view.`,
      args: { ...entityArg, ...propArgs },
      resolve: (_src, args: Record<string, unknown>) => {
        // A null prototype: no store-named property can ever reach a real Object.prototype key.
        const props: Record<string, Primitive> = Object.create(null) as Record<string, Primitive>;
        for (const [prop] of def.policy.props) {
          const v = args[legal(prop)];
          if (v !== undefined && v !== null) props[prop] = v as Primitive;
        }
        return hooks.mutate(def.schema.name, args["entity"] as string, props);
      },
    };

    subscriptionFields[fieldName] = {
      type: new GraphQLNonNull(patchType),
      description: `Hold ${def.schema.name} live at an entity: a snapshot, then patches.`,
      args: entityArg,
      subscribe: (_src, args: { entity: string }) => hooks.watch(def.schema.name, args.entity),
      resolve: (payload: PatchNode) => payload,
    };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: "Query", fields: queryFields }),
    mutation: new GraphQLObjectType({ name: "Mutation", fields: mutationFields }),
    subscription: new GraphQLObjectType({ name: "Subscription", fields: subscriptionFields }),
  });
}
