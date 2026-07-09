// GraphQL derived from (HyperSchema, Policy) — not reflected from the data. The policy is the
// contract: its props name the fields, and each PropPolicy's kind names the field's shape
// (pick → one value; all/conflicts → a list; merge → its reduction's type; absentAs → the
// pass-through scalar, because its primitive constant and its inner policy's shape need not
// agree). Values pass through the ViewValue scalar untyped-but-faithful — a resolved View is
// already the policy's adjudicated answer, and nested expansions ride through it as objects.
// A name that would collide — two schemas, two props, or a prop against a built-in — is
// refused at build time, never silently shadowed.
//
// Every view type carries `_entity` (the root asked about) and `_hex` (the content address of
// the resolved View — the snapshot: same policy + same deltas, in any order, on any machine,
// is the same hex).

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
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
} from "graphql";
import {
  resolveView,
  viewCanonicalHex,
  type HView,
  type HyperSchema,
  type Policy,
  type PropPolicy,
  type View,
} from "@bombadil/rhizomatic";

export interface Registered {
  readonly schema: HyperSchema;
  readonly policy: Policy;
  readonly roots: readonly string[];
}

// What flows from the root resolver to the field resolvers: one resolution, many reads.
interface ResolvedNode {
  readonly entity: string;
  readonly view: Record<string, View>;
  readonly hex: string;
}

// The pass-through scalar: a resolved View value — primitive, list, or nested object — exactly
// as the policy adjudicated it.
const ViewValue = new GraphQLScalarType({
  name: "ViewValue",
  description: "A resolved view value — primitive, list, or nested view — passed through as-is.",
  serialize: (v) => v,
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

export function buildGqlSchema(
  defs: readonly Registered[],
  gather: (schemaName: string, root: string) => HView,
): GraphQLSchema {
  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};

  for (const def of defs) {
    // Refuse collisions NOW, at build time — a lazy fields thunk would only complain when the
    // type is first used, long after register() reported success.
    const seen = new Set(["_entity", "_hex", "_view"]);
    for (const [prop] of def.policy.props) {
      const name = legal(prop);
      if (seen.has(name)) {
        throw new Error(
          `schema ${def.schema.name}: property "${prop}" collides with field "${name}"`,
        );
      }
      seen.add(name);
    }

    const typeName = `${legal(def.schema.name)}View`;
    const viewType = new GraphQLObjectType<ResolvedNode>({
      name: typeName,
      description: `The ${def.schema.name} hyperschema, resolved under its registered policy.`,
      fields: () => {
        const fields: GraphQLFieldConfigMap<ResolvedNode, unknown> = {
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
        for (const [prop, pp] of def.policy.props) {
          fields[legal(prop)] = {
            type: fieldTypeOf(pp),
            resolve: (node) => node.view[prop] ?? null,
          };
        }
        return fields;
      },
    });

    const fieldName = legal(def.schema.name).replace(/^[A-Z]/, (c) => c.toLowerCase());
    if (fieldName in queryFields) {
      throw new Error(
        `schema ${def.schema.name}: its query field "${fieldName}" collides with an earlier schema`,
      );
    }
    queryFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description: `Resolve ${def.schema.name} at an entity. Absence is an answer, not an error.`,
      args: { entity: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: (_src, args: { entity: string }): ResolvedNode => {
        const hview = gather(def.schema.name, args.entity);
        const view = resolveView(def.policy, hview) as Record<string, View>;
        return { entity: args.entity, view, hex: viewCanonicalHex(view) };
      },
    };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: "Query", fields: queryFields }),
  });
}
