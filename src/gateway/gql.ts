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
import { isWithheldResolver } from "./adopt-vocab.js";
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

export type {
  ClaimPointerSpec,
  PatchNode,
  Registered,
  ResolvedNode,
  SurfaceHooks as GqlHooks,
} from "../surface/surface.js";

const contextOf = (ctx: unknown): { actor?: string; binding?: ConnectionBinding } =>
  (ctx as { actor?: string; binding?: ConnectionBinding } | undefined) ?? {};

const ViewValue = new GraphQLScalarType({
  name: "ViewValue",
  description: "A resolved view value — primitive, list, nested view, or a bytes envelope (§23.7).",
  serialize: (v) => bytesEnvelope(v),
});

const BytesValue = new GraphQLScalarType({
  name: "BytesValue",
  description:
    "A bytes value (§23.7): { mime, ref, base64url? } — fetch raw bytes at /bytes/<ref>.",
  serialize: (v) => bytesEnvelope(v),
});

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

export const legalNameFor = (s: string): string => {
  const cleaned = s.replace(/[^_A-Za-z0-9]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
};
const legal = legalNameFor;

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
          return ViewValue;
      }
      break;
    case "absentAs":
      return ViewValue;
  }
}

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

const PointerInput = new GraphQLInputObjectType({
  name: "PointerInput",
  fields: {
    role: { type: new GraphQLNonNull(GraphQLString) },
    at: { type: GraphQLID, description: "entity pointer target id (wants context too)" },
    context: { type: GraphQLString },
    value: { type: PrimitiveValue },
  },
});

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

export function buildGqlSchema(
  defs: readonly Registered[],
  hooks: SurfaceHooks,
  surface: SurfaceProjection = "full",
): GraphQLSchema {
  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const mutationFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const subscriptionFields: GraphQLFieldConfigMap<PatchNode, unknown> = {};

  for (const def of defs) {
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

    const priorMutations = new Set(Object.keys(mutationFields));
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
    if (Object.hasOwn(queryFields, fieldName)) {
      throw new Error(
        `schema ${lensOf(def)}: its query field "${fieldName}" collides with an earlier schema`,
      );
    }

    const entityArg = { entity: { type: new GraphQLNonNull(GraphQLID) } };

    queryFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description: `Resolve ${lensOf(def)} at an entity. Absence is an answer, not an error.`,
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
        (hooks.resolveRead ?? hooks.resolve)(
          lensOf(def),
          args.entity,
          args.asOf ?? undefined,
          contextOf(ctx).binding,
        ),
    };

    subscriptionFields[fieldName] = {
      type: new GraphQLNonNull(patchType),
      description: `Hold ${lensOf(def)} live at an entity: a snapshot, then patches.`,
      args: entityArg,
      subscribe: (_src, args: { entity: string }) => hooks.watch(lensOf(def), args.entity),
      resolve: (payload: PatchNode) => payload,
    };

    if (surface === "read") continue;

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

    const writable = new Set(def.writable ?? []);
    const refSpecs = referenceProps(def.hyperschema.body, def.refs);
    const references = [...def.schema.props.keys()].filter((prop) => refSpecs.has(prop));
    const propArgs: Record<string, { type: typeof PrimitiveValue }> = {};
    for (const [prop] of def.schema.props) {
      if (writable.has(prop) && !refSpecs.has(prop))
        propArgs[legal(prop)] = { type: PrimitiveValue };
    }
    if (Object.hasOwn(mutationFields, fieldName)) {
      throw new Error(
        `schema ${lensOf(def)}: its mutation field "${fieldName}" collides with an existing mutation`,
      );
    }
    const shut = [...def.schema.props.keys()].filter(
      (prop) => !writable.has(prop) && !refSpecs.has(prop),
    );
    mutationFields[fieldName] = {
      type: new GraphQLNonNull(viewType),
      description:
        `Claim properties of an entity under ${lensOf(def)}: every provided argument ` +
        `becomes one signed delta. Returns the re-resolved view.` +
        (shut.length === 0
          ? ""
          : ` Read-only here, absent from the registration's \`writable\` list and so offered as ` +
            `no argument (immutable-by-default, §21): ${shut.join(", ")}.`) +
        (references.length === 0
          ? ""
          : ` Reference props (§51), never a primitive argument — write each through its own ` +
            `link/unlink mutation pair where one is served: ${references.join(", ")}.`),
      args: { ...entityArg, ...propArgs },
      resolve: (_src, args: Record<string, unknown>, ctx: unknown) => {
        const { actor, binding } = contextOf(ctx);
        const props: Record<string, Primitive> = Object.create(null) as Record<string, Primitive>;
        for (const [prop] of def.schema.props) {
          const v = args[legal(prop)];
          if (v !== undefined && v !== null) props[prop] = v as Primitive;
        }
        return hooks.mutate(lensOf(def), args["entity"] as string, props, actor, binding);
      },
    };

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
        for (const field of fields) {
          if (!def.schema.props.has(field)) {
            throw new Error(`schema ${lensOf(def)} has no field "${field}" to clear`);
          }
        }
        return hooks.clear(lensOf(def), args["entity"] as string, fields, actor, binding);
      },
    };

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
    for (const [name, field] of Object.entries(mutationFields)) {
      if (priorMutations.has(name)) continue;
      const resolve = field.resolve;
      if (resolve === undefined) continue;
      field.resolve = (...args) => {
        hooks.assertSource?.(lensOf(def), contextOf(args[2]).binding);
        return resolve(...args);
      };
    }
  }

  if (surface === "read") {
    return new GraphQLSchema({
      query: new GraphQLObjectType({ name: "Query", fields: queryFields }),
      subscription: new GraphQLObjectType({ name: "Subscription", fields: subscriptionFields }),
    });
  }

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

export const graphqlSurface: SurfaceGenerator<GraphQLSchema> = buildGqlSchema;
