import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  b64uDecode,
  contentAddress,
  signClaims,
  type Delta,
  type Schema,
  type Policy,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims } from "../../src/gateway/public.js";
import { buildOpenApi } from "../../src/surface/rest.js";
import { bytesEnvelope, INLINE_MAX, findBytesByRef } from "../../src/gateway/bytes.js";
import {
  parseResolvers,
  type ResolverSpecs,
  type LensName,
} from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";
const L = (n: string): LensName => n as LensName;

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const pickLatest: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };

const PROFILE_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["avatar", pickLatest],
    ["icon", pickLatest],
  ]),
  default: pickLatest,
};
const ICON_RESOLVER: ResolverSpecs = parseResolvers({
  icon: { rung: "a", type: "bytes", code: "export default (bucket) => bucket[0]?.value;" },
});

const SMALL = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const BIG = new Uint8Array(INLINE_MAX + 1).fill(7);

const bytesFact = (
  entity: string,
  field: string,
  mime: string,
  value: Uint8Array,
  ts: number,
): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: entity, context: field } } },
        { role: "value", target: { kind: "bytes", mime, value } },
      ],
    },
    OP_SEED,
  );

const boot = (resolvers?: ResolverSpecs): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PROFILE_SCHEMA,
          roots: [FERN],
          writable: [],
          ...(resolvers === undefined ? {} : { resolvers }),
        },
      ],
    }),
  );

describe("§23.7 the envelope: a bytes leaf becomes { mime, ref, base64url? }", () => {
  it("inlines a small value as base64url, and b64uDecode round-trips it", () => {
    const env = bytesEnvelope({ mime: "image/png", value: SMALL }) as {
      mime: string;
      ref: string;
      base64url?: string;
    };
    expect(env.mime).toBe("image/png");
    expect(env.base64url).toBeDefined();
    expect([...b64uDecode(env.base64url!)]).toEqual([...SMALL]);
  });

  it("a large value is ref-only — no inline base64url above the threshold", () => {
    const env = bytesEnvelope({ mime: "image/png", value: BIG }) as {
      ref: string;
      base64url?: string;
    };
    expect(env.ref).toBeDefined();
    expect(env.base64url).toBeUndefined();
  });

  it("the envelope ref equals contentAddress(rawBytes) — the door's lookup key (rail f)", () => {
    const env = bytesEnvelope({ mime: "image/png", value: SMALL }) as { ref: string };
    expect(env.ref).toBe(contentAddress(SMALL));
  });

  it("passes non-bytes through unchanged and is idempotent (a second pass is a no-op)", () => {
    const view = { a: 1, b: ["x", { mime: "text/plain", value: SMALL }] };
    const once = bytesEnvelope(view);
    const twice = bytesEnvelope(once);
    expect(twice).toEqual(once);
    expect((once as { a: number }).a).toBe(1);
  });

  it("findBytesByRef locates a nested bytes leaf and rejects a foreign ref", () => {
    const view = { avatar: { mime: "image/png", value: SMALL } };
    expect(findBytesByRef(view, contentAddress(SMALL))?.mime).toBe("image/png");
    expect(findBytesByRef(view, contentAddress(BIG))).toBeUndefined();
  });
});

describe("§23.7 the byte-door: proof of read, uniform 404, erasure by construction", () => {
  it("serves the raw bytes (200 + the BytesView's mime) for a ref the resolved view contains (rail b)", async () => {
    const gw = await boot();
    await gw.append([bytesFact(FERN, "avatar", "image/png", SMALL, 1000)]);
    const out = gw.serveBytes(contentAddress(SMALL), L("Plant"), FERN, "full");
    expect(out.status).toBe(200);
    expect(out.contentType).toBe("image/png");
    expect([...out.body]).toEqual([...SMALL]);
    await gw.close();
  });

  it("a wrong `from` entity, an unknown ref, and an unregistered lens each 404 uniformly (rail c)", async () => {
    const gw = await boot();
    await gw.append([bytesFact(FERN, "avatar", "image/png", SMALL, 1000)]);
    const ref = contentAddress(SMALL);
    expect(gw.serveBytes(ref, L("Plant"), "entity:absent", "full").status).toBe(404);
    expect(gw.serveBytes(contentAddress(BIG), L("Plant"), FERN, "full").status).toBe(404);
    expect(gw.serveBytes(ref, L("NoSuchLens"), FERN, "full").status).toBe(404);
    await gw.close();
  });

  it("erasing the source delta makes the ref 404 — §11 falls out for free (rail d)", async () => {
    const gw = await boot();
    const fact = bytesFact(FERN, "avatar", "image/png", SMALL, 1000);
    await gw.append([fact]);
    const ref = contentAddress(SMALL);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "full").status).toBe(200);
    await gw.erase(fact.id, { reason: "the subject asked to be forgotten" });
    expect(gw.serveBytes(ref, L("Plant"), FERN, "full").status).toBe(404);
    await gw.close();
  });

  it("the anonymous door serves bytes only for a publicly-declared lens (else uniform 404)", async () => {
    const gw = await boot();
    await gw.append([bytesFact(FERN, "avatar", "image/png", SMALL, 1000)]);
    const ref = contentAddress(SMALL);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "public").status).toBe(404);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "full").status).toBe(200);
    await gw.append([signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED)]);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "public").status).toBe(200);
    await gw.close();
  });
});

describe("§23.7 typing: a `bytes` field is advertised at the doors (rail e)", () => {
  it("the gql door serializes a bytes field to the envelope and types it BytesValue", async () => {
    const gw = await boot(ICON_RESOLVER);
    await gw.append([bytesFact(FERN, "icon", "image/svg+xml", SMALL, 1000)]);
    const res = await gw.query(`{ plant(entity: "${FERN}") { icon } }`);
    const icon = (
      res.data as { plant: { icon: { mime: string; ref: string; base64url?: string } } }
    ).plant.icon;
    expect(icon.mime).toBe("image/svg+xml");
    expect(icon.ref).toBe(contentAddress(SMALL));
    const t = await gw.query(`{ __type(name: "PlantView") { fields { name type { name } } } }`);
    const fields = (t.data as { __type: { fields: { name: string; type: { name: string } }[] } })
      .__type.fields;
    expect(fields.find((f) => f.name === "icon")?.type.name).toBe("BytesValue");
    await gw.close();
  });

  it("OpenAPI documents a bytes field as format: binary", async () => {
    const gw = await boot(ICON_RESOLVER);
    const doc = buildOpenApi(gw, "full", "almanac") as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    const json = JSON.stringify(doc);
    expect(json).toContain('"format":"binary"');
    await gw.close();
  });
});
