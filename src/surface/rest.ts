import type { Primitive } from "@bombadil/rhizomatic";
import { bytesEnvelope } from "../gateway/bytes.js";
import type { ConnectionBinding, Gateway } from "../gateway/gateway.js";
import { lensOf } from "../gateway/registration.js";
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

function versionsFor(gateway: Gateway, door: "full" | "public"): RegistrationVersion[] {
  const all = gateway.registrationVersions();
  if (door === "full") {
    const surface = gateway.surface("full");
    if (surface === undefined) return [];
    const admitted = new Set(surface.registered.map((r) => lensOf(r)));
    return all.filter((v) => admitted.has(lensOf(v)));
  }
  const surface = gateway.surface("public");
  const bare = new Set((surface?.registered ?? []).map((r) => lensOf(r)));
  const latest = new Map<string, RegistrationVersion>();
  for (const v of all) if (bare.has(lensOf(v))) latest.set(lensOf(v), v);
  const out = [...latest.values()];
  for (const v of all) {
    if (gateway.isPublicPin(lensOf(v), v.deltaId) && !out.includes(v)) out.push(v);
  }
  return out;
}

function aliased(versions: readonly RegistrationVersion[]): Map<string, RegistrationVersion[]> {
  const byName = new Map<string, RegistrationVersion[]>();
  for (const v of versions) {
    const list = byName.get(lensOf(v));
    if (list === undefined) byName.set(lensOf(v), [v]);
    else list.push(v);
  }
  return byName;
}

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

function resolverPropSchema(type: string): Record<string, unknown> {
  if (type === "bytes") {
    return {
      type: "object",
      format: "binary",
      description:
        "a bytes value (SPEC §23.7): { mime, ref, base64url? } — fetch raw bytes at /bytes/<ref>?from=<lens>/<entity>",
    };
  }
  const jsonType =
    type === "number"
      ? "number"
      : type === "boolean"
        ? "boolean"
        : type === "list"
          ? "array"
          : type === "object"
            ? "object"
            : "string";
  return {
    type: jsonType,
    description: `resolved by a custom resolver (SPEC §22, output "${type}")`,
  };
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
      const viewProperties: Record<string, unknown> = {};
      const writeProperties: Record<string, unknown> = {};
      const writable = new Set(v.writable ?? []);
      for (const [prop, pp] of v.schema.props) {
        const resolver = v.resolvers?.[prop];
        viewProperties[prop] =
          resolver === undefined
            ? propSchema((pp as { kind: string }).kind)
            : resolverPropSchema(resolver.type);
        if (writable.has(prop)) {
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
      version: "live",
      description:
        "A materialized surface over a Loam store (SPEC §17). Every version listed here " +
        "stays answerable; @<registration-hash> addresses a version by its true name.",
    },
    paths,
  };
}

const nodeBody = (node: {
  entity: string;
  view: Record<string, unknown>;
  hex: string;
  hviewHex: string;
  asOf?: number;
  forgotten?: number[];
}): Record<string, unknown> => ({
  entity: node.entity,
  view: bytesEnvelope(node.view),
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
  binding?: ConnectionBinding,
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

  let asOf: number | undefined;
  if (asOfRaw !== undefined && asOfRaw !== "") {
    const t = Number(asOfRaw);
    if (!Number.isFinite(t)) return refuse(400, "asOf must be a numeric timestamp (milliseconds)");
    asOf = t;
  }

  const versions = versionsFor(gateway, door);
  const family = aliased(versions).get(schemaName);

  let pinned: RegistrationVersion | undefined;
  if (/^v[1-9]\d*$/.test(vTag)) {
    const n = Number(vTag.slice(1));
    pinned = family?.[n - 1];
    if (pinned === undefined) return refuse(404, `no version ${vTag} of ${schemaName} survives`);
  } else if (vTag.startsWith("@")) {
    const hash = vTag.slice(1);
    pinned = versions.find((v) => v.deltaId === hash && lensOf(v) === schemaName);
    if (pinned === undefined) {
      if (door === "full") {
        const withdrawn = gateway.withdrawnRegistrations();
        if (withdrawn.some((w) => w.deltaId === hash && w.lensName === schemaName)) {
          return refuse(
            410,
            "that version was withdrawn by the operator — it is remembered, not served",
          );
        }
      }
      return refuse(404, `no version @${hash.slice(0, 12)}… of ${schemaName} survives`);
    }
  } else {
    return refuse(404, "a version is v<N> or @<registration-hash>");
  }

  const liveSurface = gateway.surface(door);
  const servesLive = liveSurface?.registered.some((r) => lensOf(r) === schemaName) ?? false;
  const trueLatest = gateway
    .registrationVersions()
    .filter((v) => lensOf(v) === schemaName)
    .at(-1);
  const isLatest = servesLive && pinned.deltaId === trueLatest?.deltaId;

  if (method === "GET") {
    try {
      const node =
        isLatest && liveSurface !== undefined
          ? liveSurface.hooks.resolve(schemaName, entity, asOf, binding)
          : gateway.resolvePinned(pinned, entity, asOf, undefined, binding);
      return { status: 200, body: nodeBody(node) };
    } catch (err) {
      return refuse(400, err instanceof Error ? err.message : String(err));
    }
  }

  if (liveSurface === undefined) return refuse(404, "nothing here is public");
  const hooks: SurfaceHooks = liveSurface.hooks;

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
      const node = await hooks.mutate(schemaName, entity, clean, actorSeed, binding);
      const answered = isLatest
        ? node
        : gateway.resolvePinned(pinned, entity, undefined, undefined, binding);
      return { status: 200, body: nodeBody(answered) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/can no longer persist/.test(message)) return refuse(503, message);
      if (/not permitted|was erased|refused|read-only/.test(message)) return refuse(403, message);
      return refuse(400, message);
    }
  }

  if (method === "DELETE") {
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
          ? hooks.resolve(schemaName, entity, undefined, binding)
          : gateway.resolvePinned(pinned, entity, undefined, undefined, binding);
        for (const [field, values] of Object.entries(spec)) {
          const node = await hooks.remove(
            schemaName,
            entity,
            field,
            values as Primitive[],
            actorSeed,
            binding,
          );
          answered = isLatest
            ? node
            : gateway.resolvePinned(pinned, entity, undefined, undefined, binding);
        }
        return { status: 200, body: nodeBody(answered) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/can no longer persist/.test(message)) return refuse(503, message);
        if (/not permitted|was erased|refused|read-only/.test(message)) return refuse(403, message);
        return refuse(400, message);
      }
    }

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
      const node = await hooks.clear(schemaName, entity, fields, actorSeed, binding);
      const answered = isLatest
        ? node
        : gateway.resolvePinned(pinned, entity, undefined, undefined, binding);
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
