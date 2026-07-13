// The REST door (SPEC §17) — the seam's second witness, and the proof the seam is real. One
// registration, two doors: this module derives an OpenAPI 3.1 document and a router from the
// same Registered set GraphQL materializes, through the same hooks (so it CANNOT invent
// authority), with the same refusals. Born versioned (§17 amendment): every surviving
// registration is an answerable version — `v<N>` is the human alias (the Nth surviving, in
// ground order; aliases shift when a version is withdrawn), and the registration delta's
// content address is the version's true name (`@<hash>` addresses it directly; a withdrawn
// hash answers 410 Gone, which is not the same silence as never-existed).
//
// Transport-free on purpose: handleRest speaks (method, segments, body) → (status, body), and
// the HTTP server adapts. A compiled surface (§17's horizon) would adapt the same function to
// a very different wire.
//
// Two narrowings, stated plainly (narrowing is a generator's right): this door serves lenses
// REGISTERED AS DATA — a process-lifetime register() call files no registration delta, has no
// true name, and therefore no version here; its door is GraphQL. And the PUBLIC projection
// serves only the LATEST version of each declared name — the anonymous world stays strictly
// inside what public GraphQL answers, and its version history stays its own business.

import type { Primitive } from "@bombadil/rhizomatic";
import type { Gateway } from "../gateway/gateway.js";
import type { RegistrationVersion } from "../gateway/registration.js";
import type { SurfaceHooks } from "./surface.js";

export interface RestResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const refuse = (status: number, ...errors: string[]): RestResult => ({
  status,
  body: { errors },
});

// The version families a door may see. The full door sees every surviving version. The
// public door sees ONLY THE LATEST version of each declared name: a public declaration was
// made about the door that existed when it was signed, and retroactively publishing every
// historical policy would widen the anonymous surface past what public GraphQL can answer —
// a smaller world stays smaller through every door, and its version count stays its own
// business. (Note the narrowing stated in the module header: the REST door serves lenses
// REGISTERED AS DATA; a process-lifetime register() call has no registration delta, no true
// name, and therefore no version here — its door is GraphQL.)
function versionsFor(gateway: Gateway, door: "full" | "public"): RegistrationVersion[] {
  const surface = gateway.surface(door);
  if (surface === undefined) return [];
  const admitted = new Set(surface.registered.map((r) => r.hyperschema.name));
  const versions = gateway.registrationVersions().filter((v) => admitted.has(v.hyperschema.name));
  if (door === "full") return versions;
  const latest = new Map<string, RegistrationVersion>();
  for (const v of versions) latest.set(v.hyperschema.name, v); // ascending order: last one wins
  return [...latest.values()];
}

// vN aliases are PER SCHEMA NAME: Film v1 and Book v1 coexist. Ground order within a name.
function aliased(versions: readonly RegistrationVersion[]): Map<string, RegistrationVersion[]> {
  const byName = new Map<string, RegistrationVersion[]>();
  for (const v of versions) {
    const list = byName.get(v.hyperschema.name);
    if (list === undefined) byName.set(v.hyperschema.name, [v]);
    else list.push(v);
  }
  return byName;
}

// --- the OpenAPI document ----------------------------------------------------------------------

// A prop's OpenAPI shape, derived from its policy kind — honest about what resolution
// produces, permissive where a policy is (a pick answers whatever primitive was claimed).
function propSchema(kind: string): Record<string, unknown> {
  switch (kind) {
    case "all":
    case "conflicts":
      return { type: "array", description: `resolved by policy kind "${kind}"` };
    case "merge":
      return { description: "resolved by a merge policy — its reduction's type" };
    default:
      return { description: `resolved by policy kind "${kind}"` };
  }
}

export function buildOpenApi(
  gateway: Gateway,
  door: "full" | "public",
  mount: string,
): Record<string, unknown> {
  const byName = aliased(versionsFor(gateway, door));
  const paths: Record<string, unknown> = {};
  for (const [name, versions] of byName) {
    versions.forEach((v, i) => {
      const alias = i + 1;
      // The view object carries POLICY PROPS ONLY; entity and the content addresses live at
      // the body's top level — the document must describe the body that actually answers.
      const viewProperties: Record<string, unknown> = {};
      const writeProperties: Record<string, unknown> = {};
      // Writability: when a registration names its `writable` fields, only those appear in the
      // write body — the document must describe the writes that actually answer (SPEC §14).
      const writable = v.writable === undefined ? undefined : new Set(v.writable);
      for (const [prop, pp] of v.schema.props) {
        viewProperties[prop] = propSchema((pp as { kind: string }).kind);
        if (writable === undefined || writable.has(prop)) {
          writeProperties[prop] = {
            description: "a primitive claim value (string | number | boolean)",
          };
        }
      }
      const read = {
        summary: `resolve a ${name} view (version ${alias})`,
        description:
          `Version alias v${alias} of ${name}; its true name is the registration delta ` +
          `${v.deltaId}. Aliases shift when a version is withdrawn; the hash never lies.`,
        responses: {
          "200": {
            description: "the resolved view",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    entity: { type: "string" },
                    view: { type: "object", properties: viewProperties },
                    _hex: {
                      type: "string",
                      description: "the content address of this resolved view",
                    },
                    _hviewHex: { type: "string" },
                  },
                },
              },
            },
          },
        },
      };
      const path = `/${mount}/rest/v${alias}/${name}/{entity}`;
      paths[path] = {
        parameters: [{ name: "entity", in: "path", required: true, schema: { type: "string" } }],
        get: read,
        ...(door === "public"
          ? {}
          : {
              post: {
                summary: `write ${name} properties through the door (version ${alias})`,
                description:
                  "Each property becomes one signed claim through the same capability " +
                  "discipline as every other door — the mutation compiles to claims.",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: writeProperties,
                        additionalProperties: false,
                      },
                    },
                  },
                },
                responses: { "200": read.responses["200"] },
              },
              delete: {
                summary: `retract your own ${name} contributions (version ${alias})`,
                description:
                  "Clearing is retraction, not deletion of the ground: each named field is " +
                  "cleared of the caller's OWN contributions (empty body clears all), falling " +
                  "to what survives or to absence. A clear never touches another author's claim. " +
                  "An object body `{ field: [values] }` removes only those specific values.",
                requestBody: {
                  required: false,
                  content: {
                    "application/json": {
                      schema: {
                        oneOf: [
                          {
                            type: "array",
                            items: { type: "string" },
                            description: "field names to clear; omit or empty to clear all",
                          },
                          {
                            type: "object",
                            additionalProperties: { type: "array" },
                            description: "field → specific values to remove (retract your own)",
                          },
                        ],
                      },
                    },
                  },
                },
                responses: { "200": read.responses["200"] },
              },
            }),
      };
    });
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `loam: ${mount}`,
      version: "live", // the document regenerates as the store evolves — itself a view
      description:
        "A materialized surface over a Loam store (SPEC §17). Every version listed here " +
        "stays answerable; @<registration-hash> addresses a version by its true name.",
    },
    paths,
  };
}

// --- the router ----------------------------------------------------------------------------

// GET/POST /rest/<vN | @hash>/<schema>/<entity>. Transport-free; the caller has already
// resolved identity to a door ("full" with an optional actorSeed, or "public").
// The resolved node as a REST body: the view beside its content addresses, and — on an as-of
// read (SPEC §26) — the time pin and the erasure annotation, riding alongside exactly as `_hex`
// does and never inside the resolved data. A present read carries neither.
const nodeBody = (node: {
  entity: string;
  view: Record<string, unknown>;
  hex: string;
  hviewHex: string;
  asOf?: number;
  forgotten?: number;
}): Record<string, unknown> => ({
  entity: node.entity,
  view: node.view,
  _hex: node.hex,
  _hviewHex: node.hviewHex,
  ...(node.asOf === undefined ? {} : { _asOf: node.asOf, _forgotten: node.forgotten }),
});

export async function handleRest(
  gateway: Gateway,
  door: "full" | "public",
  method: string,
  segments: readonly string[],
  bodyText: string | undefined,
  actorSeed?: string,
  asOfRaw?: string,
): Promise<RestResult> {
  const [vTag, schemaName, entityRaw] = segments;
  if (vTag === undefined || schemaName === undefined || entityRaw === undefined) {
    return refuse(404, "the rest door wants /rest/<v1|@hash>/<Schema>/<entity>");
  }
  let entity: string;
  try {
    entity = decodeURIComponent(entityRaw);
  } catch {
    return refuse(400, "the entity segment is not decodable");
  }

  // The time pin (SPEC §26): `?asOf=<T>` reads the ground as it stood at that millisecond. A
  // read parameter — meaningful on GET; a write is always present-tense, so POST/DELETE ignore it.
  let asOf: number | undefined;
  if (asOfRaw !== undefined && asOfRaw !== "") {
    const t = Number(asOfRaw);
    if (!Number.isFinite(t)) return refuse(400, "asOf must be a numeric timestamp (milliseconds)");
    asOf = t;
  }

  const versions = versionsFor(gateway, door);
  const family = aliased(versions).get(schemaName);

  // Resolve the version the path names — alias or true name.
  let pinned: RegistrationVersion | undefined;
  let isLatest = false;
  if (/^v[1-9]\d*$/.test(vTag)) {
    const n = Number(vTag.slice(1));
    pinned = family?.[n - 1];
    isLatest = family !== undefined && n === family.length;
    if (pinned === undefined) return refuse(404, `no version ${vTag} of ${schemaName} survives`);
  } else if (vTag.startsWith("@")) {
    const hash = vTag.slice(1);
    pinned = versions.find((v) => v.deltaId === hash && v.hyperschema.name === schemaName);
    if (pinned === undefined) {
      // Withdrawn is not never-existed — but ONLY the full door is owed that distinction,
      // and only for a hash that really was a LAWFUL registration of THIS schema, since
      // struck by the operator (readWithdrawnRegistrations). The public door answers a
      // uniform 404 for every unknown hash: an anonymous caller must learn nothing about
      // what this ground holds beyond the declared world (§12's discipline, kept here).
      if (door === "full") {
        const withdrawn = gateway.withdrawnRegistrations();
        if (withdrawn.some((w) => w.deltaId === hash && w.schemaName === schemaName)) {
          return refuse(
            410,
            "that version was withdrawn by the operator — it is remembered, not served",
          );
        }
      }
      return refuse(404, `no version @${hash.slice(0, 12)}… of ${schemaName} survives`);
    }
    isLatest = family !== undefined && family[family.length - 1]?.deltaId === pinned.deltaId;
  } else {
    return refuse(404, "a version is v<N> or @<registration-hash>");
  }

  const surface = gateway.surface(door);
  if (surface === undefined) return refuse(404, "nothing here is public");
  const hooks: SurfaceHooks = surface.hooks;

  if (method === "GET") {
    // The latest version answers through the warm path — the same resolve GraphQL uses, so
    // agreement is by construction; an older version answers through pinned resolution.
    // Every gateway throw folds into a structured refusal, exactly as handleGraphql folds
    // them: a resolver error must not become a 500 that leaks internals on any door.
    try {
      const node = isLatest
        ? hooks.resolve(schemaName, entity, asOf)
        : gateway.resolvePinned(pinned, entity, asOf);
      return { status: 200, body: nodeBody(node) };
    } catch (err) {
      return refuse(400, err instanceof Error ? err.message : String(err));
    }
  }

  if (method === "POST") {
    if (door === "public") return refuse(403, "the public door is a smaller world: read-only");
    if (bodyText === undefined || bodyText === "") {
      return refuse(400, "a write wants a JSON object of properties");
    }
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return refuse(400, "the body must be JSON: { <prop>: <primitive>, ... }");
    }
    if (props === null || typeof props !== "object" || Array.isArray(props)) {
      return refuse(400, "the body must be a JSON object of properties");
    }
    // The version shapes the write: a property this version's policy does not name is
    // refused HERE, exactly as GraphQL's argument grammar refuses it there.
    const known = new Set(pinned.schema.props.keys());
    const clean: Record<string, Primitive> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!known.has(k)) {
        return refuse(400, `version ${vTag} of ${schemaName} has no property "${k}"`);
      }
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        return refuse(400, `property "${k}" wants a primitive (string | number | boolean)`);
      }
      clean[k] = v;
    }
    try {
      const node = await hooks.mutate(schemaName, entity, clean, actorSeed);
      const answered = isLatest ? node : gateway.resolvePinned(pinned, entity);
      return { status: 200, body: nodeBody(answered) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The same outcomes the other doors map: standing and tombstone refusals are 403, a
      // degraded gateway is the server's trouble (503, as /append answers), the rest 400.
      if (/can no longer persist/.test(message)) return refuse(503, message);
      if (/not permitted|was erased|refused|read-only/.test(message)) return refuse(403, message);
      return refuse(400, message);
    }
  }

  if (method === "DELETE") {
    // Clearing is retraction (SPEC §14): DELETE retracts the caller's OWN contributions. The body
    // resolves. The body speaks two shapes: a JSON ARRAY of field names clears those fields whole
    // (empty/absent → every prop this version resolves); a JSON OBJECT `{ field: [values] }` is the
    // §14-amendment value-scoped REMOVE — retract only the caller's own contributions of those
    // values. The public door is a smaller, read-only world — it retracts no more than it writes.
    if (door === "public") return refuse(403, "the public door is a smaller world: read-only");
    const known = [...pinned.schema.props.keys()];
    const isPrim = (v: unknown): v is Primitive =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean";

    let parsed: unknown = undefined;
    if (bodyText !== undefined && bodyText !== "") {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        return refuse(400, "the body is a JSON array of fields, or { field: [values] }, or empty");
      }
    }

    // The value-scoped REMOVE shape: an object of field → values.
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const spec = parsed as Record<string, unknown>;
      for (const [field, values] of Object.entries(spec)) {
        if (!known.includes(field)) {
          return refuse(400, `version ${vTag} of ${schemaName} has no property "${field}"`);
        }
        if (!Array.isArray(values) || values.length === 0 || !values.every(isPrim)) {
          return refuse(400, `"${field}": a non-empty array of primitive values to remove`);
        }
      }
      try {
        let answered = isLatest
          ? hooks.resolve(schemaName, entity)
          : gateway.resolvePinned(pinned, entity);
        for (const [field, values] of Object.entries(spec)) {
          const node = await hooks.remove(
            schemaName,
            entity,
            field,
            values as Primitive[],
            actorSeed,
          );
          answered = isLatest ? node : gateway.resolvePinned(pinned, entity);
        }
        return { status: 200, body: nodeBody(answered) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/can no longer persist/.test(message)) return refuse(503, message);
        if (/not permitted|was erased|refused|read-only/.test(message)) return refuse(403, message);
        return refuse(400, message);
      }
    }

    // The whole-field CLEAR shape: an array of field names (or empty → all).
    let fields: string[] = known;
    if (parsed !== undefined) {
      if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== "string")) {
        return refuse(400, "the body must be a JSON array of field names");
      }
      for (const f of parsed as string[]) {
        if (!known.includes(f)) {
          return refuse(400, `version ${vTag} of ${schemaName} has no property "${f}"`);
        }
      }
      fields = parsed as string[];
    }
    try {
      const node = await hooks.clear(schemaName, entity, fields, actorSeed);
      const answered = isLatest ? node : gateway.resolvePinned(pinned, entity);
      return { status: 200, body: nodeBody(answered) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/can no longer persist/.test(message)) return refuse(503, message);
      if (/not permitted|was erased|refused|read-only/.test(message)) return refuse(403, message);
      return refuse(400, message);
    }
  }

  return refuse(405, "the rest door speaks GET, POST and DELETE");
}
