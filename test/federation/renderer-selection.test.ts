import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  publishHyperSchemaClaims,
  publishSchemaClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { CTX_RENDERER, rendererBindingClaims } from "../../src/gateway/renderers.js";
import { CTX_REGISTRATION, type LensName } from "../../src/gateway/registration.js";
import { classifyExactReceivedSchema, readLawAdoptions } from "../../src/gateway/adopt-law.js";
import { isWithheldResolver } from "../../src/gateway/adopt-vocab.js";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { localChannelEvidence } from "../../src/federation/local-channel-events.js";
import { channelRecordClaims } from "../../src/federation/channel.js";
import {
  RendererSelectionRefusal,
  selectRendererForActivation,
  type RendererSelectionCode,
} from "../../src/federation/renderer-selection.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { withStamp, type Stamp } from "../../src/gateway/stamp.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = "b4".repeat(32);
const KEY_SEED = "c5".repeat(32);
const KEY = authorForSeed(KEY_SEED);
const OTHER_KEY_SEED = "d6".repeat(32);
const OTHER_KEY = authorForSeed(OTHER_KEY_SEED);
const ALICE_SEED = "a1".repeat(32);
const ALICE = authorForSeed(ALICE_SEED);
const MALLORY_SEED = "e7".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);
const ROOT = "owner";
const LEAF = "owner:room";
const RECEIVES: Leeway = { ...SEALED_LEEWAY, receive: true };
const BUNDLE = 'export default (n) => "<p>" + n.view.height + "</p>";';
const HELLO = {
  route: "hello",
  schemaName: "Plant" as LensName,
  consumes: ["height"],
  bundle: BUNDLE,
};

const gateways: Gateway[] = [];
afterEach(async () => {
  while (gateways.length > 0) await gateways.pop()!.close();
});

async function declare(gw: Gateway, container: string, leeway?: Leeway, parent?: string) {
  const delta = signClaims(
    withStamp(gw.stamp(OP), (t) =>
      containerClaims(
        {
          container,
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { hasPointer: { context: { exact: "height" } } },
            in: "input",
          },
          ...(leeway === undefined ? {} : { leeway }),
          ...(parent === undefined ? {} : { parent }),
        },
        OP,
        t,
      ),
    ),
    OP_SEED,
  );
  await gw.append([delta]);
  return delta;
}

async function peer(): Promise<Gateway> {
  const alice = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: ALICE_SEED, registrations: [] }),
  );
  gateways.push(alice);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
  await alice.publishRenderer({
    route: "hello",
    schema: "Plant",
    consumes: ["height"],
    bundle: BUNDLE,
  });
  return alice;
}

interface World {
  readonly alice: Gateway;
  readonly gw: Gateway;
  readonly binding: ConnectionBinding;
  readonly inbox: string;
  readonly channel: string;
  readonly pool: Gateway;
  readonly sync: () => Promise<{ bound: string[]; witnessed: string[] }>;
  readonly received: () => readonly Delta[];
  readonly select: (
    route: string,
    over?: Partial<{ requester: string; binding: ConnectionBinding; channel: string }>,
  ) => ReturnType<typeof selectRendererForActivation>;
  readonly refusal: (
    route: string,
    over?: Partial<{ requester: string; binding: ConnectionBinding; channel: string }>,
  ) => { code: RendererSelectionCode; message: string };
  readonly stores: () => Gateway[];
}

const idsOf = (stores: Gateway[]): string[][] =>
  stores.map((s) => [...s.reactor.snapshot()].map((d) => d.id).sort());

async function world(alice?: Gateway, opts: { rootTwin?: boolean } = {}): Promise<World> {
  alice ??= await peer();
  const gw = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    channelBackend: () => new MemoryBackend(),
  });
  gateways.push(gw);
  if (opts.rootTwin === true) await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  await declare(gw, ROOT);
  await declare(gw, LEAF, RECEIVES, ROOT);
  const inbox = (
    await gw.bindConnection({ container: LEAF, connectionKey: KEY, ownerSeed: OWNER_SEED })
  ).entity!;
  const binding: ConnectionBinding = { container: LEAF, inbox };
  const ch = await gw.openChannel({
    into: LEAF,
    prefix: "alice",
    from: "https://alice.example/default",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    openedBy: LEAF,
    openedFrom: inbox,
  });
  const sync = async () => {
    const r = await ch.sync();
    return { bound: r.bound, witnessed: (r as { witnessed?: string[] }).witnessed ?? [] };
  };
  await sync();
  const received = () => {
    const ev = localChannelEvidence(gw, ch.name);
    if (ev.state !== "open") throw new Error(`fixture: evidence is ${ev.state}`);
    return ev.received;
  };
  const args = (
    over?: Partial<{ requester: string; binding: ConnectionBinding; channel: string }>,
  ) =>
    [
      { requester: over?.requester ?? KEY, binding: over?.binding ?? binding },
      over?.channel ?? ch.name,
    ] as const;
  const stores = () => [gw, ...gateways.filter((g) => g !== gw), ...gw.attachedContainers.values()];
  const select: World["select"] = (route, over) => {
    const [who, channel] = args(over);
    const before = idsOf(stores());
    const call = () => selectRendererForActivation(gw, who, { channel, route });
    let answer: ReturnType<typeof call> | undefined;
    let failure: unknown;
    for (let i = 0; i < 2; i += 1) {
      try {
        answer = call();
      } catch (err) {
        failure = err;
      }
    }
    expect(idsOf(stores())).toEqual(before);
    if (answer === undefined) throw failure;
    return answer;
  };
  const refusal: World["refusal"] = (route, over) => {
    try {
      select(route, over);
    } catch (err) {
      if (err instanceof RendererSelectionRefusal) return { code: err.code, message: err.message };
      throw err;
    }
    throw new Error(`expected a refusal selecting ${route}`);
  };
  return {
    alice,
    gw,
    binding,
    inbox,
    channel: ch.name,
    pool: gatewayOf(ch.pool),
    sync,
    received,
    select,
    refusal,
    stores,
  };
}

function writesNothing(w: World, act: () => unknown): void {
  const before = idsOf(w.stores());
  act();
  act();
  expect(idsOf(w.stores())).toEqual(before);
}

const hasContext = (d: Delta, context: string): boolean =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);
const rendererAt = (received: readonly Delta[], route: string): Delta[] =>
  received.filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.context === CTX_RENDERER &&
        p.target.entity.id === `renderer:${route}`,
    ),
  );
const registrations = (received: readonly Delta[]): Delta[] =>
  received.filter((d) => hasContext(d, CTX_REGISTRATION));
const entityRef = (d: Delta, role: string): string => {
  const p = d.claims.pointers.find((x) => x.role === role);
  if (p?.target.kind !== "entity") throw new Error(`no entity at ${role}`);
  return p.target.entity.id;
};
const definitionsOf = (received: readonly Delta[], entity: string): Delta[] =>
  received.filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.context === "definition" &&
        p.target.entity.id === entity,
    ),
  );

async function rawRenderer(
  store: Gateway,
  seed: string,
  core: { route: string; schemaName: LensName; consumes: string[]; bundle: string },
  edit: (claims: Claims) => Claims = (c) => c,
): Promise<Delta> {
  const delta = signClaims(
    edit(
      withStamp(store.stamp(authorForSeed(seed)), (t) =>
        rendererBindingClaims(core, undefined, authorForSeed(seed), t),
      ),
    ),
    seed,
  );
  await store.append([delta]);
  return delta;
}
const strike = (author: string, seed: string, target: string, at: Stamp): Delta =>
  signClaims(
    withStamp(at, (t) => makeNegationClaims(author, t, target)),
    seed,
  );
const evolve = (alice: Gateway, name = "Plant"): Promise<unknown> =>
  alice.publishRegistration(
    PLANT,
    { ...PLANT_POLICY, name, props: new Map([["height", PLANT_POLICY.default]]) },
    [FERN],
  );
async function supersede(w: World, alias = "Plant"): Promise<void> {
  await w.pool.adoptLaw(freezeMembers([...w.pool.reactor.snapshot()]), alias, {
    as: `alice:${alias}`,
    supersede: true,
    expect: "schema",
    manifest: "operator",
    resolvers: "withhold",
  });
  w.gw.replayRegistrations();
}
const currentAdoption = (w: World, lens = "alice:Plant") => {
  const row = w.gw.boundSurface(w.binding).registered.find((r) => String(r.lensName) === lens)!;
  const adoption = [...w.pool.reactor.snapshot()].find(
    (d) =>
      d.claims.author === w.pool.operatorAuthor &&
      d.claims.pointers.some(
        (p) =>
          p.role === "adopted" &&
          p.target.kind === "delta" &&
          p.target.deltaRef.delta === row.boundId,
      ),
  );
  if (adoption === undefined) throw new Error(`fixture: no adoption record for ${lens}`);
  return { row, adoption };
};
async function forge(pool: Gateway, from: Delta, edit: Record<string, string>): Promise<Delta> {
  const claims: Claims = {
    ...from.claims,
    ...pool.stamp(),
    author: pool.operatorAuthor!,
    pointers: from.claims.pointers.map((p) =>
      p.role in edit && p.target.kind === "primitive"
        ? { ...p, target: { kind: "primitive", value: edit[p.role]! } }
        : p,
    ),
  };
  const d = pool.signer!.sign(claims);
  await pool.append([d]);
  return d;
}
const poolStrike = (pool: Gateway, target: string): Delta =>
  pool.signer!.sign(
    withStamp(pool.stamp(), (t) => makeNegationClaims(pool.operatorAuthor!, t, target)),
  );

describe("T278 — exact received renderer selection", () => {
  it("criterion 1: names the renderer, the opening, both registrations and the whole lineage, in full, and writes nothing", async () => {
    const w = await world();
    const received = w.received();
    const [renderer] = rendererAt(received, "hello");
    const [registration] = registrations(received);
    const row = w.gw
      .boundSurface(w.binding)
      .registered.find((r) => String(r.lensName) === "alice:Plant")!;
    let answer!: ReturnType<typeof w.select>;
    writesNothing(w, () => {
      answer = w.select("hello");
    });
    expect(answer.destination).toBe(LEAF);
    expect(answer.channel).toBe(w.channel);
    expect(answer.opening).toBe(
      localChannelEvidence(w.gw, w.channel).state === "open"
        ? (localChannelEvidence(w.gw, w.channel) as { opening: { id: string } }).opening.id
        : "",
    );
    expect(answer.route).toBe("hello");
    expect(answer.sourceDelta).toBe(renderer!.id);
    expect(answer.sourceLens).toBe("Plant");
    expect(answer.destinationLens).toBe("alice:Plant");
    expect(answer.sourceRegistration).toBe(registration!.id);
    expect(answer.destinationRegistration).toBe(row.boundId);
    const hyperschema = definitionsOf(received, entityRef(registration!, "hyperschema"));
    const snapshot = definitionsOf(received, entityRef(registration!, "schemaVersion"));
    expect(hyperschema).toHaveLength(1);
    expect(snapshot).toHaveLength(1);
    expect(answer.sourceLineage).toEqual(
      [registration!.id, hyperschema[0]!.id, snapshot[0]!.id].sort(),
    );
    for (const id of [answer.sourceDelta, answer.sourceRegistration, ...answer.sourceLineage]) {
      expect(w.alice.reactor.get(id)?.id).toBe(id);
    }
    expect(w.pool.reactor.get(answer.destinationRegistration)?.id).toBe(
      answer.destinationRegistration,
    );
    expect(Object.isFrozen(answer)).toBe(true);
    expect(Object.isFrozen(answer.sourceLineage)).toBe(true);
  });

  it("criterion 1: a bundle that throws at initialisation still selects — admission is a later act", async () => {
    const w = await world();
    const boom = await rawRenderer(w.alice, ALICE_SEED, {
      ...HELLO,
      route: "boom",
      bundle: 'throw new Error("must not run at selection");',
    });
    await w.sync();
    expect(w.select("boom").sourceDelta).toBe(boom.id);
  });

  it("criterion 2: another key, a sibling, the parent, a lookalike, and a borrowed inbox are all not_authorized", async () => {
    const w = await world();
    const table = w.gw;
    await declare(table, "owner:other", RECEIVES, ROOT);
    await declare(table, "owner:roomx", RECEIVES, ROOT);
    const sibling = (
      await table.bindConnection({
        container: "owner:other",
        connectionKey: OTHER_KEY,
        ownerSeed: OWNER_SEED,
      })
    ).entity!;
    const parent = (
      await table.bindConnection({
        container: ROOT,
        connectionKey: OTHER_KEY,
        ownerSeed: OWNER_SEED,
      })
    ).entity!;
    const lookalike = (
      await table.bindConnection({
        container: "owner:roomx",
        connectionKey: OTHER_KEY,
        ownerSeed: OWNER_SEED,
      })
    ).entity!;
    const borrowed = (
      await table.bindConnection({
        container: LEAF,
        connectionKey: OTHER_KEY,
        ownerSeed: OWNER_SEED,
      })
    ).entity!;
    writesNothing(w, () => {
      expect(w.refusal("hello", { requester: OTHER_KEY }).code).toBe("not_authorized");
      expect(
        w.refusal("hello", {
          requester: OTHER_KEY,
          binding: { container: "owner:other", inbox: sibling },
        }).code,
      ).toBe("not_authorized");
      expect(
        w.refusal("hello", { requester: OTHER_KEY, binding: { container: ROOT, inbox: parent } })
          .code,
      ).toBe("not_authorized");
      expect(
        w.refusal("hello", {
          requester: OTHER_KEY,
          binding: { container: "owner:roomx", inbox: lookalike },
        }).code,
      ).toBe("not_authorized");
      expect(w.refusal("hello", { binding: { container: LEAF, inbox: borrowed } }).code).toBe(
        "not_authorized",
      );
      expect(w.refusal("hello", { channel: "channel:owner:room:nobody" }).code).toBe(
        "not_authorized",
      );
    });
    expect(w.select("hello").route).toBe("hello");
  });

  it("criterion 2: revoking the connection, or breaking its container's chain, ends selection", async () => {
    const w = await world();
    expect(w.select("hello").route).toBe("hello");
    const rootDeclaration =
      [...w.gw.reactor.snapshot()].find(
        (d) =>
          d.claims.author === OP &&
          d.claims.pointers.some(
            (p) =>
              p.role === "container" &&
              p.target.kind === "entity" &&
              p.target.entity.id === `container:${ROOT}`,
          ),
      ) ??
      [...w.gw.reactor.snapshot()].find(
        (d) =>
          hasContext(d, "loam.container") &&
          JSON.stringify(d.claims).includes(`"${ROOT}"`) &&
          !JSON.stringify(d.claims).includes(`"${LEAF}"`),
      );
    expect(rootDeclaration).toBeDefined();
    await w.gw.append([strike(OP, OP_SEED, rootDeclaration!.id, w.gw.stamp(OP))]);
    expect(w.refusal("hello").code).toBe("not_authorized");
  });

  it("criterion 2: a revoked connection is refused, and its bytes stay", async () => {
    const w = await world();
    const before = [...w.pool.reactor.snapshot()].length;
    await w.gw.revokeConnection({
      inbox: w.gw.connectionInboxes.get(w.inbox)!,
      connectionKey: KEY,
      ownerSeed: OWNER_SEED,
    });
    expect(w.refusal("hello").code).toBe("not_authorized");
    expect([...w.pool.reactor.snapshot()].length).toBe(before);
  });

  it("criterion 2: a channel record with no attested history is source_unavailable, not legacy-served", async () => {
    const w = await world();
    const status = w.gw.channelStatus(w.channel)[0]!;
    const ghost = { ...status, name: "channel:owner:room:ghost", prefix: "ghost" };
    await w.gw.append([
      signClaims(
        withStamp(w.gw.stamp(OP), (t) => channelRecordClaims(ghost, OP, t)),
        OP_SEED,
      ),
    ]);
    expect(w.gw.channelStatus(ghost.name)).toHaveLength(1);
    expect(w.refusal("hello", { channel: ghost.name }).code).toBe("source_unavailable");
  });

  it("criterion 2: a channel record naming a container outside the binding's subtree is not_authorized, whatever its opener says", async () => {
    const w = await world();
    await declare(w.gw, "owner:other", RECEIVES, ROOT);
    const status = w.gw.channelStatus(w.channel)[0]!;
    const stray = {
      ...status,
      name: "channel:owner:other:stray",
      prefix: "stray",
      into: "owner:other",
    };
    await w.gw.append([
      signClaims(
        withStamp(w.gw.stamp(OP), (t) => channelRecordClaims(stray, OP, t)),
        OP_SEED,
      ),
    ]);
    const r = w.refusal("hello", { channel: stray.name });
    expect(r.code).toBe("not_authorized");
  });

  it("criterion 2: a renderer the receiver's own operator authored is eligible once RECEIVED; one pooled or root-seeded without a receipt is not", async () => {
    const w = await world();
    const mine = signClaims(
      withStamp(w.alice.stamp(OP), (t) =>
        rendererBindingClaims({ ...HELLO, route: "mine" }, undefined, OP, t),
      ),
      OP_SEED,
    );
    await w.alice.federate([mine]);
    await w.sync();
    expect(w.select("mine").sourceDelta).toBe(mine.id);
    const planted = signClaims(
      withStamp(w.pool.stamp(MALLORY), (t) =>
        rendererBindingClaims({ ...HELLO, route: "planted" }, undefined, MALLORY, t),
      ),
      MALLORY_SEED,
    );
    await w.pool.federate([planted]);
    await w.gw
      .publishRenderer({ route: "rooted", schema: "Plant", consumes: ["height"], bundle: BUNDLE })
      .catch(() => undefined);
    expect(w.pool.reactor.get(planted.id)).toBeDefined();
    expect(w.refusal("planted").code).toBe("renderer_ineligible");
    expect(w.refusal("rooted").code).toBe("renderer_ineligible");
  });

  it("criterion 3: pen, writable, versionId, duplicate markers, a wrong role and bad consumes each refuse, and none reveals an older valid binding", async () => {
    const w = await world();
    const primitive = (role: string, value: string) => ({
      role,
      target: { kind: "primitive" as const, value },
    });
    const shapes: Record<string, (c: Claims) => Claims> = {
      "pen-only": (c) => ({ ...c, pointers: [...c.pointers, primitive("pen", "quill")] }),
      "writable-only": (c) => ({
        ...c,
        pointers: [...c.pointers, primitive("writable", JSON.stringify(["height"]))],
      }),
      versionId: (c) => ({
        ...c,
        pointers: [...c.pointers, primitive("versionId", "1e20" + "ab".repeat(32))],
      }),
      "duplicate markers": (c) => ({
        ...c,
        pointers: [...c.pointers, c.pointers.find((p) => p.role === "renders")!],
      }),
      "wrong role": (c) => ({
        ...c,
        pointers: c.pointers.map((p) => (p.role === "renders" ? { ...p, role: "shows" } : p)),
      }),
      "consumes not JSON": (c) => ({
        ...c,
        pointers: c.pointers.map((p) =>
          p.role === "consumes" ? primitive("consumes", "height") : p,
        ),
      }),
      "consumes repeated": (c) => ({
        ...c,
        pointers: c.pointers.map((p) =>
          p.role === "consumes" ? primitive("consumes", JSON.stringify(["height", "height"])) : p,
        ),
      }),
      "two routes": (c) => ({ ...c, pointers: [...c.pointers, primitive("route", "hello")] }),
      "consumes not a list": (c) => ({
        ...c,
        pointers: c.pointers.map((p) =>
          p.role === "consumes" ? primitive("consumes", JSON.stringify("height")) : p,
        ),
      }),
    };
    const forged: Record<string, Delta> = {};
    for (const [name, edit] of Object.entries(shapes)) {
      forged[name] = await rawRenderer(
        w.alice,
        ALICE_SEED,
        { ...HELLO, route: name.replace(/\W/g, "-") },
        edit,
      );
    }
    await w.sync();
    for (const [name, delta] of Object.entries(forged)) {
      expect(
        w.received().some((d) => d.id === delta.id),
        name,
      ).toBe(true);
      const r = w.refusal(name.replace(/\W/g, "-"));
      expect(r.code, name).toBe("renderer_ineligible");
      expect(r.message, name).toContain("the current renderer at");
    }
    const valid = w.select("hello");
    const newestAtHello = await rawRenderer(w.alice, ALICE_SEED, HELLO, shapes["pen-only"]);
    await w.sync();
    expect(w.received().some((d) => d.id === newestAtHello.id)).toBe(true);
    const r = w.refusal("hello");
    expect(r.code).toBe("renderer_ineligible");
    expect(r.message).not.toContain(valid.sourceDelta);
  });

  it("criterion 4: a strike, a strike of the strike, and a stranger's strike each resolve the renderer as its author's algebra says, bytes intact", async () => {
    const w = await world();
    const v1 = rendererAt(w.received(), "hello")[0]!;
    const v2 = await rawRenderer(w.alice, ALICE_SEED, { ...HELLO, bundle: BUNDLE + " // v2" });
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v2.id);
    const s = strike(ALICE, ALICE_SEED, v2.id, w.alice.stamp(ALICE));
    await w.alice.append([s]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v1.id);
    expect(w.pool.reactor.get(v2.id)).toBeDefined();
    const ss = strike(ALICE, ALICE_SEED, s.id, w.alice.stamp(ALICE));
    await w.alice.append([ss]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v2.id);
    const [registration] = registrations(w.received());
    const definition = definitionsOf(w.received(), entityRef(registration!, "hyperschema"))[0]!;
    const foreign = [
      strike(MALLORY, MALLORY_SEED, v2.id, w.alice.stamp(MALLORY)),
      strike(MALLORY, MALLORY_SEED, registration!.id, w.alice.stamp(MALLORY)),
      strike(MALLORY, MALLORY_SEED, definition.id, w.alice.stamp(MALLORY)),
    ];
    await w.alice.federate(foreign);
    await w.sync();
    for (const d of foreign) expect(w.received().some((r) => r.id === d.id)).toBe(true);
    const answer = w.select("hello");
    expect(answer.sourceDelta).toBe(v2.id);
    expect(answer.sourceRegistration).toBe(registration!.id);
    expect(answer.sourceLineage).toContain(definition.id);
  });

  it("criteria 4 and 8: a same-author strike the pool holds without a receipt is a hole, not a survivor — an erased receipt, a hand-planted strike, and a stranger's strike as the control", async () => {
    const w = await world();
    const v1 = rendererAt(w.received(), "hello")[0]!;
    const v2 = await rawRenderer(w.alice, ALICE_SEED, { ...HELLO, bundle: BUNDLE + " // v2" });
    await w.sync();
    const s = strike(ALICE, ALICE_SEED, v2.id, w.alice.stamp(ALICE));
    await w.alice.append([s]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v1.id);
    const receipt = [...w.gw.reactor.snapshot()].find(
      (d) =>
        hasContext(d, "loam.local.channel.event") &&
        d.claims.pointers.some(
          (p) =>
            p.role === "received" && p.target.kind === "delta" && p.target.deltaRef.delta === s.id,
        ),
    )!;
    await w.gw.erase(receipt.id, { reason: "rail" });
    expect(w.pool.reactor.get(s.id)).toBeDefined();
    expect(w.received().some((d) => d.id === s.id)).toBe(false);
    const erased = w.refusal("hello");
    expect(erased.code).toBe("source_unavailable");
    expect(erased.message).toContain(s.id);
    const w2 = await world();
    const target = rendererAt(w2.received(), "hello")[0]!;
    const planted = strike(ALICE, ALICE_SEED, target.id, w2.pool.stamp(ALICE));
    await w2.pool.federate([planted]);
    expect(w2.received().some((d) => d.id === planted.id)).toBe(false);
    const hole = w2.refusal("hello");
    expect(hole.code).toBe("source_unavailable");
    expect(hole.message).toContain(planted.id);
    const w3 = await world();
    const target3 = rendererAt(w3.received(), "hello")[0]!;
    await w3.pool.federate([strike(MALLORY, MALLORY_SEED, target3.id, w3.pool.stamp(MALLORY))]);
    expect(w3.select("hello").sourceDelta).toBe(target3.id);
  });

  it("criterion 3: a received delta carrying a `negates` role at an ENTITY is a note, not a strike, and breaks nothing", async () => {
    const w = await world();
    const before = w.select("hello");
    const note = signClaims(
      {
        ...w.alice.stamp(ALICE),
        author: ALICE,
        pointers: [
          { role: "negates", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
          {
            role: "why",
            target: { kind: "primitive", value: "a provenance note, not a negation" },
          },
        ],
      },
      ALICE_SEED,
    );
    await w.alice.append([note]);
    await w.sync();
    expect(w.received().some((d) => d.id === note.id)).toBe(true);
    expect(w.select("hello")).toEqual(before);
  });

  it("criterion 8: erasing ANY received member — here one unrelated to the renderer — makes the source unavailable", async () => {
    const w = await world();
    const observation = w.received().find((d) => hasContext(d, "height"))!;
    expect(w.select("hello").route).toBe("hello");
    await w.gw.federate([observation]);
    await w.gw.erase(observation.id, { reason: "rail" });
    expect(w.pool.reactor.get(observation.id)).toBeUndefined();
    const r = w.refusal("hello");
    expect(r.code).toBe("source_unavailable");
    expect(r.message).toContain(observation.id);
  });

  it("criterion 9: a curse on the derived name refuses whatever the adoption records say; consumes outside the served schema refuses", async () => {
    const w = await world();
    const narrow = await rawRenderer(w.alice, ALICE_SEED, {
      ...HELLO,
      route: "narrow",
      consumes: ["height", "nonesuch"],
    });
    await w.sync();
    expect(w.received().some((d) => d.id === narrow.id)).toBe(true);
    expect(w.refusal("narrow").code).toBe("law_unavailable");
    expect(
      readLawAdoptions(w.pool.reactor, w.pool.validityNow(), w.pool.operatorAuthor!).length,
    ).toBeGreaterThan(0);
    await w.gw.curseChannelLaw(w.channel, "alice:Plant");
    expect(w.refusal("hello").code).toBe("law_unavailable");
    expect(
      readLawAdoptions(w.pool.reactor, w.pool.validityNow(), w.pool.operatorAuthor!).length,
    ).toBeGreaterThan(0);
  });

  it("criterion 12: an absent route in complete evidence is renderer_ineligible, not source_unavailable", async () => {
    const w = await world();
    expect(w.refusal("nonesuch").code).toBe("renderer_ineligible");
  });

  it("criterion 5: two coexisting source lenses select only their own lane", async () => {
    const w = await world();
    await evolve(w.alice, "Plant2");
    await w.alice.publishRenderer({
      route: "hello2",
      schema: "Plant2",
      consumes: ["height"],
      bundle: BUNDLE,
    });
    await w.sync();
    const one = w.select("hello");
    const two = w.select("hello2");
    expect(one.destinationLens).toBe("alice:Plant");
    expect(two.destinationLens).toBe("alice:Plant2");
    expect(two.sourceLens).toBe("Plant2");
    expect(one.sourceRegistration).not.toBe(two.sourceRegistration);
    expect(one.destinationRegistration).not.toBe(two.destinationRegistration);
    const shared = one.sourceLineage.filter((id) => two.sourceLineage.includes(id));
    expect(shared).toHaveLength(1);
  });

  it("criteria 5, 6, 12: a superseded source registration refuses; adopting the latest succeeds with the same renderer; a withdrawal leaves the frozen predecessor", async () => {
    const w = await world();
    const before = w.select("hello");
    await evolve(w.alice);
    await w.sync();
    const [v1, v2] = registrations(w.received()).sort(
      (a, b) => a.claims.timestamp - b.claims.timestamp,
    );
    expect(v1!.id).toBe(before.sourceRegistration);
    const stale = w.refusal("hello");
    expect(stale.code).toBe("law_unavailable");
    expect(stale.message).toContain(v2!.id);
    await supersede(w);
    const after = w.select("hello");
    expect(after.sourceRegistration).toBe(v2!.id);
    expect(after.destinationRegistration).not.toBe(before.destinationRegistration);
    expect(after.sourceDelta).toBe(before.sourceDelta);
    const malformed = signClaims(
      {
        ...v2!.claims,
        ...w.alice.stamp(ALICE),
        pointers: v2!.claims.pointers.filter((p) => p.role !== "schemaVersion"),
      },
      ALICE_SEED,
    );
    await w.alice.append([malformed]);
    await w.sync();
    expect(w.received().some((d) => d.id === malformed.id)).toBe(true);
    expect(w.select("hello").sourceRegistration).toBe(v2!.id);
    await w.alice.append([
      strike(ALICE, ALICE_SEED, malformed.id, w.alice.stamp(ALICE)),
      strike(ALICE, ALICE_SEED, v2!.id, w.alice.stamp(ALICE)),
    ]);
    await w.sync();
    const withdrawn = w.refusal("hello");
    expect(withdrawn.code).toBe("law_unavailable");
    expect(withdrawn.message).toContain("retracted");
    await supersede(w);
    const reverted = w.select("hello");
    expect(reverted.sourceRegistration).toBe(v1!.id);
    expect(reverted.sourceDelta).toBe(before.sourceDelta);
    const snapshotOf = (r: Delta) =>
      definitionsOf(w.received(), entityRef(r, "schemaVersion"))[0]!.id;
    expect(reverted.sourceLineage).toContain(snapshotOf(v1!));
    expect(reverted.sourceLineage).not.toContain(snapshotOf(v2!));
    const law = classifyExactReceivedSchema(w.received(), "Plant", v1!.id, Date.now());
    expect(new Set(law.schema.props.keys())).toEqual(new Set(PLANT_POLICY.props.keys()));
  });

  it("criterion 5: two hyperschema entities claiming one lens refuse rather than pick a winner", async () => {
    const w = await world();
    const [v1] = registrations(w.received());
    const rival = signClaims(
      {
        ...v1!.claims,
        ...w.alice.stamp(ALICE),
        pointers: v1!.claims.pointers.map((p) =>
          p.role === "hyperschema" && p.target.kind === "entity"
            ? {
                ...p,
                target: { ...p.target, entity: { ...p.target.entity, id: "hyperschema:Other" } },
              }
            : p,
        ),
      },
      ALICE_SEED,
    );
    await w.alice.append([rival]);
    await w.sync();
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).toContain("2 hyperschema entities");
  });

  it("criterion 6: a destination definition rewritten under an unchanged bound id no longer matches the adoption's law", async () => {
    const w = await world();
    const { row } = currentAdoption(w);
    await w.pool.append([
      w.pool.signer!.sign(
        withStamp(w.pool.stamp(), (t) =>
          publishHyperSchemaClaims(
            {
              ...PLANT,
              body: parseTerm({
                op: "select",
                pred: { hasPointer: { context: { exact: "tag" } } },
                in: "input",
              }),
            },
            row.entity!,
            w.pool.operatorAuthor!,
            t,
          ),
        ),
      ),
    ]);
    w.pool.replayRegistrations();
    w.gw.replayRegistrations();
    const surface = w.gw.boundSurface(w.binding);
    const moved = surface.registered.find((r) => String(r.lensName) === "alice:Plant");
    expect(moved === undefined || moved.boundId === row.boundId).toBe(true);
    expect(moved?.hyperschema.body).not.toEqual(row.hyperschema.body);
    expect(w.refusal("hello").code).toBe("law_unavailable");
  });

  it("criterion 7: the adoption narrative corroborates; forged rows in the same key cannot manufacture the join, and a faithful duplicate is harmless", async () => {
    const w = await world();
    const { adoption } = currentAdoption(w);
    const good = w.select("hello");
    await w.pool.append([poolStrike(w.pool, adoption.id)]);
    expect(w.refusal("hello").code).toBe("law_unavailable");
    const [v1] = registrations(w.received());
    const [renderer] = rendererAt(w.received(), "hello");
    for (const edit of [
      { "source-delta": renderer!.id },
      { alias: "Plant2" },
      { "produced-by": MALLORY },
      { "export-target": "hyperschema:Other" },
      {
        "source-delta": v1!.id,
        alias: "Plant",
        "produced-by": ALICE,
        "law-address": "0".repeat(68),
      },
    ]) {
      const forged = await forge(w.pool, adoption, edit);
      if ("law-address" in edit) {
        expect(w.select("hello").sourceRegistration).toBe(good.sourceRegistration);
        await w.pool.append([poolStrike(w.pool, forged.id)]);
      } else {
        expect(w.refusal("hello").code, JSON.stringify(edit)).toBe("law_unavailable");
      }
    }
    expect(w.refusal("hello").code).toBe("law_unavailable");
    const other = await w.gw.openChannel({
      into: LEAF,
      prefix: "bob",
      from: "https://bob.example/default",
      source: { pull: () => Promise.resolve([]) },
      openedBy: LEAF,
      openedFrom: w.inbox,
    });
    await other.sync();
    await forge(gatewayOf(other.pool), adoption, {});
    expect(w.refusal("hello").code).toBe("law_unavailable");
    await forge(w.pool, adoption, {});
    expect(w.select("hello").sourceRegistration).toBe(good.sourceRegistration);
  });

  it("criteria 7 and 9: an adoption forged to name the CURRENT source registration still refuses when its law, or only its roots, differ from the served row", async () => {
    const w = await world();
    const { row, adoption } = currentAdoption(w);
    await evolve(w.alice);
    await w.sync();
    const [, v2] = registrations(w.received()).sort(
      (a, b) => a.claims.timestamp - b.claims.timestamp,
    );
    await forge(w.pool, adoption, { "source-delta": v2!.id });
    expect(w.refusal("hello").code).toBe("law_unavailable");
    await w.alice.publishRegistration(PLANT, PLANT_POLICY, ["plant:oak"]);
    await w.sync();
    const [v3] = registrations(w.received()).sort(
      (a, b) => b.claims.timestamp - a.claims.timestamp,
    );
    const law = classifyExactReceivedSchema(w.received(), "Plant", v3!.id, Date.now());
    expect(law.roots).toEqual(["plant:oak"]);
    expect(row.roots).toEqual([FERN]);
    await forge(w.pool, adoption, { "source-delta": v3!.id });
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).toContain("does not describe the current source law");
  });

  it("criterion 7: a root-registered twin of the peer's law leaves the adoption naming the root's registration, and that is refused, not guessed", async () => {
    const w = await world(undefined, { rootTwin: true });
    expect(
      w.gw
        .boundSurface(w.binding)
        .registered.map((r) => String(r.lensName))
        .sort(),
    ).toEqual(["Plant", "alice:Plant"]);
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).toContain("not among the received");
  });

  it("criterion 7: withheld resolver stubs are untouched by selection and nothing of theirs runs", async () => {
    const alice = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: ALICE_SEED, registrations: [] }),
    );
    gateways.push(alice);
    await alice.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        height: { rung: "a", type: "bytes", code: "export default () => undefined;" },
      },
    );
    await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
    await alice.publishRenderer({
      route: "hello",
      schema: "Plant",
      consumes: ["height"],
      bundle: BUNDLE,
    });
    const w = await world(alice);
    const row = () =>
      w.gw.boundSurface(w.binding).registered.find((r) => String(r.lensName) === "alice:Plant")!;
    const before = JSON.stringify(row().resolvers);
    expect(isWithheldResolver(row().resolvers!.height!.code, "alice:Plant", "height")).toBe(true);
    const answer = w.select("hello");
    expect(answer.sourceRegistration).toBe(registrations(w.received())[0]!.id);
    expect(JSON.stringify(row().resolvers)).toBe(before);
  });

  it("criterion 8: a current registration whose referenced snapshot never arrived refuses, naming the missing definition", async () => {
    const w = await world();
    const [v1] = registrations(w.received());
    const dangling = signClaims(
      {
        ...v1!.claims,
        ...w.alice.stamp(ALICE),
        pointers: v1!.claims.pointers.map((p) =>
          p.role === "schemaVersion" && p.target.kind === "entity"
            ? {
                ...p,
                target: { ...p.target, entity: { ...p.target.entity, id: "schema:Plant@never" } },
              }
            : p,
        ),
      },
      ALICE_SEED,
    );
    await w.alice.append([dangling]);
    await w.sync();
    expect(w.received().some((d) => d.id === dangling.id)).toBe(true);
    expect(() =>
      classifyExactReceivedSchema(w.received(), "Plant", dangling.id, Date.now()),
    ).toThrow(/no surviving schema definition for schema:Plant@never/);
    await forge(w.pool, currentAdoption(w).adoption, { "source-delta": dangling.id });
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).toContain("schema:Plant@never");
  });

  it("criterion 8: erasing an OLD destination-only adoption record does not turn the answer historical", async () => {
    const w = await world();
    const { adoption: old } = currentAdoption(w);
    await evolve(w.alice);
    await w.sync();
    await supersede(w);
    const current = w.select("hello");
    await w.gw.federate([old]);
    await w.gw.erase(old.id, { reason: "rail" });
    expect(w.pool.reactor.get(old.id)).toBeUndefined();
    expect(w.select("hello")).toEqual(current);
  });

  it("criterion 11: equal-timestamp definition rows resolve by ascending id, a malformed winner refuses without fallback, and a defines-role row outside the definition context is not lineage", async () => {
    const w = await world();
    const [v1] = registrations(w.received());
    const entity = entityRef(v1!, "hyperschema");
    const snapshotEntity = entityRef(v1!, "schemaVersion");
    const law = classifyExactReceivedSchema(w.received(), "Plant", v1!.id, Date.now());
    const stamp = w.alice.stamp(ALICE);
    const at = stamp.timestamp + 10;
    const twins = [at, at].map((ts, i) =>
      signClaims(
        {
          ...publishHyperSchemaClaims(law.hyperschema, entity, ALICE, ts),
          validFrom: stamp.validFrom,
          pointers: [
            ...publishHyperSchemaClaims(law.hyperschema, entity, ALICE, ts).pointers,
            { role: "twin", target: { kind: "primitive", value: i } },
          ],
        },
        ALICE_SEED,
      ),
    );
    const snapshotTwins = [at, at].map((ts, i) =>
      signClaims(
        {
          ...publishSchemaClaims(law.schema, snapshotEntity, ALICE, ts),
          validFrom: stamp.validFrom,
          pointers: [
            ...publishSchemaClaims(law.schema, snapshotEntity, ALICE, ts).pointers,
            { role: "twin", target: { kind: "primitive", value: i } },
          ],
        },
        ALICE_SEED,
      ),
    );
    const decoy = signClaims(
      {
        ...twins[0]!.claims,
        timestamp: at + 1,
        validFrom: at + 1,
        pointers: twins[0]!.claims.pointers.map((p) =>
          p.target.kind === "entity"
            ? {
                ...p,
                target: {
                  ...p.target,
                  entity: { ...p.target.entity, context: "not-a-definition" },
                },
              }
            : p,
        ),
      },
      ALICE_SEED,
    );
    await w.alice.append([...twins, ...snapshotTwins, decoy]);
    await w.sync();
    const received = w.received();
    for (const d of [...twins, ...snapshotTwins, decoy])
      expect(received.some((r) => r.id === d.id)).toBe(true);
    const byId = (a: Delta, b: Delta) => (a.id < b.id ? -1 : 1);
    const winner = [...twins].sort(byId)[0]!;
    const snapshotWinner = [...snapshotTwins].sort(byId)[0]!;
    const exact = classifyExactReceivedSchema(received, "Plant", v1!.id, Date.now());
    expect(exact.lineage).toEqual([v1!.id, winner.id, snapshotWinner.id]);
    expect(exact.hyperschema).toEqual(law.hyperschema);
    expect(exact.schema).toEqual(law.schema);
    expect(exact.lineage).not.toContain(decoy.id);
    expect(w.select("hello").sourceLineage).toEqual([v1!.id, winner.id, snapshotWinner.id].sort());
    const broken = signClaims(
      {
        ...twins[0]!.claims,
        timestamp: at + 2,
        validFrom: at + 2,
        pointers: twins[0]!.claims.pointers.map((p) =>
          p.role.endsWith(".term") ? { ...p, target: { kind: "primitive", value: "not-hex" } } : p,
        ),
      },
      ALICE_SEED,
    );
    await w.alice.append([broken]);
    await w.sync();
    expect(() => classifyExactReceivedSchema(w.received(), "Plant", v1!.id, Date.now())).toThrow();
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).not.toContain(winner.id);
  });

  it("invalid_request: malformed arguments refuse before any authority is consulted", async () => {
    const w = await world();
    writesNothing(w, () => {
      expect(w.refusal("hello", { requester: "not a key" }).code).toBe("invalid_request");
      expect(w.refusal("hello", { requester: KEY_SEED }).code).toBe("invalid_request");
      expect(w.refusal("", {}).code).toBe("invalid_request");
      expect(w.refusal("a/b", {}).code).toBe("invalid_request");
      expect(w.refusal("hello", { channel: "" }).code).toBe("invalid_request");
      expect(w.refusal("hello", { binding: { container: "", inbox: w.inbox } }).code).toBe(
        "invalid_request",
      );
      expect(w.refusal("hel\0lo", {}).code).toBe("invalid_request");
    });
  });
});
