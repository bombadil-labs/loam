import { seedSigner } from "./signer.js";
import type { Claims } from "@bombadil/rhizomatic";
import type { Gateway, RequestContext } from "./gateway.js";
import { lensOf, type LensName } from "./registration.js";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import { withStamp } from "./stamp.js";
import type { Ground } from "./ground.js";

export const PUBLIC_ENTITY = "loam:public";
export const CTX_PUBLIC = "loam.public";

export function publicClaims(
  schemas: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: PUBLIC_ENTITY, context: CTX_PUBLIC } },
      },
      ...schemas.map((s) => ({
        role: "schema",
        target: { kind: "primitive" as const, value: s },
      })),
    ],
  };
}

export function publicDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === PUBLIC_ENTITY &&
      p.target.entity.context === CTX_PUBLIC,
  );
  if (!declares) return undefined;
  const schemas = claims.pointers.filter((p) => p.role === "schema");
  if (schemas.length === 0) {
    return "a public-read declaration names at least one schema";
  }
  for (const p of schemas) {
    if (
      p.target.kind !== "primitive" ||
      typeof p.target.value !== "string" ||
      p.target.value === ""
    ) {
      return "a public-read declaration's schema entries are non-empty schema names";
    }
  }
  return undefined;
}

export function readPublicSchemas(
  reactor: Ground,
  now: number,
  operator?: string | readonly string[],
): ReadonlySet<string> {
  const open = new Set<string>();
  const authors =
    operator === undefined ? [] : typeof operator === "string" ? [operator] : operator;
  for (const author of authors) {
    const negated = negatedAt(reactor, now, author);
    for (const delta of lawfulDeltasAt(
      reactor,
      now,
      { entity: PUBLIC_ENTITY, context: CTX_PUBLIC },
      author,
    )) {
      if (negated(delta.id)) continue;
      for (const p of delta.claims.pointers) {
        if (
          p.role === "schema" &&
          p.target.kind === "primitive" &&
          typeof p.target.value === "string" &&
          p.target.value !== ""
        ) {
          open.add(p.target.value);
        }
      }
    }
  }
  return open;
}

export async function declarePublicImpl(
  gw: Gateway,
  entries: readonly string[],
  context?: RequestContext,
): Promise<void> {
  const signer = context?.actor !== undefined ? seedSigner(context.actor) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot declare a lens public");
  }
  if (gw.operatorAuthor !== undefined && signer.author !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may declare a lens public");
  }
  const resolved = entries.map((entry) => freezePublicEntry(gw, entry));
  await gw.append([
    signer.sign(
      withStamp(gw.stamp(signer.author), (t) => publicClaims(resolved, signer.author, t)),
    ),
  ]);
}

function freezePublicEntry(gw: Gateway, entry: string): string {
  const at = entry.indexOf("@");
  if (at < 0) return entry;
  const name = entry.slice(0, at) as LensName;
  const ver = entry.slice(at + 1);
  const m = /^v([1-9]\d*)$/.exec(ver);
  if (m === null) return entry;
  const versions = gw.registrationVersions().filter((v) => lensOf(v) === name);
  const pinned = versions[Number(m[1]) - 1];
  if (pinned === undefined) {
    throw new Error(`public: schema "${name}" has no version v${m[1]} (it has ${versions.length})`);
  }
  return `${name}@${pinned.deltaId}`;
}
