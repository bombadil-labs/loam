import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import {
  parseClaimTemplates,
  registrationDeltaClaims,
  schemaEntityFor,
  type Registration,
} from "./registration.js";

export interface GenesisSpec {
  readonly operatorSeed: string;
  readonly registrations?: readonly Registration[];
  readonly grants?: readonly Claims[];
  readonly extra?: readonly Claims[];
}

export interface Genesis {
  readonly operatorSeed: string;
  readonly deltas: readonly Delta[];
}

export const STORE_ENTITY = "loam:store";
export const CTX_OPERATOR = "loam.operator";

export function operatorMarkerClaims(operator: string): Claims {
  return {
    timestamp: 0,
    validFrom: 0,
    author: operator,
    pointers: [
      {
        role: "operator",
        target: { kind: "entity", entity: { id: STORE_ENTITY, context: CTX_OPERATOR } },
      },
      { role: "author", target: { kind: "primitive", value: operator } },
    ],
  };
}

export function assembleGenesis(spec: GenesisSpec): Genesis {
  const seed = spec.operatorSeed;
  const operator = authorForSeed(seed);
  const deltas: Delta[] = [signClaims(operatorMarkerClaims(operator), seed)];
  let clock = 1;
  const seenLens = new Set<string>();
  for (const reg of spec.registrations ?? []) {
    const lensName = reg.lensName ?? reg.schema.name ?? reg.hyperschema.name;
    const key = [schemaEntityFor(reg.hyperschema, reg.entity), lensName].join("\u0000");
    if (seenLens.has(key)) {
      throw new Error(
        `genesis: two registrations over the same hyperschema resolve to lens "${lensName}" — ` +
          `they cannot both bind, so one would be silently dropped. Give each reading a distinct ` +
          `schema name.`,
      );
    }
    seenLens.add(key);
    if (reg.mutations !== undefined) {
      try {
        parseClaimTemplates(reg.mutations);
      } catch (err) {
        const defect = err instanceof Error ? err.message : String(err);
        throw new Error(
          `genesis: lens "${lensName}" carries a mutations payload that cannot be read ` +
            `faithfully — ${defect}`,
        );
      }
    }
    const entity = schemaEntityFor(reg.hyperschema, reg.entity);
    deltas.push(
      signClaims(publishHyperSchemaClaims(reg.hyperschema, entity, operator, clock++), seed),
    );
    const { living, snapshot, binding } = registrationDeltaClaims(
      entity,
      lensName,
      reg.schema,
      reg.roots,
      operator,
      () => clock++,
      reg.mutations,
      reg.writable,
      reg.resolvers,
    );
    deltas.push(signClaims(living, seed), signClaims(snapshot, seed), signClaims(binding, seed));
  }
  for (const claims of spec.grants ?? []) deltas.push(signClaims(claims, seed));
  for (const claims of spec.extra ?? []) deltas.push(signClaims(claims, seed));
  return { operatorSeed: seed, deltas };
}
