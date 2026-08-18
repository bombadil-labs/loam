// T174 — an authorized connection registers inside its own namespace.
//
// The OBJECT-level half of the ticket: what the two registration doors (POST /:mount/register and
// the MCP `loam_register` tool) actually serve and actually refuse. `test/gateway/register-fence.ts`
// asserts the fence predicate and the grant vocabulary in the deltas; a correct predicate wired to
// the wrong door is exactly what that level cannot see, so both exist.
//
// THREE PROPERTIES THIS FILE EXISTS TO PIN, all of them security-relevant:
//
//  1. AUTHORITY BEFORE SHAPE. A caller with no register standing draws the authority refusal even
//     when its payload is garbage, so nobody can fingerprint the registration format by diffing
//     error messages. A caller WITH standing gets the shape complaint, because it is entitled to it.
//  2. ONE REFUSAL FOR EVERY OUT-OF-FENCE TARGET, byte-identical to the message a tokenless stranger
//     has always drawn. Root and a neighbour's namespace refuse the same way, so a client learns
//     nothing about whether either is grantable to anyone (§12/T78).
//  3. THE FENCE IS TWO-SIDED. A grant and a revocation move exactly one connection's standing; a
//     bystander holding a different prefix is untouched by either.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 30_000 }); // real listening servers

import { grantClaims, revocationClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const THREAD_SEED = "70".repeat(32); // the connector granted `thread:`
const NOTE_SEED = "e0".repeat(32); // the bystander connector, granted `note:`
const BARE_SEED = "ba".repeat(32); // a token with no register standing at all
const ADMIN_SEED = "ad".repeat(32); // an effective store admin
const ADMIN = authorForSeed(ADMIN_SEED);
const THREAD = authorForSeed(THREAD_SEED);
const NOTE = authorForSeed(NOTE_SEED);

// The exact string a caller denied at this door has always received. Byte-for-byte: a client must
// not be able to tell "you may not register here" from "nobody may register here".
const REFUSAL = "registration is constitutional: it requires an operator token";

const PICK = { pick: { order: { byTimestamp: "desc" } } };

// A well-formed registration under an arbitrary name — the fence's only input is that name.
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

// A payload that cannot parse: the term names an operator rhizomatic does not have.
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

// A fresh governed store and server per test: registrations are permanent, so a shared bench would
// let one case's surface decide another's.
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

    // The type SERVES: `thread:groove` mangles to the GraphQL field `thread_groove`.
    const read = await b.gql("op-token", `{ thread_groove(entity: "thing:1") { _hex } }`);
    expect(read.errors).toBeUndefined();
    // And its declared write surface works — the registration landed whole, not half.
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
  // Each near-miss is asserted separately: a loop over a list would let one silently-admitted
  // shape hide behind its neighbours' refusals.
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
      // THE DISCRIMINATING HALF. The refusal is deliberately non-discriminating, so "403 + that
      // string" alone cannot tell "fenced out of a namespace it holds" from "never had standing at
      // all" — and with the fence reverted this assertion would still pass. The same token, on the
      // same bench, registering an IN-FENCE name is what makes the pair mean something.
      const inside = await b.register("thread-token", bodyFor("thread:ok"));
      expect(inside.status, "this token DOES hold register standing here").toBe(200);
    });
  }

  it("A SCHEMA NAME MAY NOT REDIRECT THE READING OUT OF THE FENCE (H6)", async () => {
    // A registration has TWO names: the PROGRAM it is over (`hyperschema.name`) and the READING it
    // is (`schema.name ?? hyperschema.name`). The reading is what decides the living Schema entity
    // `schema:<lens>` and the GraphQL field the surface answers at. Fencing only the program would
    // let a `thread:` connection publish a program called `thread:groove` whose READING is `User` —
    // clobbering the operator's own living Schema and taking the root GraphQL field with it.
    const b = await bench();
    await b.grant(THREAD, "thread:");
    const res = await b.register(
      "thread-token",
      bodyFor("thread:groove", { schema: { name: "User", props: { color: PICK }, default: PICK } }),
    );
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
    // Nothing landed: the root field the escape aimed at does not answer.
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
    // The name is inside the fence; the entity points at the operator's own registration slot.
    // Everything a registration plants is derived from the NAME, so the entity is the one field
    // that could carry a scoped write somewhere the name does not reach.
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
    // `actor` is a signing seed, and the door derives an author from it to read standing. A
    // configured token carrying junk must fail CLOSED at the refusal, not throw its way to a 500 —
    // an error the caller can tell apart from a refusal is an oracle, and a crash is one.
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
    // The whole point: the two callers send byte-identical bodies and the answers must diverge on
    // WHO ASKED, not on what they sent. An outsider learns nothing about the registration format.
    const b = await bench();
    const res = await b.register("bare-token", MALFORMED);
    expect(res.status).toBe(403);
    expect(await errorsOf(res)).toEqual([REFUSAL]);
  });

  it("an EMPTY name is a shape fault, not a fence fault — and the tiers still diverge", async () => {
    // An empty name never reaches the fence: `hyperschema.name` is refused at the parse. That is
    // the stated order, so this pins it rather than pretending the fence caught it — and the
    // unauthorized half proves the shape complaint is still gated on standing.
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
    // Ordering inside the authorized tier: the parse runs first, so the fence never has to read an
    // unparsed name. A holder of register standing is entitled to the shape complaint either way.
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
    // T96's failure traffic. A malformed `mutations` payload is what used to shed `writable` on the
    // way to a bound surface, silently revoking a declared write door. The fix makes the door refuse
    // at the parse and name the template — so this is two-sided: the bad publish lands nothing, and
    // the writable field declared by the FIRST registration still accepts a write afterwards.
    //
    // AT THE OPERATOR TIER, because that is now the only tier where `mutations` exists at all: a
    // scoped caller is refused the field outright, one gate earlier (see the code/namespace block
    // below). The T96 defect lives in the template reader, which is tier-independent, so this
    // exercises it where the field is still reachable.
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
        // `{ role, context, value }` is the exact shape parseClaimTemplates refuses.
        mutations: { water: { pointers: [{ role: "value", context: "watered", value: true }] } },
      }),
    );
    expect(bad.status).toBe(400);
    const errors = (await errorsOf(bad)).join(" ");
    expect(errors).toContain("water"); // the template is NAMED
    expect(errors).not.toBe(REFUSAL);

    // The bystander field: `color` was declared writable and is still writable.
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

    // Both stand.
    expect((await b.register("thread-token", bodyFor("thread:one"))).status).toBe(200);
    expect((await b.register("note-token", bodyFor("note:one"))).status).toBe(200);

    // ...and neither can reach the other's namespace, before anything is revoked.
    expect((await b.register("note-token", bodyFor("thread:two"))).status).toBe(403);
    expect((await b.register("thread-token", bodyFor("note:two"))).status).toBe(403);

    await b.revoke(threadGrant);

    // AT ONCE: no restart, no cache to expire. The very next request refuses.
    const after = await b.register("thread-token", bodyFor("thread:three"));
    expect(after.status).toBe(403);
    expect(await errorsOf(after)).toEqual([REFUSAL]);

    // TWO-SIDED: the bystander's standing survives the strike.
    expect((await b.register("note-token", bodyFor("note:three"))).status).toBe(200);

    // And what the revoked connection already registered still serves — revocation is not erasure.
    expect(
      (await b.gql("op-token", `{ thread_one(entity: "thing:1") { _hex } }`)).errors,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// A REGISTRATION CARRIES CODE, AND A SCOPED CALLER MAY NOT SHIP IT.
//
// The fence above is about NAMESPACES. These two are not namespace problems, and no prefix could
// have contained them:
//
//   `resolvers[].code` is directly-runnable ESM. `publishRegistrationImpl` calls `loadResolvers`
//   BEFORE anything persists, and `esm.ts` imports it from a `data:` URL with no sandbox — that
//   loader's own header states its premise, that only the OPERATOR's code ever loads here. A
//   scoped grantee shipping a resolver breaks the premise and holds the gateway process: its
//   filesystem, its network, the operator seed, the store file. And there is no taking it back —
//   the ESM registry retains a `data:` module for the life of the process, so striking the grant
//   unloads nothing.
//
//   `mutations` names GraphQL fields in a namespace shared with every other lens, unfenced by the
//   schema name. A template called `user` makes the operator's later `User` registration fail
//   `buildGqlSchema` outright — its QUERY field disappears with its mutation — and ordering is
//   first-come by timestamp, so an operator EVOLVING a lens moves behind an earlier squat.
//
// Both are DEFERRED, not forbidden forever. Each wants its own fence and its own rails, and
// resolvers additionally want the confinement `esm.ts` says was deliberately never built.
// An OPERATOR-token registration keeps both, exactly as before.
// ---------------------------------------------------------------------------------------------
describe("T174 — a scoped caller ships no code and claims no global field name", () => {
  const RESOLVER = (marker: string): Record<string, unknown> => ({
    color: {
      rung: "a",
      type: "string",
      // If this module is ever imported, the file appears. Its ABSENCE is the assertion.
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
    expect(errors).toContain("resolvers"); // the field is NAMED, so a caller can act on it
    expect(errors).not.toBe(REFUSAL); // shape, not authority: this caller HAS standing
    // The load happens before persistence, so "nothing persisted" is not the property. The
    // property is that the module was never imported at all.
    expect(existsSync(marker), "the resolver's ESM must never have been imported").toBe(false);
    // ...and no surface appeared either.
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
    // Two-sided, and this is the half that says why the refusal matters. `user` is the field a
    // lens named `User` answers at; a squat on it took the operator's QUERY field down too.
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
    // Ordering under the new tier. A stranger shipping a resolver must not learn that `resolvers`
    // is even a field — it draws the same byte-identical refusal it always has.
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
    // An effective admin signing itself `register` with prefix "User" would re-register the
    // operator's own constitutional schema — and `performRegistration` passes no context, so the
    // publish is signed with the OPERATOR'S seed. The operator's law would be superseded under
    // the operator's own key. Delegating a constitutional authority is a decision nobody made.
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
