import type { Peer } from "./peer.js";
import { poolOwner, ownerTerm } from "./inbox-owner.js";
export { poolOwner } from "./inbox-owner.js";
import { closeContributions, type ReadContribution } from "./read-contribution.js";
import { seedSigner } from "./signer.js";
import { hostChain, inboxLaw, seededLaw } from "./child-law.js";
import { memoryPoolKeys, PoolKeyMissing, poolKeyClaims, recordedPoolKey } from "./pool-keys.js";
import { holdsJournals, type JournalBackend } from "../store/peer-image.js";
import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../store/backend.js";
import { MemoryBackend } from "../store/memory.js";
import { isRepairable } from "../store/quarantine.js";
import { holdsGrant, revocationClaims } from "./accounts.js";
import { grantSubjects } from "./grants-law.js";
import { STORE_ENTITY } from "./genesis.js";
import { orderForPool, isErasure, orderBinds, readErasures } from "./erase-law.js";
import {
  clampedTo,
  newPoolEnvelope,
  poolsBeneath,
  resolveEnvelope,
  type QuarantineEnvelope,
  SIZE_ENVELOPES,
} from "./envelope.js";
import { withNegationClosure, withNegationClosureAcross } from "./negation-closure.js";
import { lawfulHistory } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { ConnectionBinding, FederationReport, Gateway } from "./gateway.js";
import { withStamp } from "./stamp.js";
import {
  delegationClaims,
  delegationRecordsFor,
  delegationRootsTo,
  keyActsFor,
  principalScopeOf,
  standingDelegationIdsFor,
} from "./principal.js";
import { keysSubjectCouldName, subjectCouldName, subjectKeyAt, USER_PREFIX } from "./user-root.js";
import {
  CTX_CONTAINER,
  type ContainerPosture,
  type ContainerTrust,
  chainBreaksAt,
  containerClaims,
  containerRef,
  currentContainerDeclarationId,
  detachClaims,
  governingLeeway,
  grantRoots,
  heldGrantIds,
  inboxName,
  operatorStruckForGood,
  primitives,
  readContainerTable,
  subtreeUnder,
  survivingDeclarationIds,
  survivingWriteGrantIds,
} from "./container-law.js";
import type { Ground } from "./ground.js";

const retractionOf = (targetId: string, author: string, timestamp: number): Claims => ({
  timestamp,
  validFrom: timestamp,
  author,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
});

export function containerScopeImpl(
  gw: Gateway,
  opts: { containers?: readonly string[] } = {},
  serving?: { readonly now: number; readonly asOf?: number },
): Delta[] {
  const table = readContainerTable(gw.reactor, gw.validityNow(serving?.now), gw.operatorAuthor);
  const requested = opts.containers ?? [...table.containers.keys()].sort();
  for (const name of requested) {
    if (!table.containers.has(name)) {
      throw new Error(`containerScope refused: no surviving declaration names "${name}"`);
    }
  }
  const isActive = (name: string): boolean => !table.detached.has(name);
  const sources = new Map<Gateway, ReadContribution>();
  const memberRows = (ground: Gateway, name: string, selected?: Delta[]) => {
    if (serving === undefined)
      return { deltas: selected ?? [...ground.reactor.snapshot()], ground, membership: undefined };
    let contribution = sources.get(ground);
    if (contribution === undefined) {
      contribution = ground.readContribution(serving.now, {
        ...(serving.asOf === undefined ? {} : { asOf: serving.asOf }),
        ...(ground !== gw && name.startsWith("inbox:") ? { inbox: name } : {}),
      });
      sources.set(ground, contribution);
    }
    const ids =
      selected === undefined ? contribution.membership : new Set(selected.map((d) => d.id));
    return { deltas: contribution.rows.filter((d) => ids.has(d.id)), ground, membership: ids };
  };

  const membersOf = (name: string) => {
    const rec = table.containers.get(name)!;
    if (rec.posture === "separate") {
      if (name === gw.poolHandle) return memberRows(gw, name);
      const pool = gw.attachedContainers.get(name);
      if (pool === undefined || !gw.quarantinePools.has(pool)) {
        throw new Error(
          `containerScope refused: the separate container "${name}" is not attached — its bytes ` +
            `cannot be read, and a scope must never resolve as if it were empty (H9). Attach it ` +
            `(openContainer), or detach() it on the record to take it out of scope deliberately.`,
        );
      }
      return memberRows(pool, name);
    }
    let term = rec.membership;
    if (term === undefined && rec.membershipAt !== undefined) {
      const published = gw.reactor.get(rec.membershipAt);
      const raw = published === undefined ? undefined : primitives(published.claims, "term")[0];
      if (typeof raw !== "string") {
        throw new Error(
          `containerScope refused: the membership address ${rec.membershipAt} of container ` +
            `"${name}" resolves to nothing here — partial federation or a missing publish; the ` +
            `read must not be evaluated as if the container were empty (H9)`,
        );
      }
      term = JSON.parse(raw);
    }
    if (term === undefined) {
      throw new Error(
        `containerScope refused: container "${name}" resolves no membership — a shared ` +
          `container IS its membership, and an empty fallback would be the H9 shape`,
      );
    }
    return memberRows(gw, name, gw.select(term, serving?.now));
  };

  const contributionOf = (name: string): { deltas: Delta[]; ground: Gateway } => {
    const all = membersOf(name);
    if (serving !== undefined) return all;
    if (!name.startsWith("inbox:") || name === gw.poolHandle) return all;
    const owner = poolOwner(all.ground);
    if ("refusal" in owner) {
      throw new Error(`containerScope refused: the inbox "${name}" ${owner.refusal}`);
    }
    return { deltas: all.ground.select(ownerTerm(all.ground, owner, name)), ground: all.ground };
  };

  const toGather: string[] = [];
  const seenGather = new Set<string>();
  const addGather = (name: string): void => {
    if (seenGather.has(name)) return;
    seenGather.add(name);
    toGather.push(name);
  };
  for (const name of requested) {
    if (!isActive(name)) continue;
    addGather(name);
    for (const [inboxName, rec] of table.containers) {
      if (rec.inboxOf === name && isActive(inboxName)) addGather(inboxName);
    }
  }

  const contributions = new Map<Gateway, Map<string, Delta>>();
  for (const name of toGather) {
    const { deltas, ground } =
      table.containers.get(name)!.inboxOf === undefined ? membersOf(name) : contributionOf(name);
    const per = contributions.get(ground) ?? new Map<string, Delta>();
    for (const d of deltas) if (!per.has(d.id)) per.set(d.id, d);
    contributions.set(ground, per);
  }

  const minus = new Set<string>();
  for (const name of table.excluded) {
    if (!table.containers.has(name) || !isActive(name)) continue;
    const members = membersOf(name);
    if (members.membership !== undefined) {
      for (const id of members.membership) minus.add(id);
    } else for (const d of members.deltas) minus.add(d.id);
  }

  const grounds = [...contributions.keys()];
  const admitted: Delta[] = [];
  const seen = new Set<string>();
  for (const per of contributions.values()) {
    for (const d of per.values()) {
      if (minus.has(d.id) || seen.has(d.id)) continue;
      seen.add(d.id);
      admitted.push(d);
    }
  }
  return serving === undefined
    ? withNegationClosureAcross(grounds, admitted)
    : closeContributions(
        grounds.map((ground) => sources.get(ground)!),
        admitted,
      );
}

const openerPools = (parent: Gateway): Iterable<Gateway> => parent.store.tableOf(parent).pools;

export function attachedPool(gw: Gateway, name: string): Peer | undefined {
  return gw.store.inboxes(gw).get(name)?.gateway ?? gw.store.channels(gw).get(name)?.gateway;
}

export function openerStands(
  gw: Gateway,
  channel: { readonly openedBy?: string; readonly openedFrom?: string },
): boolean {
  if (channel.openedFrom === undefined) return channel.openedBy === undefined;
  const inbox = gw.connectionInboxes.get(channel.openedFrom)?.gateway;
  if (inbox === undefined) return false;
  const stem = `inbox:${channel.openedBy ?? ""}:`;
  if (!channel.openedFrom.startsWith(stem)) return false;
  const key = channel.openedFrom.slice(stem.length);
  return holdsGrant(
    inbox.reactor,
    inbox.validityNow(),
    STORE_ENTITY,
    key,
    "write",
    inbox.operatorAuthor,
  );
}

export function connectionScopeImpl(
  gw: Gateway,
  opts: { bound: string; containers?: readonly string[] },
  serving?: { readonly now: number; readonly asOf?: number },
): Delta[] {
  const table = readContainerTable(gw.reactor, gw.validityNow(serving?.now), gw.operatorAuthor);
  if (!table.containers.has(opts.bound)) {
    throw new Error(
      `connectionScope refused: no surviving declaration names the bound container "${opts.bound}"`,
    );
  }
  const within = (target: string): boolean => {
    let cursor: string | undefined = target;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor)) {
      if (cursor === opts.bound) return true;
      seen.add(cursor);
      cursor = table.containers.get(cursor)?.parent;
    }
    return false;
  };
  const targets = opts.containers ?? subtreeUnder(table, opts.bound);
  for (const t of targets) {
    if (!within(t)) {
      throw new Error(
        `connectionScope refused: the connection is bound to "${opts.bound}" and cannot reach ` +
          `"${t}" — the binding is an upper bound, not a routing rule (§39.1.2), and "${t}" is ` +
          `outside its subtree`,
      );
    }
  }
  return containerScopeImpl(gw, { containers: targets }, serving);
}

export interface ContainerOptions {
  readonly backend?: StoreBackend;

  readonly admit?: (d: Delta) => boolean;
  readonly membership?: unknown;
  readonly name?: string;
  readonly trust?: ContainerTrust;
  readonly posture?: ContainerPosture;

  readonly channelPool?: true;
}

export interface Container {
  readonly declarationId?: string | undefined;
  readonly entity?: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;

  readonly gateway?: Gateway;

  members(): Delta[];
  reseed(): Promise<FederationReport>;

  drop(): Promise<void>;
  detach(note?: string): Promise<void>;
}

export async function openContainerImpl(
  gw: Gateway,
  opts: ContainerOptions = {},
  voice: "openContainer" | "openQuarantine" = "openContainer",
): Promise<Container> {
  let entity: string | undefined;
  let trust: ContainerTrust | undefined;
  let posture: ContainerPosture | undefined;
  let membership: unknown = opts.membership;
  let membershipAt: string | undefined;

  if (opts.name !== undefined) {
    const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
    const rec = table.containers.get(opts.name);
    if (rec === undefined) {
      throw new Error(
        `${voice}: no surviving declaration names "${opts.name}" — declare it first ` +
          `(an operator-signed claim at ${CTX_CONTAINER})`,
      );
    }
    if (
      (opts.trust !== undefined && opts.trust !== rec.trust) ||
      (opts.posture !== undefined && opts.posture !== rec.posture)
    ) {
      throw new Error(
        `${voice}: "${opts.name}" is declared ${rec.trust}/${rec.posture} — the declaration owns ` +
          `the knobs (§28.4); do not restate them differently at the opener`,
      );
    }
    if (opts.membership !== undefined || opts.admit !== undefined) {
      throw new Error(
        `${voice}: "${opts.name}" resolves its membership from its declaration — re-declare the ` +
          `container to change the knob (a knob change is a delta, never an argument)`,
      );
    }
    entity = opts.name;
    trust = rec.trust;
    posture = rec.posture;
    membership = rec.membership;
    membershipAt = rec.membershipAt;
  } else {
    trust = opts.trust;
    posture = opts.posture;
    if (trust === undefined || posture === undefined) {
      throw new Error(
        `${voice}: an anonymous container names its trust and posture explicitly — there is no ` +
          `declaration to resolve them from`,
      );
    }
  }
  if (trust === "untrusted" && posture === "shared") {
    throw new Error(
      `${voice}: trust "untrusted" cannot take posture "shared" — a container that admits ` +
        `what its parent does not trust keeps its own store, posture "separate" (§28.3)`,
    );
  }

  if (posture === "shared") {
    return openShared(gw, {
      trust,
      membership,
      ...(entity !== undefined ? { entity } : {}),
      ...(membershipAt !== undefined ? { membershipAt } : {}),
      ...(opts.admit !== undefined ? { admit: opts.admit } : {}),
    });
  }
  return openSeparate(
    gw,
    {
      trust,
      membership,
      ...(entity !== undefined ? { entity } : {}),
      ...(opts.admit !== undefined ? { admit: opts.admit } : {}),
      ...(opts.backend !== undefined ? { backend: opts.backend } : {}),
      ...(opts.channelPool === true ? { channelPool: true as const } : {}),
    },
    voice,
  );
}

function openShared(
  gw: Gateway,
  spec: {
    entity?: string;
    trust: ContainerTrust;
    membership: unknown;
    membershipAt?: string;
    admit?: (d: Delta) => boolean;
  },
): Container {
  if (spec.admit !== undefined) {
    throw new Error(
      "openContainer: a shared container has no seeding edge — admit is a separate container's " +
        "knob (§24.2)",
    );
  }
  const resolveTerm = (): unknown => {
    if (spec.entity !== undefined) {
      const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
      const rec = table.containers.get(spec.entity);
      if (rec === undefined) {
        throw new Error(
          `container "${spec.entity}" no longer resolves — its declaration was negated`,
        );
      }
      if (rec.membership !== undefined) return rec.membership;
      if (rec.membershipAt !== undefined) {
        const published = gw.reactor.get(rec.membershipAt);
        const raw = published === undefined ? undefined : primitives(published.claims, "term")[0];
        if (typeof raw !== "string") {
          throw new Error(
            `the membership address ${rec.membershipAt} of container "${spec.entity}" resolves ` +
              `to nothing here — the read fails closed (H9)`,
          );
        }
        return JSON.parse(raw);
      }
      throw new Error(
        `container "${spec.entity}" resolves no membership — the read fails closed (H9)`,
      );
    }
    if (spec.membership === undefined) {
      throw new Error(
        "openContainer: a shared container IS its membership — give a membership Term (H9)",
      );
    }
    return spec.membership;
  };
  resolveTerm();
  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "shared",
    members: () => withNegationClosure(gw, gw.select(resolveTerm())),
    reseed: () => {
      return Promise.reject(
        new Error(
          "a shared container has no seeding edge — it is a query over shared ground; " +
            "reads re-evaluate live",
        ),
      );
    },
    drop: async () => {
      const signer = gw.signer;
      if (spec.entity === undefined || signer === undefined) return;
      const ids = survivingDeclarationIds(
        gw.reactor,
        gw.validityNow(),
        gw.operatorAuthor!,
        spec.entity,
      );
      for (const id of ids) {
        await gw.append([
          signer.sign(withStamp(gw.stamp(), (t) => retractionOf(id, gw.operatorAuthor!, t))),
        ]);
      }
    },
    detach: async (note?: string) => {
      const entity = spec.entity;
      const signer = gw.signer;
      if (entity === undefined || signer === undefined) return;
      await gw.append([
        signer.sign(
          withStamp(gw.stamp(), (t) => detachClaims(entity, note, gw.operatorAuthor!, t)),
        ),
      ]);
    },
  };
}

async function poolGovernor(
  gw: Gateway,
  name: string | undefined,
  backend: StoreBackend,
): Promise<{ seed: string }> {
  if (!holdsJournals(backend)) {
    throw new Error(
      `${name ?? "a pool"}: this store cannot keep a peer journal, and every pool is its own peer ` +
        "under its own key. It is refused rather than opened under the host's key.",
    );
  }
  const keys = gw.poolKeys;
  const recorded =
    name === undefined ? undefined : recordedPoolKey(gw.reactor, gw.operatorAuthor, name);
  if (recorded !== undefined) {
    const seed = keys.load(name!);
    if (seed === undefined || authorForSeed(seed) !== recorded) {
      throw new PoolKeyMissing(
        `${name}: this pool governs itself under ${recorded}, and its key is not here. It is ` +
          "refused rather than reopened under the host's key.",
      );
    }
    return { seed };
  }
  const empty =
    (await backend.journalPeers()).length === 0 && (await backend.holdsAny?.()) === false;
  if (!empty) {
    throw new Error(
      `${name ?? "a pool"}: this pool's store holds bytes, and the host never recorded a key for ` +
        "it. It was made by an earlier Loam, and this Loam does not carry old pools forward. It " +
        "is refused.",
    );
  }
  if (name === undefined) return { seed: memoryPoolKeys().create("anonymous") };
  const seed = keys.create(name);
  await gw.append([
    gw.signer!.sign(
      withStamp(gw.stamp(gw.operatorAuthor), (t) =>
        poolKeyClaims(name, authorForSeed(seed), gw.operatorAuthor!, t),
      ),
    ),
  ]);
  return { seed };
}

async function openSeparate(
  gw: Gateway,
  spec: {
    entity?: string;
    trust: ContainerTrust;
    membership: unknown;
    admit?: (d: Delta) => boolean;
    backend?: StoreBackend;
    channelPool?: true;
  },
  voice: "openContainer" | "openQuarantine",
): Promise<Container> {
  if (gw.signer === undefined) {
    throw new Error(
      voice === "openQuarantine"
        ? "only an operated store can open a quarantine pool (§24.1)"
        : "only an operated store can attach a container's own store (§24.1)",
    );
  }
  if (spec.entity !== undefined && gw.attachedContainers.has(spec.entity)) {
    throw new Error(
      `${voice}: "${spec.entity}" is already attached here — drop() or detach() it first`,
    );
  }
  if (spec.backend !== undefined) {
    if (spec.backend === gw.backend) {
      throw new Error(
        `${voice}: a separate container may not take the store it is opened from as its own — its ` +
          `bytes must be discardable without touching the host's`,
      );
    }
    const root = gw.store.rootOf(gw);
    if (
      spec.backend === root.backend ||
      [...poolsBeneath(root, openerPools)].some(({ pool: p }) => p.backend === spec.backend)
    ) {
      throw new Error(
        `${voice}: a separate container may not take a store already inside this tree as its ` +
          `own — a drop's fan-out walks the whole tree, and a shared store would let one ` +
          `container's discard purge another's ground`,
      );
    }
  }
  const backend: StoreBackend = spec.backend ?? new MemoryBackend();
  const dead = [...readErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor)];
  if (dead.length > 0) {
    let owed: Set<string>;
    try {
      if (backend.heldAmong) {
        owed = await backend.heldAmong(dead);
      } else {
        owed = new Set<string>();
        for (const id of dead) if (await backend.holds(id)) owed.add(id);
      }
      if (owed.size > 0) {
        await backend.purge([...owed]);
        for (const id of owed) {
          if (await backend.holds(id)) {
            throw new Error(`the store still holds ${id} after the settling purge`);
          }
        }
      }
    } catch (err) {
      throw new Error(
        `${voice} refused: this store carries erasure debt that could not be settled — ` +
          `bytes the operator ordered forgotten must not come back inside the walls as a live ` +
          `reader. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  const probationary = spec.trust === "untrusted";
  const own = await poolGovernor(gw, spec.entity, backend);
  const pool = await gw.openChild(backend, {
    seed: own.seed,
    peerStore: (backend as JournalBackend).journalStore(),
    ...(probationary && gw.options.pens !== undefined ? { pens: gw.options.pens } : {}),
  });
  if (spec.channelPool === true) pool.channelPool = true;
  gw.store.attach(pool, gw);
  const hosts = hostChain(gw.signer.author, gw.childLaw);
  pool.childLaw = spec.entity?.startsWith("inbox:") ? inboxLaw(hosts) : seededLaw(hosts);
  pool.pinErasureGovernors(hosts);
  pool.readUsersFrom(gw.userGroundHost());
  if (probationary) {
    pool.probation = spec.entity === undefined ? {} : { container: spec.entity };
  }
  pool.poolHandle = spec.entity ?? `anonymous#${(gw.store.tableOf(gw).anonymousOpened += 1)}`;
  const ground =
    gw.envelopeGround ??
    ((subject?: string): QuarantineEnvelope =>
      resolveEnvelope(gw.reactor, gw.validityNow(), gw.operatorAuthor, subject));
  pool.envelopeGround = ground;
  const ownEnvelope = (): QuarantineEnvelope => ground(spec.entity);
  const outerCeiling = gw.envelopeCeiling;
  const operatorsCeiling =
    outerCeiling === undefined ? ownEnvelope : clampedTo(ownEnvelope, outerCeiling);
  const rootGateway = gw.store.rootOf(gw);
  const ceiling =
    spec.entity === undefined
      ? operatorsCeiling
      : clampedTo(() => {
          const now = governingLeeway(
            readContainerTable(
              rootGateway.reactor,
              rootGateway.validityNow(),
              rootGateway.operatorAuthor,
            ),
            spec.entity!,
          );
          return now === undefined ? operatorsCeiling() : SIZE_ENVELOPES[now.leeway.envelope];
        }, operatorsCeiling);
  pool.envelopeCeiling = ceiling;
  if (spec.trust === "untrusted" || gw.envelope !== undefined) {
    pool.envelope = newPoolEnvelope(pool.poolHandle, spec.entity, ceiling);
  }
  if (spec.admit !== undefined && spec.membership !== undefined) {
    throw new Error(
      `${voice}: give a membership Term OR an admit predicate, not both — admit is the ` +
        `degenerate form of the same knob (§24.10)`,
    );
  }
  if (spec.membership !== undefined) gw.select(spec.membership);
  const base = spec.admit;
  const memberAdmit = (offer: readonly Delta[]): ((d: Delta) => boolean) | undefined => {
    if (spec.membership === undefined && base === undefined) return undefined;
    const selected =
      spec.membership !== undefined ? gw.select(spec.membership) : offer.filter((d) => base!(d));
    const members = new Set(withNegationClosure(gw, selected).map((d) => d.id));
    return (d) => members.has(d.id);
  };
  const reseed = (): Promise<FederationReport> => {
    const offer = gw
      .offeredDeltas()
      .map((d) =>
        isErasure(d.claims) &&
        gw.operatorAuthor !== undefined &&
        orderBinds(d, gw.reactor, gw.operatorAuthor)
          ? orderForPool(gw, d, pool)
          : d,
      );
    const admit = memberAdmit(offer);
    return pool.federate(
      offer,
      admit === undefined ? {} : { admit: (d) => isErasure(d.claims) || admit(d) },
    );
  };
  await reseed();
  pool.replayRegistrations();
  await pool.preloadResolvers();
  gw.quarantinePools.add(pool);

  const unregister = (): void => {
    gw.quarantinePools.delete(pool);
    if (spec.entity !== undefined) gw.attachedContainers.delete(spec.entity);
    gw.store.detach(pool);
  };

  if (spec.entity !== undefined) {
    gw.attachedContainers.set(spec.entity, pool);
    const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
    const records = table.detached.get(spec.entity) ?? [];
    if (records.length > 0) {
      const strikes = records.map((r) =>
        gw.signer!.sign(withStamp(gw.stamp(), (t) => retractionOf(r.id, gw.operatorAuthor!, t))),
      );
      try {
        await gw.append(strikes);
      } catch (err) {
        unregister();
        await pool.close();
        throw new Error(
          `${voice}: the reattach could not clear the detach record(s), so the attach was ` +
            `rolled back — the listing never half-clears (H4). ` +
            `${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
  }

  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "separate",
    gateway: pool,
    declarationId:
      spec.entity === undefined
        ? undefined
        : currentContainerDeclarationId(
            gw.reactor,
            gw.validityNow(),
            gw.operatorAuthor,
            spec.entity,
          ),
    members: () => [...pool.reactor.snapshot()],
    reseed,
    drop: async () => {
      const emptied: string[] = [];
      const refuse = (why: string, cause?: unknown): never => {
        const forward =
          emptied.length === 0
            ? `The pool remains ATTACHED (still in erasure reach); resolve the store ` +
              `fault and drop again, or detach() to keep it deliberately.`
            : `The tree remains ATTACHED (still in erasure reach), but ${emptied.length} nested ` +
              `store(s) were already emptied before the fault: ${emptied.join(", ")}. ` +
              `detach() would keep only what the sweep left, so resolve the store fault and ` +
              `drop again — the session reactors still name every purged id, and the re-run ` +
              `completes the discard.`;
        throw new Error(
          `drop refused: ${why} — a dropped pool must not become bytes outside the erasure ` +
            `fan-out. ${forward}`,
          cause === undefined ? undefined : { cause },
        );
      };
      const discardBytes = async (target: Gateway, who: string): Promise<void> => {
        const ids = new Set((await target.backend.deltasSince(new Set())).map((d) => d.id));
        for (const d of target.reactor.snapshot()) ids.add(d.id);
        if (isRepairable(target.backend)) {
          for (const row of await target.backend.quarantine()) {
            await target.backend.discardRow(row.key);
            ids.add(row.key);
          }
        }
        if (ids.size > 0) {
          const batch = [...ids];
          await target.backend.purge(batch);
          let survivors: Set<string>;
          if (target.backend.heldAmong) {
            survivors = await target.backend.heldAmong(batch);
          } else {
            survivors = new Set<string>();
            for (const id of batch) if (await target.backend.holds(id)) survivors.add(id);
          }
          if (survivors.size > 0) {
            refuse(
              `${who}'s store still holds ${survivors.size} of ${batch.length} delta(s) ` +
                `after the discard purge`,
            );
          }
        }
        if (isRepairable(target.backend)) {
          await target.backend.deltasSince(new Set());
          const pen = await target.backend.quarantine();
          if (pen.length > 0) {
            refuse(`${who}'s §25 pen still holds ${pen.length} set-aside row(s) after the sweep`);
          }
        }
        const journaled = holdsJournals(target.backend);
        if (journaled && (await target.backend.holdsAnyRow())) {
          refuse(
            `${who}'s store still holds bytes that no read named after the sweep (a tier a partial ` +
              `purge left behind). To discard it: take it out of scope first (detach()), heal its ` +
              `store while nothing is attached to it so every tier shows what it holds, open it ` +
              `again, then drop again`,
          );
        }
        if (journaled) await target.backend.discardJournals();
        if (target.backend.holdsAny !== undefined && (await target.backend.holdsAny())) {
          refuse(
            `${who}'s store still holds bytes that no read named after the sweep (a tier a partial ` +
              `purge left behind). To discard it: take it out of scope first (detach()), heal its ` +
              `store while nothing is attached to it so every tier shows what it holds, open it ` +
              `again, then drop again`,
          );
        }
      };
      const beneath = [...poolsBeneath(pool, openerPools, `${pool.poolHandle ?? "?"}/`)];
      try {
        for (const { pool: nested, handle } of beneath) {
          await discardBytes(nested, `the nested pool "${handle}"`);
          emptied.push(`"${handle}"`);
        }
        await discardBytes(pool, "this pool");
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("drop refused:")) throw err;
        refuse(
          `this pool's store could not be proven clean (${
            err instanceof Error ? err.message : String(err)
          })`,
          err,
        );
      }
      unregister();
      for (const { pool: nested } of [...beneath].reverse()) {
        gw.store.detach(nested);
        await nested.close();
      }
      await pool.close();
      if (spec.entity !== undefined) {
        try {
          for (const id of survivingDeclarationIds(
            gw.reactor,
            gw.validityNow(),
            gw.operatorAuthor!,
            spec.entity,
          )) {
            await gw.append([
              gw.signer!.sign(
                withStamp(gw.stamp(), (t) => retractionOf(id, gw.operatorAuthor!, t)),
              ),
            ]);
          }
        } catch (err) {
          throw new Error(
            `drop discarded "${spec.entity}" at the bytes — every store in its subtree is ` +
              `proven empty and closed — but the declaration could not be negated, so the ` +
              `LISTING still names it. When the primary recovers, openContainer({ name }) and ` +
              `drop() again to settle the listing; the re-run is safe over the empty store. ` +
              `${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
      }
    },
    detach: async (note?: string) => {
      const entity = spec.entity;
      if (entity !== undefined) {
        await gw.append([
          gw.signer!.sign(
            withStamp(gw.stamp(), (t) => detachClaims(entity, note, gw.operatorAuthor!, t)),
          ),
        ]);
      }
      unregister();
      await pool.close();
    },
  };
}

export interface BindConnectionOptions {
  readonly container: string;
  readonly connectionKey: string;
  readonly ownerSeed: string;

  readonly ownerName?: string;
  readonly backend?: StoreBackend;
}

export function poolForBindingImpl(gw: Gateway, binding: ConnectionBinding): Gateway {
  return bindingPoolOf(gw, binding);
}

export function bindingPeer(gw: Gateway, binding: ConnectionBinding): Peer {
  return bindingPoolOf(gw, binding);
}

function bindingPoolOf(gw: Gateway, binding: ConnectionBinding): Gateway {
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  if (chainBreaksAt(table, binding.container) !== undefined) {
    throw new Error(
      `the container ${binding.container} this connection is bound to no longer stands, so this ` +
        `write is refused — it would land where nothing can read it. Consent again and choose a ` +
        `container that stands.`,
    );
  }
  const held = gw.connectionInboxes.get(binding.inbox);
  if (held?.gateway === undefined) {
    throw new Error(
      `the inbox ${binding.inbox} is not attached here, so this write is refused — the ` +
        `connection's pool is where its writes land, and nothing stands in for it. Consent ` +
        `again to bind the connection to a pool this store holds.`,
    );
  }
  if (gw.attachedContainers.get(binding.inbox) !== held.gateway) {
    throw new Error(
      `the inbox ${binding.inbox} is being dropped, so this write is refused — write again ` +
        `once the drop has settled, or consent again to bind afresh`,
    );
  }
  return held.gateway;
}

function delegationStruckForGood(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  d: Delta,
): boolean {
  return reactor.negationsOf(d.id).some((n) => {
    const neg = reactor.get(n);
    return (
      neg !== undefined &&
      (neg.claims.author === d.claims.author || neg.claims.author === operator) &&
      neg.claims.validFrom <= now &&
      neg.claims.validUntil === undefined &&
      reactor.negationsOf(n).length === 0
    );
  });
}

export async function bindConnectionImpl(
  gw: Gateway,
  opts: BindConnectionOptions,
): Promise<Container> {
  if (gw.signer === undefined) {
    throw new Error(
      "bindConnection: only an operated store can bind a connection to a container (§39)",
    );
  }
  const hostSigner = gw.signer;
  const operator = gw.operatorAuthor!;
  const owner = authorForSeed(opts.ownerSeed);
  const name = inboxName(opts.container, opts.connectionKey);
  const userSubject = opts.ownerName === undefined ? undefined : `${USER_PREFIX}${opts.ownerName}`;
  const currentRoot =
    userSubject === undefined
      ? undefined
      : subjectKeyAt(gw.reactor, gw.validityNow(), operator, userSubject);
  if (userSubject !== undefined && currentRoot !== owner) {
    throw new Error(
      currentRoot === undefined
        ? `${opts.ownerName} has no current key in this store's user record, so the connection ` +
            `was not bound — nothing was written. The operator must give them a key first.`
        : `${opts.ownerName}'s current key is not the one this home holds for them, so the ` +
            `connection was not bound — nothing was written. The seed file is out of date: the ` +
            `user's key was replaced, and the new key must authorize its connections itself.`,
    );
  }

  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const declared = table.containers.has(name);
  const held = declared ? gw.connectionInboxes.get(name) : undefined;
  if (held !== undefined && gw.attachedContainers.get(name) !== held.gateway) {
    throw new Error(
      `bindConnection: the inbox ${name} is being dropped — bind again once the drop has settled`,
    );
  }
  const live = held;
  if (!declared) {
    const boundAt = gw.stamp().timestamp;
    const membership = {
      op: "select",
      pred: {
        and: [
          { match: { field: "author", cmp: "eq", const: opts.connectionKey } },
          { match: { field: "timestamp", cmp: "gt", const: boundAt } },
        ],
      },
      in: "input",
    };
    await gw.append([
      hostSigner.sign(
        withStamp(gw.stamp(), (t) =>
          containerClaims(
            {
              container: name,
              trust: "curated",
              posture: "separate",
              membership,
              inboxOf: opts.container,
            },
            operator,
            t,
          ),
        ),
      ),
    ]);
  }

  const backend = opts.backend ?? gw.options.channelBackend?.(name);
  const inbox =
    live ??
    (await openContainerImpl(gw, {
      name,
      ...(backend !== undefined ? { backend } : {}),
    }));
  const pool = inbox.gateway!;
  pool.honorDelegationsAt(name);

  const poolLaw = pool.operatorAuthor!;
  const ownerSubject = userSubject ?? owner;
  if (!holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, owner, "admin", poolLaw)) {
    await pool.issueGrant(ownerSubject, "admin");
  }
  const now = pool.validityNow();
  const otherSubjects = grantSubjects(pool.reactor).filter((subject) => {
    const key = subjectKeyAt(pool.reactor, now, operator, subject);
    return key !== undefined && key !== owner;
  });
  const couldBe = grantSubjects(pool.reactor)
    .filter((subject) => subject.startsWith(USER_PREFIX))
    .flatMap((subject) => keysSubjectCouldName(pool.reactor, now, operator, subject));
  const others = [...new Set([...grantRoots(pool.reactor, now, poolLaw), ...couldBe])].filter(
    (root) => root !== owner && root !== opts.connectionKey,
  );
  const struckForGood = (id: string) =>
    operatorStruckForGood(pool.reactor, now, poolLaw, id, opts.connectionKey);
  const stale = [
    ...delegationRecordsFor(pool.reactor, others, opts.connectionKey).map((d) => d.id),
    ...otherSubjects.flatMap((subject) => heldGrantIds(pool.reactor, subject, "admin")),
  ].filter((id) => !struckForGood(id));
  const fresh = !keyActsFor(pool.reactor, now, { root: owner }, opts.connectionKey, name, poolLaw);
  if (fresh || stale.length > 0) {
    await pool.append([
      ...(fresh
        ? [
            signClaims(
              withStamp(pool.stamp(owner), (t) =>
                delegationClaims(owner, opts.connectionKey, name, t),
              ),
              opts.ownerSeed,
            ),
          ]
        : []),
      ...pool.revocations(stale),
    ]);
  }

  if (live !== undefined) return live;
  const handle = inboxHandle(gw, name, inbox);
  gw.connectionInboxes.set(name, handle);
  return handle;
}

function inboxHandle(gw: Gateway, name: string, inbox: Container): Container {
  const baseDrop = inbox.drop.bind(inbox);
  return {
    ...inbox,
    drop: async () => {
      try {
        await baseDrop();
      } finally {
        if (!gw.attachedContainers.has(name)) gw.connectionInboxes.delete(name);
      }
    },
    detach: () =>
      Promise.reject(
        new Error(
          `an inbox is durable (§39): it does not detach. Use drop() for a total forget, or ` +
            `revokeConnection to refuse further writes while keeping the connection's record.`,
        ),
      ),
  };
}

export async function resumeInboxesImpl(gw: Gateway): Promise<void> {
  if (gw.operatorAuthor === undefined) return;
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  for (const [name, rec] of table.containers) {
    if (rec.inboxOf === undefined || !name.startsWith("inbox:")) continue;
    if (gw.connectionInboxes.has(name) || table.detached.has(name)) continue;
    const backend = gw.options.channelBackend?.(name);
    if (backend === undefined) continue;
    try {
      const handle = await openContainerImpl(gw, { name, backend });
      handle.gateway?.honorDelegationsAt(name);
      gw.connectionInboxes.set(name, inboxHandle(gw, name, handle));
    } catch {
      continue;
    }
  }
}

export async function revokeConnectionImpl(opts: {
  inbox: Container;
  connectionKey: string;
  ownerSeed?: string;
  asPool?: boolean;
}): Promise<void> {
  const pool = opts.inbox.gateway;
  if (pool === undefined) {
    throw new Error("revokeConnection: the inbox has no pool of its own — nothing to revoke (§39)");
  }
  const voice =
    opts.asPool === true || opts.ownerSeed === undefined ? undefined : seedSigner(opts.ownerSeed);
  const owner = opts.asPool === true ? pool.operatorAuthor : voice?.author;
  if (owner === undefined) {
    throw new Error("revokeConnection: name the owner's seed, or revoke in the pool's own voice");
  }
  const now = pool.validityNow();
  const scope = principalScopeOf(pool.reactor);
  const unreadable = grantSubjects(pool.reactor).filter(
    (subject) =>
      subject.startsWith(USER_PREFIX) &&
      subjectKeyAt(pool.reactor, now, pool.operatorAuthor, subject) === undefined &&
      heldGrantIds(pool.reactor, subject, "admin").some(
        (id) =>
          pool.reactor.get(id)?.claims.author !== opts.connectionKey &&
          !operatorStruckForGood(pool.reactor, now, pool.operatorAuthor, id, opts.connectionKey),
      ),
  );
  const naming = grantSubjects(pool.reactor).filter(
    (subject) =>
      subject.startsWith(USER_PREFIX) &&
      subjectCouldName(pool.reactor, now, pool.operatorAuthor, subject, opts.connectionKey) &&
      (["write", "admin"] as const).some((verb) =>
        heldGrantIds(pool.reactor, subject, verb).some(
          (id) =>
            pool.reactor.get(id)?.claims.author !== opts.connectionKey &&
            !operatorStruckForGood(pool.reactor, now, pool.operatorAuthor, id, opts.connectionKey),
        ),
      ),
  );
  const byOperator = owner === pool.operatorAuthor;
  const candidates = new Set<string>();
  for (const subject of grantSubjects(pool.reactor)) {
    const live = heldGrantIds(pool.reactor, subject, "admin").some(
      (id) =>
        pool.reactor.get(id)?.claims.author !== opts.connectionKey &&
        !operatorStruckForGood(pool.reactor, now, pool.operatorAuthor, id, opts.connectionKey),
    );
    if (!live) continue;
    for (const key of keysSubjectCouldName(pool.reactor, now, pool.operatorAuthor, subject)) {
      if (key !== opts.connectionKey) candidates.add(key);
    }
  }
  if (byOperator) {
    for (const key of delegationRootsTo(pool.reactor, opts.connectionKey)) {
      if (key !== opts.connectionKey) candidates.add(key);
    }
  }
  const latentIds: string[] = [];
  const latent = new Set<string>();
  for (const key of candidates) {
    for (const d of delegationRecordsFor(pool.reactor, [key], opts.connectionKey)) {
      if (delegationStruckForGood(pool.reactor, now, pool.operatorAuthor, d)) continue;
      if (key === owner || byOperator) latentIds.push(d.id);
      else latent.add(key);
    }
  }
  if (latent.size > 0) {
    throw new Error(
      `revokeConnection: ${[...latent].join(", ")} signed a delegation to ${opts.connectionKey} ` +
        `and holds, or may later hold, admin standing here, so a strike in ${owner}'s voice ` +
        `cannot stop it for good. Nothing was struck. The operator can revoke instead, or drop ` +
        `this inbox.`,
    );
  }
  if (naming.length > 0) {
    throw new Error(
      `revokeConnection: this inbox holds a grant naming ${naming.join(", ")}, a user whose root is ` +
        `or may become ${opts.connectionKey} itself, so no strike here can stop it for good. ` +
        `Nothing was struck. Strike that root claim for good, or drop this inbox.`,
    );
  }
  if (unreadable.length > 0 && !byOperator) {
    throw new Error(
      `revokeConnection: this inbox holds an owner grant naming ${unreadable.join(", ")}, whose ` +
        `root cannot be read now — that user's record may be struck or erased — so what lets ` +
        `${opts.connectionKey} write cannot be found in full from ${owner}'s voice. Nothing was ` +
        `struck. The operator can revoke instead, or drop this inbox.`,
    );
  }
  const ids = [
    ...survivingWriteGrantIds(pool.reactor, now, opts.connectionKey, pool.operatorAuthor),
    ...latentIds,
    ...(scope === undefined
      ? []
      : standingDelegationIdsFor(
          pool.reactor,
          now,
          grantRoots(pool.reactor, now, pool.operatorAuthor),
          opts.connectionKey,
          scope,
          pool.operatorAuthor,
        )),
  ];
  if (ids.length === 0) {
    throw new Error(
      `revokeConnection: nothing in this inbox lets ${opts.connectionKey} write — no surviving ` +
        `write grant and no standing delegation names it`,
    );
  }
  const struckIds = [...new Set(ids)];
  await pool.append(
    voice === undefined
      ? pool.revocations(struckIds)
      : struckIds.map((id) =>
          voice.sign(withStamp(pool.stamp(owner), (t) => revocationClaims(id, owner, t))),
        ),
  );
  if (
    holdsGrant(
      pool.reactor,
      pool.validityNow(),
      STORE_ENTITY,
      opts.connectionKey,
      "write",
      pool.operatorAuthor,
    )
  ) {
    throw new Error(
      `revokeConnection: the strikes landed but ${opts.connectionKey} still writes here — ` +
        `${owner} did not sign what lets it write, and is not this store's operator`,
    );
  }
}

export function unreachableStoreReport(gw: Gateway): {
  faults: string[];
  kept: string[];

  faultEntities: string[];
} {
  const now = gw.validityNow();
  const table = readContainerTable(gw.reactor, now, gw.operatorAuthor);
  const faults: string[] = [];
  const kept: string[] = [];
  const faultEntities: string[] = [];
  const lineageSeparate = new Set<string>();
  const endedSeparate = new Set<string>();
  const notForgotten = new Set<string>();
  if (gw.operatorAuthor !== undefined) {
    const negated = negatedAt(gw.reactor, now, gw.operatorAuthor);
    for (const delta of lawfulHistory(gw.reactor, gw.operatorAuthor)) {
      const name = containerRef(delta.claims, CTX_CONTAINER);
      if (name === undefined) continue;
      const struck = negated(delta.id);
      if (!struck) notForgotten.add(name);
      if (primitives(delta.claims, "posture")[0] !== "separate") continue;
      const until = delta.claims.validUntil;
      const ended = until !== undefined && until <= now;
      if (!struck && !ended) continue;
      lineageSeparate.add(name);
      if (!struck) endedSeparate.add(name);
    }
  }
  const named = new Map<string, string>();
  for (const [entity, rec] of table.containers) {
    if (rec.posture === "separate" || lineageSeparate.has(entity)) named.set(entity, rec.posture);
  }
  for (const entity of lineageSeparate) {
    if (table.containers.has(entity) || !notForgotten.has(entity)) continue;
    named.set(entity, endedSeparate.has(entity) ? "ended" : "lineage");
  }
  for (const [entity, posture] of named) {
    const attached = gw.attachedContainers.get(entity);
    if (attached !== undefined && gw.quarantinePools.has(attached)) continue;
    if (table.detached.has(entity)) {
      kept.push(entity);
      continue;
    }
    faultEntities.push(entity);
    faults.push(
      posture === "separate"
        ? `the declared separate container "${entity}" is neither attached nor covered by a detach ` +
            `record — its store may hold bytes outside this sweep. Attach it (openContainer) and ` +
            `re-run, or detach() it on the record to keep it deliberately.`
        : posture === "ended"
          ? `container "${entity}" was declared separate, and that declaration's validity has ` +
            `ended — but an expiry is not a forget, and its store may still hold bytes outside ` +
            `this sweep. Cover it with a detach record, or negate every declaration of it to ` +
            `forget it whole.`
          : posture === "lineage"
            ? `container "${entity}" once had a store of its own, and not every declaration of ` +
              `it is negated — its store may still hold bytes outside this sweep. Cover it with a ` +
              `detach record, or negate every declaration of it to forget it whole.`
            : `container "${entity}" resolves posture "${posture}", but a negated or ended ` +
              `declaration in its lineage gave it a store of its OWN — which may still hold bytes ` +
              `outside this sweep (§28.4: the knobs do not flip through the survival algebra). ` +
              `Cover it with a detach record, or forget the container whole and declare a new name.`,
    );
  }
  for (const entity of table.detached.keys()) {
    if (!table.containers.has(entity) && !kept.includes(entity)) kept.push(entity);
  }
  faults.sort();
  kept.sort();
  faultEntities.sort();
  return { faults, kept, faultEntities };
}
