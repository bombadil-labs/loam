// T289 (spec 64): every protected lifecycle event names its parent container at a pinned position,
// in the event vocabulary. The pointer scopes reads: a bound connection's lineage read and the
// operator's read by container. It is never container law, never slated, and the doors still
// refuse the event.
//
// RAILS-RED on the T288 tip (4e3b8b52), this file copied in: 4 red, 0 green. REVERT PROBES on this
// tree, one guard deleted per probe: a slate may condemn a lifecycle record → 1 red; an open's
// `into` need not match its parent pointer → 1 red; the marker reads the first event-context
// pointer instead of the `event` role → 0 red, EQUIVALENT today (the parser pins `event` first), kept
// as a role read on purpose. The cascade probe in local-channel-live-opening.test.ts also reds the
// first case here. Measured again after review round 1: a closed incarnation is still listed →
// 1 red. After review round 2: standing ignores the pool declaration → 2 red.
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  containerClaims,
  readContainerTable,
  survivingDeclarationIds,
  termClaims,
} from "../../src/gateway/container.js";
import { SEALED_LEEWAY } from "../../src/gateway/leeway.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import {
  inLocalContext,
  LOCAL_CONTROL,
  LOCAL_EVENT,
  localChannelEvidence,
  localChannelsInContainer,
  localControlChannel,
  PARENT_CONTAINER,
  parseLocalEvent,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const PEER_SEED = "a1".repeat(32);
const homes: Gateway[] = [];
afterEach(async () => {
  for (const gw of homes.splice(0)) await gw.close();
});
async function home() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}
const fact = (n = 1) => observed(FERN, "height", n, 1000 + n, PEER_SEED);
async function open(
  gw: Gateway,
  into: string,
  prefix: string,
  bound?: { by: string; from: string },
) {
  const offering: Delta[] = [];
  const ch = await gw.openChannel({
    into,
    prefix,
    from: `https://peer.example/${prefix}`,
    ...(bound === undefined ? {} : { openedBy: bound.by, openedFrom: bound.from }),
    source: { pull: () => Promise.resolve([...offering]) },
  });
  return { ch, offering };
}
function opened(gw: Gateway, name: string) {
  const evidence = localChannelEvidence(gw, name);
  if (evidence.state !== "open") throw new Error(`expected open: ${JSON.stringify(evidence)}`);
  return evidence;
}
const eventsOf = (gw: Gateway, name: string) =>
  [...gw.reactor.snapshot()].filter(
    (d) =>
      inLocalContext(d, LOCAL_EVENT) &&
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.id === `channel:${name}`,
      ),
  );

describe("spec 64: lifecycle events name their parent container", () => {
  it("every open, receipt and close carries the pointer at position 3, and it is not container law", async () => {
    const gw = await home();
    const { ch, offering } = await open(gw, "friends", "friends:peer");
    offering.push(fact(1));
    await ch.sync();
    await gw.dropChannel(ch.name);
    const seen = eventsOf(gw, ch.name);
    expect(seen.map((d) => d.claims.pointers[2]?.target)).toEqual(
      expect.arrayContaining([
        { kind: "primitive", value: "open" },
        { kind: "primitive", value: "received" },
        { kind: "primitive", value: "close" },
      ]),
    );
    for (const d of seen) {
      expect(d.claims.pointers[3]).toEqual({
        role: PARENT_CONTAINER,
        target: { kind: "entity", entity: { id: "friends", context: LOCAL_EVENT } },
      });
      // The container table never reads an event as a declaration of "friends".
      expect(survivingDeclarationIds(gw.reactor, OP, "friends")).not.toContain(d.id);
    }
    // The erasure marker names the channel from the event pointer, not from the parent pointer.
    const opening = seen.find(
      (d) =>
        d.claims.pointers[2]?.target.kind === "primitive" &&
        d.claims.pointers[2].target.value === "open",
    )!;
    await gw.erase(opening.id);
    const marks = [...gw.reactor.snapshot()].filter((d) => inLocalContext(d, LOCAL_CONTROL));
    expect(marks.length).toBeGreaterThanOrEqual(3);
    for (const m of marks) expect(localControlChannel(m)).toBe(`channel:${ch.name}`);
  });
  it("an open whose parent pointer disagrees with its into does not parse; the marker names the channel from the event pointer", async () => {
    const gw = await home();
    const { ch, offering } = await open(gw, "friends", "friends:peer");
    offering.push(fact(1));
    await ch.sync();
    const opening = gw.reactor.get(opened(gw, ch.name).opening.id)!;
    expect(parseLocalEvent(opening, OP)?.action).toBe("open");
    const swapped = signClaims(
      {
        ...opening.claims,
        pointers: opening.claims.pointers.map((p) =>
          p.role === PARENT_CONTAINER
            ? {
                ...p,
                target: { kind: "entity", entity: { id: "elsewhere", context: LOCAL_EVENT } },
              }
            : p,
        ),
      },
      SEED,
    );
    expect(parseLocalEvent(swapped, OP)).toBeUndefined();
    // The marker's channel comes from the `event` pointer by role. The parser pins that pointer
    // first, so a first-match read is equivalent today; the role read stays so a later position
    // change cannot silently name the container as the channel.
    await gw.dropChannel(ch.name);
    await gw.erase(opening.id);
    const marks = [...gw.reactor.snapshot()].filter((d) => inLocalContext(d, LOCAL_CONTROL));
    for (const m of marks) expect(localControlChannel(m)).toBe(`channel:${ch.name}`);
  });
  it("the generic doors still refuse a pointered event, and a slate that condemns one is refused", async () => {
    const gw = await home();
    const { ch, offering } = await open(gw, "friends", "friends:peer");
    offering.push(fact(1));
    await ch.sync();
    const opening = gw.reactor.get(opened(gw, ch.name).opening.id)!;
    const copy = signClaims({ ...opening.claims, timestamp: gw.nextTimestamp() }, SEED);
    await expect(gw.append([copy])).rejects.toThrow(/protected local channel event/);
    const report = await gw.federate([copy], { admit: () => true });
    expect(report.accepted).toBe(0);
    // A slate over the opening: the pinned term is published, then the record is appended.
    const term = frozenMembershipTerm([opening.id]);
    const published = signClaims(termClaims(term, OP, gw.nextTimestamp()), SEED);
    await gw.append([published]);
    const version = gw.freeze(term).id;
    const container = "container:slate:channel";
    await gw.append([
      signClaims(
        containerClaims(
          {
            container,
            trust: "curated",
            posture: "shared",
            membershipAt: published.id,
            version,
          },
          OP,
          gw.nextTimestamp(),
        ),
        SEED,
      ),
    ]);
    const record = signClaims(
      slateClaims(
        {
          container,
          membershipAt: published.id,
          version,
          requestedBy: "operator",
          requestedByForm: "plain",
          requestedAt: 1_000,
          deadline: 4_070_908_800_000,
          closes: ["egress", "cite"],
        },
        OP,
        gw.nextTimestamp(),
      ),
      SEED,
    );
    await expect(gw.append([record])).rejects.toThrow(/never slated/);
    expect(localChannelEvidence(gw, ch.name).state).toBe("open");
  });
  it("a refused drop leaves a close beside a standing pool and the channel stays listed; a close erased before its opening leaves the dropped channel unlisted", async () => {
    const gw = await home();
    const { ch, offering } = await open(gw, "friends", "friends:peer");
    offering.push(fact(1));
    await ch.sync();
    // Refused drop: the close lands first, the purge refuses, the declaration and the pool stand.
    const pool = ch.pool.gateway!.backend as MemoryBackend & { failPurge?: boolean };
    const purge = pool.purge.bind(pool);
    pool.purge = () => Promise.reject(new Error("fixture purge failure"));
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/could not be proven clean/);
    expect(localChannelsInContainer(gw, "friends")).toEqual([ch.name]);
    expect(localChannelEvidence(gw, ch.name).state).not.toBe("open");
    pool.purge = purge;
    await gw.dropChannel(ch.name);
    expect(localChannelsInContainer(gw, "friends")).toEqual([]);
    // Now erase the dropped opening with the close's purge faulting: the close is tombstoned and
    // gone from the reactor, the opening stays; the channel must still read as dropped.
    const opening = eventsOf(gw, ch.name).find(
      (d) =>
        d.claims.pointers[2]?.target.kind === "primitive" &&
        d.claims.pointers[2].target.value === "open",
    )!;
    const primary = gw.backend as MemoryBackend;
    const primaryPurge = primary.purge.bind(primary);
    let purges = 0;
    primary.purge = (ids) => {
      purges += 1;
      return purges === 1 ? Promise.reject(new Error("fixture purge failure")) : primaryPurge(ids);
    };
    await expect(gw.erase(opening.id)).rejects.toThrow();
    expect(gw.reactor.get(opening.id)).toBeDefined();
    expect(localChannelsInContainer(gw, "friends")).toEqual([]);
    primary.purge = primaryPurge;
    await gw.erase(opening.id);
    expect(localChannelsInContainer(gw, "friends")).toEqual([]);
  });
  it("an opening whose declaration is absent from the reactor is not standing", async () => {
    const gw = await home();
    const { ch, offering } = await open(gw, "friends", "friends:peer");
    offering.push(fact(1));
    await ch.sync();
    const declaration = opened(gw, ch.name).opening.poolDeclaration;
    const erased = await gw.erase(declaration).catch((e: Error) => e.message);
    if (typeof erased === "string") {
      // The declaration of an attached pool cannot be erased; the door refuses. Then the presence
      // clause is unreachable by any road, and this case records that rather than a wish.
      expect(erased).toMatch(/refused|cannot|not/);
      expect(localChannelsInContainer(gw, "friends")).toEqual([ch.name]);
    } else {
      expect(gw.reactor.get(declaration)).toBeUndefined();
      expect(localChannelsInContainer(gw, "friends")).toEqual([]);
    }
  });
  it("a bound connection's lineage read lists the channels opened into its container and no others; the operator's read filters by container", async () => {
    const gw = await home();
    for (const container of ["ada:journal", "bea:notes"])
      await gw.append([
        signClaims(
          containerClaims(
            {
              container,
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { match: { field: "author", cmp: "eq", const: "none" } },
                in: "input",
              },
              leeway: { ...SEALED_LEEWAY, receive: true },
            },
            OP,
            gw.nextTimestamp(),
          ),
          SEED,
        ),
      ]);
    const ada = await gw.bindConnection({
      container: "ada:journal",
      connectionKey: authorForSeed("b2".repeat(32)),
      ownerSeed: "d4".repeat(32),
    });
    const bea = await gw.bindConnection({
      container: "bea:notes",
      connectionKey: authorForSeed("b3".repeat(32)),
      ownerSeed: "d5".repeat(32),
    });
    const a = await open(gw, "ada:journal", "ada:journal:peer", {
      by: "ada:journal",
      from: ada.entity!,
    });
    const b = await open(gw, "bea:notes", "bea:notes:peer", { by: "bea:notes", from: bea.entity! });
    const root = await open(gw, "friends", "friends:peer");
    expect(localChannelsInContainer(gw, "ada:journal")).toEqual([a.ch.name]);
    expect(localChannelsInContainer(gw, "bea:notes")).toEqual([b.ch.name]);
    expect(localChannelsInContainer(gw, "friends")).toEqual([root.ch.name]);
    expect(localChannelsInContainer(gw, "nobody")).toEqual([]);
    // A dropped incarnation is no longer listed, erased or not; its sibling still is. Standing is
    // the surviving pool declaration, the erase door's own liveness test, never a close event.
    const aOpening = opened(gw, a.ch.name).opening.id;
    await gw.dropChannel(a.ch.name);
    expect(localChannelsInContainer(gw, "ada:journal")).toEqual([]);
    await gw.erase(aOpening);
    expect(localChannelsInContainer(gw, "ada:journal")).toEqual([]);
    expect(localChannelsInContainer(gw, "bea:notes")).toEqual([b.ch.name]);
  });
});
