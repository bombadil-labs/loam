import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 30_000 });

import { grantClaims, revocationClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const THREAD_SEED = "70".repeat(32);
const NOTE_SEED = "e0".repeat(32);
const BARE_SEED = "ba".repeat(32);
const ADMIN_SEED = "ad".repeat(32);
const ADMIN = authorForSeed(ADMIN_SEED);
const THREAD = authorForSeed(THREAD_SEED);
const NOTE = authorForSeed(NOTE_SEED);

const REFUSAL = "registration is constitutional: it requires an operator token";

const PICK = { pick: { order: { byTimestamp: "desc" } } };

const bodyFor = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hyperschema: {
    name,
    alg: 1,
    body: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  },
  schema: { props: { color: PICK }, default: PICK },
  roots: ["thing:1"],
  writable: ["color"],
  ...extra,
});

const MALFORMED = {
  hyperschema: { name: "thread:broken", alg: 1, body: { op: "no-such-op" } },
  schema: { default: PICK },
  roots: [],
};

interface Bench {
  readonly base: string;
  readonly gateway: Gateway;
  close(): Promise<void>;
  register(token: string, body: unknown): Promise<Response>;
  mcpRegister(token: string, body: unknown): Promise<{ text: string; isError?: boolean }>;
  gql(token: string, source: string): Promise<{ data?: unknown; errors?: unknown[] }>;
  grant(subject: string, prefix: string): Promise<string>;
  revoke(deltaId: string): Promise<void>;
}

let live: ServerHandle | undefined;
let liveGateway: Gateway | undefined;

afterEach(async () => {
  await live?.close();
  await liveGateway?.close();
  live = undefined;
  liveGateway = undefined;
});

async function bench(): Promise<Bench> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  const handle = await serve({
    mounts: { world: gateway },
    tokens: {
      "op-token": { operator: true },
      "thread-token": { actor: THREAD_SEED },
      "note-token": { actor: NOTE_SEED },
      "bare-token": { actor: BARE_SEED },
      "junk-token": { actor: "not-a-signing-seed" },
      "admin-token": { actor: ADMIN_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  live = handle;
  liveGateway = gateway;
  const base = handle.url;
  let clock = 1000;

  const post = (path: string, token: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  return {
    base,
    gateway,
    close: async () => {
      await handle.close();
      await gateway.close();
      live = undefined;
      liveGateway = undefined;
    },
    register: (token, body) => post("/world/register", token, body),
    mcpRegister: async (token, body) => {
      const res = await post("/world/mcp", token, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "loam_register", arguments: body },
      });
      const parsed = (await res.json()) as {
        result: { content: { text: string }[]; isError?: boolean };
      };
      return {
        text: parsed.result.content[0]!.text,
        ...(parsed.result.isError === undefined ? {} : { isError: parsed.result.isError }),
      };
    },
    gql: async (token, source) => {
      const res = await post("/world/graphql", token, { query: source });
      return (await res.json()) as { data?: unknown; errors?: unknown[] };
    },
    grant: async (subject, prefix) => {
      clock += 1;
      const delta = signClaims(
        grantClaims(STORE_ENTITY, subject, "register", OPERATOR, clock, prefix),
        OPERATOR_SEED,
      );
      await gateway.append([delta]);
      return delta.id;
    },
    revoke: async (deltaId) => {
      clock += 1;
      await gateway.append([signClaims(revocationClaims(deltaId, OPERATOR, clock), OPERATOR_SEED)]);
    },
  };
}

const errorsOf = async (res: Response): Promise<string[]> =>
  ((await res.json()) as { errors?: string[] }).errors ?? [];

describe("T174 rail 1 — a granted connection registers inside its prefix, and the type serves", () => {
  it("thread: registers thread:groove; the surface answers at that name", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");

    const res = await b.register("thread-token", bodyFor("thread:groove"));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { registered: string; lens: string; bound: boolean };
    expect(outcome.registered).toBe("thread:groove");
    expect(outcome.lens).toBe("thread:groove");
    expect(outcome.bound).toBe(true);

    const read = await b.gql("op-token", `{ thread_groove(entity: "thing:1") { _hex } }`);
    expect(read.errors).toBeUndefined();
    const write = await b.gql(
      "op-token",
      `mutation { thread_groove(entity: "thing:1", color: "amber") { color } }`,
    );
    expect(write.errors).toBeUndefined();
  });

  it("the MCP door is the same door", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const ok = await b.mcpRegister("thread-token", bodyFor("thread:pond"));
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(ok.text)).toMatchObject({ registered: "thread:pond", bound: true });
  });
});

describe("T174 rails 2+3 — the prefix is a fence, and every escape draws ONE refusal", () => {
  const ESCAPES: readonly (readonly [string, string])[] = [
    ["a neighbouring namespace", "note:anything"],
    ["the ROOT namespace (rail 3)", "Rock"],
    ["the prefix appearing later in the name", "x-thread:foo"],
    ["a leading space before the prefix", " thread:foo"],
    ["the prefix with its separator shaved off", "thread"],
    ["an ASCII case variation", "Thread:foo"],
    ["a percent-encoded separator", "thread%3Afoo"],
    ["a fullwidth colon", "thread：foo"],
  ];

  it("the escape list is not vacuous", () => {
    expect(ESCAPES.length).toBeGreaterThanOrEqual(8);
  });

  for (const [why, name] of ESCAPES) {
    it(`${why} (${JSON.stringify(name)}) is refused with the EXISTING message, byte for byte`, async () => {
      const b = await bench();
      await b.grant(THREAD, "thread:");
      const res = await b.register("thread-token", bodyFor(name));
      expect(res.status).toBe(403);
      expect(await errorsOf(res)).toEqual([REFUSAL]);
      const inside = await b.register("thread-token", bodyFor("thread:ok"));
      expect(inside.status, "this token DOES hold register standing here").toBe(200);
    });
  }

  it("A SCHEMA NAME MAY NOT REDIRECT THE READING OUT OF THE FENCE (H6)", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:groove", { schema: { name: "User", props: { color: PICK }, default: PICK } }),
    );
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
    const probe = await b.gql("op-token", `{ user(entity: "thing:1") { _hex } }`);
    expect(probe.errors).toBeDefined();
  });

  it("a schema name INSIDE the fence is fine — a scope may carry sibling readings", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:groove", {
        schema: { name: "thread:groove:desc", props: { color: PICK }, default: PICK },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { lens: string }).toMatchObject({ lens: "thread:groove:desc" });
  });

  it("an explicit `entity` may not redirect the registration out of the fence", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:ok", { entity: "hyperschema:Rock" }),
    );
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });

  it("an explicit `entity` that IS the derived default is fine — redundant, not a redirect", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:ok", { entity: "hyperschema:thread:ok" }),
    );
    expect(res.status).toBe(200);
  });

  it("the MCP door refuses out-of-fence with the same string", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const denied = await b.mcpRegister("thread-token", bodyFor("note:anything"));
    expect(denied.isError).toBe(true);
    expect(denied.text).toBe(REFUSAL);
  });

  it("a token with no register standing is refused exactly as before this ticket", async () => {
    const b = await bench();
    const res = await b.register("bare-token", bodyFor("Rock"));
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });

  it("a token whose actor names no key REFUSES rather than faulting", async () => {
    const b = await bench();
    const res = await b.register("junk-token", bodyFor("thread:groove"));
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });
});

describe("T174 rail 4 — authority before shape, under BOTH tiers", () => {
  it("authorized caller + malformed payload → the SHAPE refusal", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register("thread-token", MALFORMED);
    expect(res.status).toBe(400);
    const errors = await errorsOf(res);
    expect(errors).not.toEqual([REFUSAL]);
    expect(errors.join(" ")).toContain("no-such-op");
  });

  it("UNAUTHORIZED caller + the same malformed payload → the AUTHORITY refusal", async () => {
    const b = await bench();
    const res = await b.register("bare-token", MALFORMED);
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });

  it("an EMPTY name is a shape fault, not a fence fault — and the tiers still diverge", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const shaped = await b.register("thread-token", bodyFor(""));
    expect(shaped.status).toBe(400);
    expect((await errorsOf(shaped)).join(" ")).toContain("name");

    const denied = await b.register("bare-token", bodyFor(""));
    expect(denied.status).toBe(403);
    expect(await errorsOf(denied)).toEqual([REFUSAL]);
  });

  it("a granted caller whose payload is malformed AND out of fence still gets SHAPE", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register("thread-token", {
      ...MALFORMED,
      hyperschema: { ...MALFORMED.hyperschema, name: "note:broken" },
    });
    expect(res.status).toBe(400);
  });

  it("both tiers hold on the MCP door too", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const shaped = await b.mcpRegister("thread-token", MALFORMED);
    expect(shaped.isError).toBe(true);
    expect(shaped.text).not.toBe(REFUSAL);
    const denied = await b.mcpRegister("bare-token", MALFORMED);
    expect(denied.isError).toBe(true);
    expect(denied.text).toBe(REFUSAL);
  });
});

describe("T174 rail 5 — re-registration inside the fence evolves the type", () => {
  it("a second registration at the same name serves the new shape", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    expect((await b.register("thread-token", bodyFor("thread:groove"))).status).toBe(200);

    const evolved = await b.register(
      "thread-token",
      bodyFor("thread:groove", {
        schema: { props: { color: PICK, mood: PICK }, default: PICK },
        writable: ["color", "mood"],
      }),
    );
    expect(evolved.status).toBe(200);
    expect((await evolved.json()) as { bound: boolean }).toMatchObject({ bound: true });

    const read = await b.gql("op-token", `{ thread_groove(entity: "thing:1") { color mood } }`);
    expect(read.errors).toBeUndefined();
  });

  it("a re-registration whose templates would take `writable` down refuses LOUDLY, and the standing write surface survives", async () => {
    const b = await bench();
    expect((await b.register("op-token", bodyFor("thread:groove"))).status).toBe(200);
    expect(
      (
        await b.gql(
          "op-token",
          `mutation { thread_groove(entity: "thing:1", color: "amber") { color } }`,
        )
      ).errors,
    ).toBeUndefined();

    const bad = await b.register(
      "op-token",
      bodyFor("thread:groove", {
        mutations: { water: { pointers: [{ role: "value", context: "watered", value: true }] } },
      }),
    );
    expect(bad.status).toBe(400);
    const errors = (await errorsOf(bad)).join(" ");
    expect(errors).toContain("water");
    expect(errors).not.toBe(REFUSAL);

    const still = await b.gql(
      "op-token",
      `mutation { thread_groove(entity: "thing:1", color: "slate") { color } }`,
    );
    expect(still.errors).toBeUndefined();
  });
});

describe("T174 rails 6+7 — revocation binds at once, and it moves exactly one connection", () => {
  it("the next registration after a revoke refuses, and the bystander is untouched", async () => {
    const b = await bench();
    const threadGrant = await b.grant(THREAD, "thread:");
    await b.grant(NOTE, "note:");

    expect((await b.register("thread-token", bodyFor("thread:one"))).status).toBe(200);
    expect((await b.register("note-token", bodyFor("note:one"))).status).toBe(200);

    expect((await b.register("note-token", bodyFor("thread:two"))).status).toBe(403);
    expect((await b.register("thread-token", bodyFor("note:two"))).status).toBe(403);

    await b.revoke(threadGrant);

    const after = await b.register("thread-token", bodyFor("thread:three"));
    expect(after.status).toBe(403);
    expect(await errorsOf(after)).toEqual([REFUSAL]);

    expect((await b.register("note-token", bodyFor("note:three"))).status).toBe(200);

    expect(
      (await b.gql("op-token", `{ thread_one(entity: "thing:1") { _hex } }`)).errors,
    ).toBeUndefined();
  });
});

describe("T174 — a scoped caller ships no code and claims no global field name", () => {
  const RESOLVER = (marker: string): Record<string, unknown> => ({
    color: {
      rung: "a",
      type: "string",
      code:
        `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(marker)}, String(process.pid));\n` +
        `export default () => "owned";\n`,
    },
  });

  it("RESOLVERS ARE REFUSED, and the code DOES NOT RUN", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "loam-t174-rce-")), "pwned");
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:pwn", { resolvers: RESOLVER(marker) }),
    );
    expect(res.status).toBe(400);
    const errors = (await errorsOf(res)).join(" ");
    expect(errors).toContain("resolvers");
    expect(errors).not.toBe(REFUSAL);
    expect(existsSync(marker), "the resolver's ESM must never have been imported").toBe(false);
    expect(
      (await b.gql("op-token", `{ thread_pwn(entity: "thing:1") { _hex } }`)).errors,
    ).toBeDefined();
  });

  it("MUTATION TEMPLATES ARE REFUSED — the field namespace is global and unfenced", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:squat", {
        mutations: { user: { pointers: [{ role: "color", at: { arg: "on" }, context: "color" }] } },
      }),
    );
    expect(res.status).toBe(400);
    expect((await errorsOf(res)).join(" ")).toContain("mutations");
  });

  it("...and the squat it prevents: the operator's own lens still builds afterwards", async () => {
    const b = await bench();
    await b.grant(THREAD, "thread:");
    await b.register(
      "thread-token",
      bodyFor("thread:squat", {
        mutations: { user: { pointers: [{ role: "color", at: { arg: "on" }, context: "color" }] } },
      }),
    );
    const operatorLens = await b.register("op-token", bodyFor("User"));
    expect(operatorLens.status).toBe(200);
    expect((await operatorLens.json()) as { bound: boolean }).toMatchObject({ bound: true });
    expect(
      (await b.gql("op-token", `{ user(entity: "thing:1") { _hex } }`)).errors,
    ).toBeUndefined();
  });

  it("THE OPERATOR KEEPS BOTH — nothing an operator could do yesterday is refused today", async () => {
    const b = await bench();
    const res = await b.register(
      "op-token",
      bodyFor("Rock", {
        mutations: {
          paint: { pointers: [{ role: "color", at: { arg: "on" }, context: "color" }] },
        },
        resolvers: {
          color: { rung: "a", type: "string", code: `export default () => "granite";\n` },
        },
      }),
    );
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await res.json()) as { bound: boolean }).toMatchObject({ bound: true });
  });

  it("the refusals are still gated on standing: an UNAUTHORIZED caller gets AUTHORITY", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "loam-t174-rce2-")), "pwned");
    const b = await bench();
    const res = await b.register(
      "bare-token",
      bodyFor("thread:pwn", { resolvers: RESOLVER(marker) }),
    );
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("T174 — only the OPERATOR mints register standing", () => {
  it("an ADMIN-authored register grant confers nothing", async () => {
    const b = await bench();
    const adminGrant = signClaims(
      grantClaims(STORE_ENTITY, ADMIN, "admin", OPERATOR, 500),
      OPERATOR_SEED,
    );
    await b.gateway.append([adminGrant]);
    await b.gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ADMIN, "register", ADMIN, 501, "User"), ADMIN_SEED),
    ]);
    const res = await b.register("admin-token", bodyFor("User"));
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });

  it("...while the same grant signed by the OPERATOR does confer it", async () => {
    const b = await bench();
    await b.gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ADMIN, "admin", OPERATOR, 500), OPERATOR_SEED),
      signClaims(
        grantClaims(STORE_ENTITY, ADMIN, "register", OPERATOR, 501, "User"),
        OPERATOR_SEED,
      ),
    ]);
    expect((await b.register("admin-token", bodyFor("User"))).status).toBe(200);
  });
});
