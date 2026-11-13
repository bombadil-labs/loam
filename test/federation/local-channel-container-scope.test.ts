import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  containerClaims,
  survivingDeclarationIds,
  termClaims,
} from "../../src/gateway/container-law.js";
import { SEALED_LEEWAY } from "../../src/gateway/leeway.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import {
  LOCAL_EVENT,
  localChannelEvidence,
  localChannelsInContainer,
  localControlChannel,
  PARENT_CONTAINER,
  parseLocalEvent,
} from "../../src/federation/local-channel-events.js";
import { inLocalContext, LOCAL_CONTROL } from "../../src/gateway/erase-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

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
      expect(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, "friends")).not.toContain(
        d.id,
      );
    }
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
    const copy = signClaims({ ...opening.claims, ...gw.stamp(OP) }, SEED);
    await expect(gw.append([copy])).rejects.toThrow(/protected local channel event/);
    const report = await gw.federate([copy], { admit: () => true });
    expect(report.accepted).toBe(0);
    const term = frozenMembershipTerm([opening.id]);
    const published = signClaims(
      withStamp(gw.stamp(OP), (t) => termClaims(term, OP, t)),
      SEED,
    );
    await gw.append([published]);
    const version = gw.freeze(term).id;
    const container = "container:slate:channel";
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            {
              container,
              trust: "curated",
              posture: "shared",
              membershipAt: published.id,
              version,
            },
            OP,
            t,
          ),
        ),
        SEED,
      ),
    ]);
    const record = signClaims(
      withStamp(gw.stamp(OP), (t) =>
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
          t,
        ),
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
    const pool = gatewayOf(ch.pool).backend as MemoryBackend & { failPurge?: boolean };
    const purge = pool.purge.bind(pool);
    pool.purge = () => Promise.reject(new Error("fixture purge failure"));
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/could not be proven clean/);
    expect(localChannelsInContainer(gw, "friends")).toEqual([ch.name]);
    expect(localChannelEvidence(gw, ch.name).state).not.toBe("open");
    pool.purge = purge;
    await gw.dropChannel(ch.name);
    expect(localChannelsInContainer(gw, "friends")).toEqual([]);
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
          withStamp(gw.stamp(OP), (t) =>
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
              t,
            ),
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
    const aOpening = opened(gw, a.ch.name).opening.id;
    await gw.dropChannel(a.ch.name);
    expect(localChannelsInContainer(gw, "ada:journal")).toEqual([]);
    await gw.erase(aOpening);
    expect(localChannelsInContainer(gw, "ada:journal")).toEqual([]);
    expect(localChannelsInContainer(gw, "bea:notes")).toEqual([b.ch.name]);
  });
});
