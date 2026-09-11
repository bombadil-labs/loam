// T278 selection slice (working spec 63) — a bound connection asks which RECEIVED renderer would
// read the CURRENT law in its channel, and gets exact ids or a typed refusal.
//
// What these rails assert, at both levels. DELTA: the ids the answer names are the ids in the
// channel's attested received history, in full, and the answer writes nothing to any store — the
// root, the inbox pool, the channel pool and the peer are snapshotted around every call, answers
// and refusals alike, by the `select` helper itself. OBJECT:
// the law the answer names is the law the bound surface currently serves for that lens, compared
// by structural address, and every road that would let an older, malformed, write-capable,
// foreign, erased or superseded delta stand in for the current one refuses with the code the
// spec names.
//
// What they deliberately do not assert, and where it lives: that the selected bundle can be
// ADMITTED or RENDERED (the later activation slice, through T287's contexts); that a selection
// grants a reader anything (it grants nothing, and no door serves it yet).
//
// Fixtures that must be forged are forged by hand: a malformed renderer, a registration claiming
// another entity, an adoption record naming the wrong source. Each is a signed claim the store
// would never mint, so a production round-trip could not reach the branch under test.
//
// MEASURED. rails-red on origin/main: the suite does not load (the module is absent), an honest
// red and a weak one. Revert probes, one guard deleted at a time across these 24 cases: the inbox
// name, subtree reach, candidate survival, latest-candidate order, the write roles, the marker
// count, consumes distinctness, consumes coverage, law against the row,
// roots, the alias/target/author join, and in the classifier survival of the named binding, the
// entity ambiguity, the current-binding check, the author-scoped operand and the loader's id
// tie-break, and the unreceipted-strike hole — each 1 or 2 red, none 0. Six further guards that deleted to 0 red were redundant
// with a check one line later and are gone from the code.
//
// INHERITED AND CLOSED ON THIS SIDE ONLY: T288's projection skips an ERASED RECEIPT silently while
// the opening and other receipts survive (its own rail "erasing a received-strike event
// deliberately exposes earlier received source support" asserts this), so the received operand
// can lose a strike its pool still holds. This reader does not widen the operand; it refuses
// when the pool holds a same-author strike of a received id that no receipt names. T288's own
// reading is unchanged and its rail still holds.

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
import { containerClaims } from "../../src/gateway/container.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { CTX_RENDERER, rendererBindingClaims } from "../../src/gateway/renderers.js";
import { CTX_REGISTRATION, type LensName } from "../../src/gateway/registration.js";
import {
  classifyExactReceivedSchema,
  isWithheldResolver,
  readLawAdoptions,
} from "../../src/gateway/adopt-law.js";
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
      gw.nextTimestamp(),
    ),
    OP_SEED,
  );
  await gw.append([delta]);
  return delta;
}

/** Alice, a peer with Plant registered, one observation, and a read-only renderer at `hello`. */
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

/** The receiver: a bound connection at `owner:room` whose channel `alice` pulls from the peer. */
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
  // EVERY selection is the write-nothing instrument: each call runs twice between snapshots of
  // every store, and a refusal is held to the same rule as an answer.
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
    pool: ch.pool.gateway!,
    sync,
    received,
    select,
    refusal,
    stores,
  };
}

/** Run `act` and prove no store gained or lost a delta — the answer is a reading, not a record. */
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
/** The definition rows for `entity` among `received`, as the loaders see them. */
const definitionsOf = (received: readonly Delta[], entity: string): Delta[] =>
  received.filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.context === "definition" &&
        p.target.entity.id === entity,
    ),
  );

/** A renderer binding signed by `seed`, appended straight into `store` — no publish door. */
async function rawRenderer(
  store: Gateway,
  seed: string,
  core: { route: string; schemaName: LensName; consumes: string[]; bundle: string },
  edit: (claims: Claims) => Claims = (c) => c,
): Promise<Delta> {
  const delta = signClaims(
    edit(rendererBindingClaims(core, undefined, authorForSeed(seed), store.nextTimestamp())),
    seed,
  );
  await store.append([delta]);
  return delta;
}
const strike = (author: string, seed: string, target: string, ts: number): Delta =>
  signClaims(makeNegationClaims(author, ts, target), seed);
/** The peer evolves its Plant law: a new registration over a narrower reading. */
const evolve = (alice: Gateway, name = "Plant"): Promise<unknown> =>
  alice.publishRegistration(
    PLANT,
    { ...PLANT_POLICY, name, props: new Map([["height", PLANT_POLICY.default]]) },
    [FERN],
  );
/** The receiver takes the peer's CURRENT law under the channel's name, eyes open (§47). */
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
      d.claims.author === OP &&
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
/** An adoption record re-signed by the operator with one field changed, filed in `pool`. */
async function forge(pool: Gateway, from: Delta, edit: Record<string, string>): Promise<Delta> {
  const claims: Claims = {
    ...from.claims,
    timestamp: pool.nextTimestamp(),
    pointers: from.claims.pointers.map((p) =>
      p.role in edit && p.target.kind === "primitive"
        ? { ...p, target: { kind: "primitive", value: edit[p.role]! } }
        : p,
    ),
  };
  const d = signClaims(claims, OP_SEED);
  await pool.append([d]);
  return d;
}

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
    // The lineage is the binding plus the ONE definition row each loader reads: here each entity
    // has exactly one, so the set is fully determined by the received bytes.
    const hyperschema = definitionsOf(received, entityRef(registration!, "hyperschema"));
    const snapshot = definitionsOf(received, entityRef(registration!, "schemaVersion"));
    expect(hyperschema).toHaveLength(1);
    expect(snapshot).toHaveLength(1);
    expect(answer.sourceLineage).toEqual(
      [registration!.id, hyperschema[0]!.id, snapshot[0]!.id].sort(),
    );
    // Full ids, never a prefix or a second hash: every id in the answer is a delta the peer holds.
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
    // The publish door admits a bundle before it will sign one, so this shape can only be forged.
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
      // The parent's subtree reaches the channel's container, and the channel was still not opened
      // by the parent's binding: exact opener, not reach alone.
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
      // The right key naming another key's inbox in the same container.
      expect(w.refusal("hello", { binding: { container: LEAF, inbox: borrowed } }).code).toBe(
        "not_authorized",
      );
      expect(w.refusal("hello", { channel: "channel:owner:room:nobody" }).code).toBe(
        "not_authorized",
      );
    });
    // And the standing connection still selects: the refusals above are not a broken fixture.
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
    await w.gw.append([strike(OP, OP_SEED, rootDeclaration!.id, w.gw.nextTimestamp())]);
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
    // A standing record forged without the service's open event: T288 calls it legacy, and legacy
    // never attested what arrived, so there is no operand to select from.
    const status = w.gw.channelStatus(w.channel)[0]!;
    const ghost = { ...status, name: "channel:owner:room:ghost", prefix: "ghost" };
    await w.gw.append([signClaims(channelRecordClaims(ghost, OP, w.gw.nextTimestamp()), OP_SEED)]);
    expect(w.gw.channelStatus(ghost.name)).toHaveLength(1);
    expect(w.refusal("hello", { channel: ghost.name }).code).toBe("source_unavailable");
  });

  it("criterion 2: a channel record naming a container outside the binding's subtree is not_authorized, whatever its opener says", async () => {
    const w = await world();
    await declare(w.gw, "owner:other", RECEIVES, ROOT);
    const status = w.gw.channelStatus(w.channel)[0]!;
    // Opener and inbox are this connection's; the destination is a sibling it cannot reach. The
    // opener check alone admits this record; reach refuses it before its history is read.
    const stray = {
      ...status,
      name: "channel:owner:other:stray",
      prefix: "stray",
      into: "owner:other",
    };
    await w.gw.append([signClaims(channelRecordClaims(stray, OP, w.gw.nextTimestamp()), OP_SEED)]);
    const r = w.refusal("hello", { channel: stray.name });
    expect(r.code).toBe("not_authorized");
  });

  it("criterion 2: a renderer the receiver's own operator authored is eligible once RECEIVED; one pooled or root-seeded without a receipt is not", async () => {
    const w = await world();
    // Relayed by the peer: authored by this store's operator, but it arrived through the channel.
    const mine = signClaims(
      rendererBindingClaims({ ...HELLO, route: "mine" }, undefined, OP, w.alice.nextTimestamp()),
      OP_SEED,
    );
    await w.alice.federate([mine]);
    await w.sync();
    expect(w.select("mine").sourceDelta).toBe(mine.id);
    // Planted in the pool by hand, and root-published: present in the pool, absent from the receipts.
    const planted = signClaims(
      rendererBindingClaims(
        { ...HELLO, route: "planted" },
        undefined,
        MALLORY,
        w.pool.nextTimestamp(),
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
      // Each shape lands at its own route, and ALSO as the newest binding at `hello`, where a valid
      // older one stands: the newest must refuse rather than reveal the older.
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
      // The shape fault, never the absence: a candidate the filter stopped recognising would
      // refuse too, for the wrong reason.
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
    const s = strike(ALICE, ALICE_SEED, v2.id, w.alice.nextTimestamp());
    await w.alice.append([s]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v1.id);
    expect(w.pool.reactor.get(v2.id)).toBeDefined();
    const ss = strike(ALICE, ALICE_SEED, s.id, w.alice.nextTimestamp());
    await w.alice.append([ss]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v2.id);
    // Mallory's strikes, relayed through alice, retract nothing of alice's: not the renderer, not
    // the registration, and not a definition row — the loaders' own masking is author-blind, so
    // the last of these is the one an unscoped operand would lose.
    const [registration] = registrations(w.received());
    const definition = definitionsOf(w.received(), entityRef(registration!, "hyperschema"))[0]!;
    const foreign = [
      strike(MALLORY, MALLORY_SEED, v2.id, w.alice.nextTimestamp()),
      strike(MALLORY, MALLORY_SEED, registration!.id, w.alice.nextTimestamp()),
      strike(MALLORY, MALLORY_SEED, definition.id, w.alice.nextTimestamp()),
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
    const s = strike(ALICE, ALICE_SEED, v2.id, w.alice.nextTimestamp());
    await w.alice.append([s]);
    await w.sync();
    expect(w.select("hello").sourceDelta).toBe(v1.id);
    // The operator erases the receipt that attested the strike. T288 reads the earlier support as
    // standing again (its own rail says so); this reader sees the strike still in the pool with
    // no receipt naming it, and refuses rather than select the code its author took back.
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
    // A fresh world: the same strike planted straight into the pool, never offered.
    const w2 = await world();
    const target = rendererAt(w2.received(), "hello")[0]!;
    const planted = strike(ALICE, ALICE_SEED, target.id, w2.pool.nextTimestamp());
    await w2.pool.federate([planted]);
    expect(w2.received().some((d) => d.id === planted.id)).toBe(false);
    const hole = w2.refusal("hello");
    expect(hole.code).toBe("source_unavailable");
    expect(hole.message).toContain(planted.id);
    // CONTROL: a stranger's strike in the same position counts nowhere, so it is no hole either.
    const w3 = await world();
    const target3 = rendererAt(w3.received(), "hello")[0]!;
    await w3.pool.federate([strike(MALLORY, MALLORY_SEED, target3.id, w3.pool.nextTimestamp())]);
    expect(w3.select("hello").sourceDelta).toBe(target3.id);
  });

  it("criterion 3: a received delta carrying a `negates` role at an ENTITY is a note, not a strike, and breaks nothing", async () => {
    const w = await world();
    const before = w.select("hello");
    const note = signClaims(
      {
        timestamp: w.alice.nextTimestamp(),
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
    // The root erase acts on a root-held target; holding the exact received source invents no
    // custody, the receipt proved it. The sweep reaches the pool and the receipt names the id.
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
    expect(readLawAdoptions(w.pool.reactor, OP).length).toBeGreaterThan(0);
    await w.gw.curseChannelLaw(w.channel, "alice:Plant");
    expect(w.refusal("hello").code).toBe("law_unavailable");
    expect(readLawAdoptions(w.pool.reactor, OP).length).toBeGreaterThan(0);
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
    // Both readings share one hyperschema entity and one definition row; the lanes differ in
    // binding and snapshot only.
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
    // The adoption still names v1; v1 is no longer the current binding of schema:Plant.
    const stale = w.refusal("hello");
    expect(stale.code).toBe("law_unavailable");
    expect(stale.message).toContain(v2!.id);
    await supersede(w);
    const after = w.select("hello");
    expect(after.sourceRegistration).toBe(v2!.id);
    expect(after.destinationRegistration).not.toBe(before.destinationRegistration);
    expect(after.sourceDelta).toBe(before.sourceDelta);
    // A newer MALFORMED registration never supersedes a valid current one (criterion 12): the
    // valid-winner set excludes it, as the registration readers do.
    const malformed = signClaims(
      {
        ...v2!.claims,
        timestamp: w.alice.nextTimestamp(),
        pointers: v2!.claims.pointers.filter((p) => p.role !== "schemaVersion"),
      },
      ALICE_SEED,
    );
    await w.alice.append([malformed]);
    await w.sync();
    expect(w.received().some((d) => d.id === malformed.id)).toBe(true);
    expect(w.select("hello").sourceRegistration).toBe(v2!.id);
    // The peer withdraws v2 (and its malformed afterthought). Its living schema entity is still
    // ahead; the current survivor is v1, whose FROZEN snapshot must be what the lineage names —
    // and the destination, still on v2's content, does not match it until it is re-adopted.
    await w.alice.append([
      strike(ALICE, ALICE_SEED, malformed.id, w.alice.nextTimestamp()),
      strike(ALICE, ALICE_SEED, v2!.id, w.alice.nextTimestamp()),
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
    const law = classifyExactReceivedSchema(w.received(), "Plant", v1!.id);
    expect(new Set(law.schema.props.keys())).toEqual(new Set(PLANT_POLICY.props.keys()));
  });

  it("criterion 5: two hyperschema entities claiming one lens refuse rather than pick a winner", async () => {
    const w = await world();
    const [v1] = registrations(w.received());
    const rival = signClaims(
      {
        ...v1!.claims,
        timestamp: w.alice.nextTimestamp(),
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
    // The pool's own copy of the destination hyperschema, re-published by the operator with a
    // different gather body: the bound row keeps its id and its law moves under it.
    await w.pool.append([
      signClaims(
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
          OP,
          w.pool.nextTimestamp(),
        ),
        OP_SEED,
      ),
    ]);
    w.pool.replayRegistrations();
    w.gw.replayRegistrations();
    // The fold either re-trials the row over its new body or refuses the row whole; both leave
    // the served surface without the law the adoption named, and the selector refuses on that.
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
    await w.pool.append([strike(OP, OP_SEED, adoption.id, w.pool.nextTimestamp())]);
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
        // A stale law-address alone is not disqualifying — the CONTENT is compared — so this
        // shape, faithful in every field the join reads, passes; the others do not.
        expect(w.select("hello").sourceRegistration).toBe(good.sourceRegistration);
        await w.pool.append([strike(OP, OP_SEED, forged.id, w.pool.nextTimestamp())]);
      } else {
        expect(w.refusal("hello").code, JSON.stringify(edit)).toBe("law_unavailable");
      }
    }
    expect(w.refusal("hello").code).toBe("law_unavailable");
    // A perfect copy in another channel's pool is another channel's story.
    const other = await w.gw.openChannel({
      into: LEAF,
      prefix: "bob",
      from: "https://bob.example/default",
      source: { pull: () => Promise.resolve([]) },
      openedBy: LEAF,
      openedFrom: w.inbox,
    });
    await other.sync();
    await forge(other.pool.gateway!, adoption, {});
    expect(w.refusal("hello").code).toBe("law_unavailable");
    // And a faithful duplicate in THIS pool restores the join: same exact result, one answer.
    await forge(w.pool, adoption, {});
    expect(w.select("hello").sourceRegistration).toBe(good.sourceRegistration);
  });

  it("criteria 7 and 9: an adoption forged to name the CURRENT source registration still refuses when its law, or only its roots, differ from the served row", async () => {
    const w = await world();
    const { row, adoption } = currentAdoption(w);
    // The peer evolves its policy: v2 is current, the row still carries v1's content.
    await evolve(w.alice);
    await w.sync();
    const [, v2] = registrations(w.received()).sort(
      (a, b) => a.claims.timestamp - b.claims.timestamp,
    );
    await forge(w.pool, adoption, { "source-delta": v2!.id });
    expect(w.refusal("hello").code).toBe("law_unavailable");
    // The peer re-registers the SAME law over other roots: v3 is current, the law matches the row
    // and only the roots do not.
    await w.alice.publishRegistration(PLANT, PLANT_POLICY, ["plant:oak"]);
    await w.sync();
    const [v3] = registrations(w.received()).sort(
      (a, b) => b.claims.timestamp - a.claims.timestamp,
    );
    const law = classifyExactReceivedSchema(w.received(), "Plant", v3!.id);
    expect(law.roots).toEqual(["plant:oak"]);
    expect(row.roots).toEqual([FERN]);
    await forge(w.pool, adoption, { "source-delta": v3!.id });
    const r = w.refusal("hello");
    expect(r.code).toBe("law_unavailable");
    expect(r.message).toContain("does not describe the current source law");
  });

  it("criterion 7: a root-registered twin of the peer's law leaves the adoption naming the root's registration, and that is refused, not guessed", async () => {
    // A CONTROL for the join: identical law already served by the root makes the blessing name
    // the root's own binding as its source. No received registration is joined, so selection
    // refuses law_unavailable — the conservative answer, recorded here rather than widened.
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
    // Well-formed and newest, so it is the current binding of schema:Plant — and its frozen
    // snapshot entity has no definition row anywhere in the received history.
    const dangling = signClaims(
      {
        ...v1!.claims,
        timestamp: w.alice.nextTimestamp(),
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
    expect(() => classifyExactReceivedSchema(w.received(), "Plant", dangling.id)).toThrow(
      /no surviving schema definition for schema:Plant@never/,
    );
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
    const law = classifyExactReceivedSchema(w.received(), "Plant", v1!.id);
    // Two rows each, byte-identical in content, differing only in the id their timestamp mints —
    // so the loader's tie-break is the ONLY thing that picks, and the law does not move under
    // the destination.
    const at = w.alice.nextTimestamp() + 10;
    const twins = [at, at].map((ts, i) =>
      signClaims(
        {
          ...publishHyperSchemaClaims(law.hyperschema, entity, ALICE, ts),
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
          pointers: [
            ...publishSchemaClaims(law.schema, snapshotEntity, ALICE, ts).pointers,
            { role: "twin", target: { kind: "primitive", value: i } },
          ],
        },
        ALICE_SEED,
      ),
    );
    // A row a defines-role scan would take for a definition: right role, wrong context, latest.
    const decoy = signClaims(
      {
        ...twins[0]!.claims,
        timestamp: at + 1,
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
    const exact = classifyExactReceivedSchema(received, "Plant", v1!.id);
    expect(exact.lineage).toEqual([v1!.id, winner.id, snapshotWinner.id]);
    expect(exact.hyperschema).toEqual(law.hyperschema);
    expect(exact.schema).toEqual(law.schema);
    expect(exact.lineage).not.toContain(decoy.id);
    expect(w.select("hello").sourceLineage).toEqual([v1!.id, winner.id, snapshotWinner.id].sort());
    // A malformed row that WINS the bootstrap refuses; the older valid twin is not substituted.
    const broken = signClaims(
      {
        ...twins[0]!.claims,
        timestamp: at + 2,
        pointers: twins[0]!.claims.pointers.map((p) =>
          p.role.endsWith(".term") ? { ...p, target: { kind: "primitive", value: "not-hex" } } : p,
        ),
      },
      ALICE_SEED,
    );
    await w.alice.append([broken]);
    await w.sync();
    expect(() => classifyExactReceivedSchema(w.received(), "Plant", v1!.id)).toThrow();
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
