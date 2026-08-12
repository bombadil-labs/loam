// The listing door over HTTP (ticket T110): the authed GraphQL door serves `plants(limit,
// after)`; every caller without standing meets the uniform-refusal discipline the transport
// already runs. Railed here because the refusal shapes are transport behavior: a missing token
// and a foreign token get byte-identical 401s (bad credentials never downgrade to anonymous),
// and on the tokenless PUBLIC door the listing field is a validation impossibility — the same
// refusal a field that never existed gets, so no prober learns the authed surface can enumerate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32);
const MOSS = "plant:moss";

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.append([
    observed(FERN, "height", 30, 1000, GARDENER_SEED),
    observed(MOSS, "tag", "soft", 1100, GARDENER_SEED),
  ]);
  await gateway.declarePublic(["Plant"]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "alice-token": { actor: ALICE_SEED } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const gql = (token: string | undefined, query: string) =>
  fetch(`${base}/garden/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query }),
  });

describe("the listing door over HTTP", () => {
  it("the authed door serves the listing, cursor and all", async () => {
    const res = await gql("alice-token", `{ plants { _entity } }`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { plants: { _entity: string }[] } };
    expect(body.data.plants.map((p) => p._entity)).toEqual([FERN, MOSS]);

    const paged = await gql("alice-token", `{ plants(limit: 1, after: "${FERN}") { _entity } }`);
    const pagedBody = (await paged.json()) as { data: { plants: { _entity: string }[] } };
    expect(pagedBody.data.plants.map((p) => p._entity)).toEqual([MOSS]);
  });

  it("no token and a foreign token meet the SAME refusal — no oracle between them", async () => {
    // The public surface is open here (Plant is declared public), so a tokenless caller with a
    // listing query is not turned away at the transport: the field itself must refuse. A caller
    // presenting a WRONG token never reaches even that — bad credentials never downgrade.
    const foreign = await gql("stranger-token", `{ plants { _entity } }`);
    expect(foreign.status).toBe(401);
    const foreignBody = await foreign.text();

    const noVerb = await fetch(`${base}/garden/nosuchverb`, {
      method: "POST",
      headers: { authorization: "Bearer stranger-token" },
    });
    expect(noVerb.status).toBe(401);
    // Byte-identical across a bad token's every probe: the uniform refusal names nothing.
    expect(await noVerb.text()).toBe(foreignBody);
  });

  it("the tokenless public door refuses the listing exactly as a field that never existed", async () => {
    const point = await gql(undefined, `{ plant(entity: "${FERN}") { height } }`);
    expect(point.status).toBe(200);
    expect(
      ((await point.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(30);

    const listing = await gql(undefined, `{ plants { _entity } }`);
    const nonsense = await gql(undefined, `{ plantz { _entity } }`);
    expect(listing.status).toBe(200);
    const listingBody = (await listing.json()) as { data?: unknown; errors: string[] };
    const nonsenseBody = (await nonsense.json()) as { errors: string[] };
    expect(listingBody.data).toBeUndefined();
    expect(listingBody.errors).toHaveLength(1);
    expect(listingBody.errors[0]!.replace(`"plants"`, `"plantz"`)).toBe(nonsenseBody.errors[0]);
  });
});
