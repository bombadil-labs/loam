// T107's contract: `_hex` and `_hviewHex` are DIGESTS of the canonical bytes, not the bytes
// themselves — `contentAddress` over the canonical CBOR, the same fixed-width multihash form as a
// delta id (`1e20` + blake3-256, 68 hex chars). Digest equality ⇔ byte equality, so every equality
// consumer (arc finale, claims sharing, rest hash-for-hash) keeps its semantics; what changes is
// that the fields stop growing with the answer and stop re-disclosing the view's values.
//
// Both levels (CLAUDE.md P3): the OBJECT level is what the GraphQL door serves (`_hex`,
// `_hviewHex`, live frames); the BYTES level is the digest recomputed in this file from rhizomatic's
// own frozen primitives over the same view/hview. Deliberately out of scope: view CONTENT
// correctness (read.test.ts owns it) and REST/GraphQL door agreement (rest.test.ts owns it).

import { describe, expect, it } from "vitest";
import { contentAddress, hviewCanonicalHex, viewCanonicalHex } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";

const KEEPER_SEED = "c3".repeat(32);

// The delta-id form, written by hand (H10): multihash prefix `1e20` (blake3, 32 bytes) + 64 hex
// chars of digest. Fixed width is the ticket's whole point — the old value grew with the answer.
const DIGEST_RE = /^1e20[0-9a-f]{64}$/;

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

async function keeperGateway(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

type HexPair = { _hex: string; _hviewHex: string };

const hexes = async (gw: Gateway, lens = "plant"): Promise<HexPair> => {
  const answer = await gw.query(`{ ${lens}(entity: "${FERN}") { _hex _hviewHex } }`);
  expect(answer.errors).toBeUndefined();
  return (answer.data as Record<string, HexPair>)[lens]!;
};

describe("_hex and _hviewHex are fixed-width digests of the canonical bytes (T107)", () => {
  it("_hex is contentAddress of the view's canonical CBOR — the delta-id form, recomputed here", async () => {
    const gateway = await keeperGateway();
    const { _hex, _hviewHex } = await hexes(gateway);
    expect(_hex).toMatch(DIGEST_RE);
    expect(_hviewHex).toMatch(DIGEST_RE);

    // The bytes-level pin: the same digest falls out of rhizomatic's frozen primitives over the
    // node the gateway resolved — _hex is not merely digest-shaped, it is THE digest of THE view.
    const node = gateway.resolvedNode("Plant", FERN);
    expect(node.hex).toBe(contentAddress(hexToBytes(viewCanonicalHex(node.view))));
    expect(node.hex).toBe(_hex);

    // And _hviewHex is the digest of the gathered hyperview, recomputed through the same body.
    const evaluated = gateway.reactor.eval(PLANT.body, FERN, gateway.registry);
    if (evaluated.sort !== "hview") throw new Error("Plant did not evaluate to a hyperview");
    expect(_hviewHex).toBe(contentAddress(hexToBytes(hviewCanonicalHex(evaluated.hview))));
    await gateway.close();
  });

  it("digests are stable across arrival orders, and _hviewHex moves when the ground does", async () => {
    const forward = await Gateway.open(new MemoryBackend());
    await forward.append(garden);
    forward.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const backward = await Gateway.open(new MemoryBackend());
    await backward.append([...garden].reverse());
    backward.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    const a = await hexes(forward);
    const b = await hexes(backward);
    expect(a._hex).toBe(b._hex);
    expect(a._hviewHex).toBe(b._hviewHex);

    // New evidence moves the hyperview digest even when it is pinned to the ground, not the answer.
    await forward.append([observed(FERN, "height", 99, 9000, GARDENER_SEED)]);
    const after = await hexes(forward);
    expect(after._hviewHex).not.toBe(a._hviewHex);
    expect(after._hviewHex).toMatch(DIGEST_RE);

    await forward.close();
    await backward.close();
  });

  it("two lenses over one body share _hviewHex while their _hex differ — at digest width", async () => {
    const gateway = await keeperGateway();
    gateway.register(
      { ...PLANT, name: "PlantCount" },
      { props: new Map([["height", { kind: "merge", fn: "count" }]]), default: pickLatest },
      [FERN],
    );
    const a = await hexes(gateway, "plant");
    const b = await hexes(gateway, "plantCount");
    expect(b._hex).toMatch(DIGEST_RE);
    expect(a._hviewHex).toBe(b._hviewHex); // one gathered ground
    expect(a._hex).not.toBe(b._hex); // two adjudications
    await gateway.close();
  });

  it("live frames carry fixed-width hashes and the patch chain still links", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(
      `subscription { plant(entity: "${FERN}") { _hex _fromHex height } }`,
    );
    type Frame = { plant: { _hex: string; _fromHex: string | null } };
    const initial = ((await events.next()).value as Frame).plant;
    expect(initial._fromHex).toBeNull();
    expect(initial._hex).toMatch(DIGEST_RE);

    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    const patch = ((await events.next()).value as Frame).plant;
    expect(patch._fromHex).toBe(initial._hex); // the chain is digest → digest now
    expect(patch._hex).toMatch(DIGEST_RE);
    expect(patch._hex).not.toBe(initial._hex);

    await events.return(undefined);
    await gateway.close();
  });

  it("the leak is closed: neither field contains the view's legible strings any more", async () => {
    const marker = "PELICAN-BRIEF-1977";
    const gateway = await keeperGateway();
    await gateway.append([observed(FERN, "tag", marker, 9500, GARDENER_SEED)]);
    const markerHex = Buffer.from(marker, "utf8").toString("hex");

    // The premise, so the absence below cannot pass vacuously (H10): the canonical BYTES of both
    // levels really do carry the marker legibly — that is exactly what the old fields re-disclosed.
    const node = gateway.resolvedNode("Plant", FERN);
    expect(viewCanonicalHex(node.view)).toContain(markerHex);
    const evaluated = gateway.reactor.eval(PLANT.body, FERN, gateway.registry);
    if (evaluated.sort !== "hview") throw new Error("Plant did not evaluate to a hyperview");
    expect(hviewCanonicalHex(evaluated.hview)).toContain(markerHex);

    // The rail: what the door serves discloses neither the marker nor anything else — 68 chars of
    // digest, whatever the answer's size.
    const { _hex, _hviewHex } = await hexes(gateway);
    expect(_hex).not.toContain(markerHex);
    expect(_hviewHex).not.toContain(markerHex);
    expect(_hex).toMatch(DIGEST_RE);
    expect(_hviewHex).toMatch(DIGEST_RE);
    await gateway.close();
  });
});
