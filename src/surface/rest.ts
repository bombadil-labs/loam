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

// The version families a door may see: every surviving version whose schema name the door's
// registered set admits (the public door admits only declared lenses — narrowing, never
// widening).
function versionsFor(gateway: Gateway, door: "full" | "public"): RegistrationVersion[] {
  const surface = gateway.surface(door);
  if (surface === undefined) return [];
  const admitted = new Set(surface.registered.map((r) => r.schema.name));
  return gateway.registrationVersions().filter((v) => admitted.has(v.schema.name));
}

// vN aliases are PER SCHEMA NAME: Film v1 and Book v1 coexist. Ground order within a name.
function aliased(versions: readonly RegistrationVersion[]): Map<string, RegistrationVersion[]> {
  const byName = new Map<string, RegistrationVersion[]>();
  for (const v of versions) {
    const list = byName.get(v.schema.name);
    if (list === undefined) byName.set(v.schema.name, [v]);
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
      return { description: 'resolved by a merge policy — its reduction"s type' };
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
      const viewProperties: Record<string, unknown> = {
        _entity: { type: "string" },
        _hex: { type: "string", description: "the content address of this resolved view" },
      };
      const writeProperties: Record<string, unknown> = {};
      for (const [prop, pp] of v.policy.props) {
        viewProperties[prop] = propSchema((pp as { kind: string }).kind);
        writeProperties[prop] = {
          description: "a primitive claim value (string | number | boolean)",
        };
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
                    _hex: { type: "string" },
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
export async function handleRest(
  gateway: Gateway,
  door: "full" | "public",
  method: string,
  segments: readonly string[],
  bodyText: string | undefined,
  actorSeed?: string,
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
    pinned = versions.find((v) => v.deltaId === hash && v.schema.name === schemaName);
    if (pinned === undefined) {
      // Withdrawn is not never-existed: if the ground still HOLDS that delta as a
      // registration but it no longer survives, the honest answer is 410 Gone.
      const held = gateway.reactor.get(hash);
      const wasRegistration =
        held !== undefined &&
        held.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
        );
      return wasRegistration
        ? refuse(410, `that version was withdrawn by the operator — it is remembered, not served`)
        : refuse(404, `no version @${hash.slice(0, 12)}… of ${schemaName} survives`);
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
    const node = isLatest
      ? hooks.resolve(schemaName, entity)
      : gateway.resolvePinned(pinned, entity);
    return {
      status: 200,
      body: {
        entity: node.entity,
        view: node.view,
        _hex: node.hex,
        _hviewHex: node.hviewHex,
      },
    };
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
    const known = new Set(pinned.policy.props.keys());
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
      return {
        status: 200,
        body: {
          entity: answered.entity,
          view: answered.view,
          _hex: answered.hex,
          _hviewHex: answered.hviewHex,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return refuse(/not permitted|refused/.test(message) ? 403 : 400, message);
    }
  }

  return refuse(405, "the rest door speaks GET and POST");
}
