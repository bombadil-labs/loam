import { issueChannelEvent, receiveChannelOfferInCommit } from "../gateway/ingest.js";
import type { Peer, PeerEntry } from "../gateway/peer.js";
import {
  localChannelEvidence,
  localChannelLifecycle,
  currentPoolDeclaration,
  orphanedDeclaration,
  withChannelCommit,
  type LocalChannelOpening,
} from "./local-channel-events.js";

import type { Delta } from "@bombadil/rhizomatic";
import type { Claims } from "@bombadil/rhizomatic";
import { contentAddress, DeltaSet, makeNegationClaims } from "@bombadil/rhizomatic";
import type { Container } from "../gateway/container.js";
import { openerStands } from "../gateway/container.js";
import {
  containerClaims,
  danglingAncestor,
  everDeclared,
  readContainerTable,
  receivesNow,
} from "../gateway/container-law.js";
import type { FederationReport, Gateway } from "../gateway/gateway.js";
import { legalNameFor } from "../gateway/gql.js";
import { parseOffer } from "./offer.js";
import {
  CTX_MANIFEST,
  explainMissingDefinition,
  isRegistrationBinding,
  isWithheldResolver,
  readManifest,
} from "../gateway/adopt-vocab.js";
import { CTX_REGISTRATION, lensOf } from "../gateway/registration.js";
import { lawfulHistory, lawfulSnapshot } from "../gateway/lawful.js";
import { negatedAt } from "../gateway/negation.js";
import { freezeMembers } from "../gateway/container-identity.js";
import type { RendererBinding } from "../gateway/renderers.js";
import { readForeignRenderers, readPoolRenderers, routeServableOn } from "../gateway/renderers.js";
import { withStamp } from "../gateway/stamp.js";

export interface ChannelSource {
  pull(): Promise<readonly Delta[]>;
}

export interface OpenChannelOptions {
  readonly into: string;
  readonly prefix: string;
  readonly source: ChannelSource;

  readonly from?: string;

  readonly pullsFrom?: string;
  readonly bless?: boolean;

  readonly openedBy?: string;
  readonly openedFrom?: string;
}

export interface SyncReport {
  readonly offered: number;
  readonly accepted: number;
  readonly duplicates: number;
  readonly bound: string[];
  readonly parked: string[];

  readonly witnessed: string[];

  readonly apps: readonly ArrivedApp[];
}

export interface ArrivedApp {
  readonly channel: string;
  readonly route: string;
  readonly serves: string;

  readonly hash?: string;
  readonly mounted?: string;
  readonly serving?: string;

  readonly shadowed?: string;
  readonly remedy?: string;
  readonly dark?: true;

  readonly wantsPen?: string;

  readonly unmountable?: string;

  readonly blocked?: string;
  readonly blessed: boolean;
}

export interface ChannelStatus {
  readonly name: string;
  readonly into: string;
  readonly prefix: string;
  readonly receiving: boolean;
  readonly blessing: boolean;
  readonly lastSyncedAt: number;
  readonly consecutiveFailures: number;
  readonly from: string;
  readonly openedBy?: string;
  readonly openedFrom?: string;

  readonly unattested: readonly string[];

  readonly unreadable: readonly string[];
}

const isText = (v: unknown): boolean => typeof v === "string";
const isFlag = (v: unknown): boolean => typeof v === "boolean";
const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;

const RECORD_SHAPES: readonly (readonly [string, (v: unknown) => boolean])[] = [
  ["into", isText],
  ["prefix", isText],
  ["receiving", isFlag],
  ["blessing", isFlag],
  ["lastSyncedAt", isCount],
  ["consecutiveFailures", isCount],
];

export const CTX_CHANNEL = "loam.channel";

const fromDisagrees = (
  recorded: string,
  opts: { readonly from?: string; readonly pullsFrom?: string },
): boolean =>
  opts.from !== undefined
    ? recorded !== opts.from
    : opts.pullsFrom !== undefined && recorded !== "" && recorded !== opts.pullsFrom;
const opener = (of: {
  readonly openedBy?: string;
  readonly openedFrom?: string;
}): { openedBy?: string; openedFrom?: string } => ({
  ...(of.openedBy === undefined ? {} : { openedBy: of.openedBy }),
  ...(of.openedFrom === undefined ? {} : { openedFrom: of.openedFrom }),
});

export function channelRecordClaims(
  status: ChannelStatus,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "channel",
        target: { kind: "entity", entity: { id: `channel:${status.name}`, context: CTX_CHANNEL } },
      },
      { role: "into", target: { kind: "primitive", value: status.into } },
      { role: "prefix", target: { kind: "primitive", value: status.prefix } },
      ...(status.openedBy === undefined
        ? []
        : [
            {
              role: "openedBy" as const,
              target: { kind: "primitive" as const, value: status.openedBy },
            },
          ]),
      ...(status.openedFrom === undefined
        ? []
        : [
            {
              role: "openedFrom" as const,
              target: { kind: "primitive" as const, value: status.openedFrom },
            },
          ]),
      { role: "receiving", target: { kind: "primitive", value: status.receiving } },
      { role: "blessing", target: { kind: "primitive", value: status.blessing } },
      { role: "lastSyncedAt", target: { kind: "primitive", value: status.lastSyncedAt } },
      {
        role: "consecutiveFailures",
        target: { kind: "primitive", value: status.consecutiveFailures },
      },
      ...(status.from === ""
        ? []
        : [{ role: "from" as const, target: { kind: "primitive" as const, value: status.from } }]),
      ...status.unattested.map((id) => ({
        role: "unattested" as const,
        target: { kind: "primitive" as const, value: id },
      })),
    ],
  };
}

export const CTX_ARRIVAL = "loam.arrival";

export const ARRIVAL_FAN = 256;

export function arrivalClaims(
  arrival: { channel: string; from: string; arrived: readonly string[] },
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "arrival",
        target: {
          kind: "entity",
          entity: { id: `channel:${arrival.channel}`, context: CTX_ARRIVAL },
        },
      },
      ...(arrival.from === ""
        ? []
        : [{ role: "from" as const, target: { kind: "primitive" as const, value: arrival.from } }]),
      ...arrival.arrived.map((id) => ({
        role: "arrived" as const,
        target: { kind: "delta" as const, deltaRef: { delta: id } },
      })),
    ],
  };
}

class UnattestedArrivals extends Error {
  readonly unattested: readonly string[];
  constructor(message: string, unattested: readonly string[]) {
    super(message);
    this.unattested = unattested;
  }
}

async function attestArrival(
  gw: Gateway,
  ground: Peer,
  name: string,
  from: string,
  report: FederationReport,
  owed: readonly string[],
): Promise<void> {
  if (report.accepted === 0 && owed.length === 0) return;
  const arrived = report.acceptedIds;
  if (arrived === undefined || arrived.length !== report.accepted) {
    throw new Error(
      `sync could not record the arrival on "${name}": the pool's door reported ${report.accepted} ` +
        `accepted delta(s) and named ${arrived?.length ?? 0} of them, so an attestation would ` +
        `claim a custody it cannot point at. The peer's deltas landed; nothing was attested, and ` +
        `the channel cannot record which arrivals are owed one.`,
    );
  }
  const union = [...new Set([...owed, ...arrived])];
  const chunks: string[][] = [];
  for (let i = 0; i < union.length; i += ARRIVAL_FAN) chunks.push(union.slice(i, i + ARRIVAL_FAN));
  const stamps = ground.arrivalStamps(name, from, chunks);
  const batch = chunks.map((refs, i) => ({ refs, stamp: stamps[i]! }));
  let landed: FederationReport;
  try {
    landed = await ground.federate(
      batch.map((b) => b.stamp),
      { ids: true },
    );
  } catch (err) {
    throw new UnattestedArrivals(err instanceof Error ? err.message : String(err), union);
  }
  if (landed.accepted !== batch.length) {
    const stood = new Set(landed.acceptedIds ?? []);
    const covered = new Set(batch.filter((b) => stood.has(b.stamp.id)).flatMap((b) => b.refs));
    const unattested = union.filter((id) => !covered.has(id));
    throw new UnattestedArrivals(
      `sync could not fully record the arrival on "${name}": the pool took ${landed.accepted} of ` +
        `${batch.length} attestation(s). The ${unattested.length} arrival(s) not yet named are ` +
        `recorded on the channel and will be re-attested on the next sync.`,
      unattested,
    );
  }
}

export function channelsEverImpl(gw: Gateway, name?: string): ChannelStatus[] {
  return readChannels(gw, name, true);
}

export function channelStatusImpl(gw: Gateway, name?: string): ChannelStatus[] {
  return readChannels(gw, name, false);
}

function readChannels(
  gw: Gateway,
  name: string | undefined,
  includeSevered: boolean,
): ChannelStatus[] {
  const operator = gw.operatorAuthor;
  const negated = negatedAt(gw.reactor, gw.validityNow(), operator);
  const latest = new Map<string, { at: number; status: ChannelStatus }>();
  const records = includeSevered
    ? lawfulHistory(gw.reactor, operator)
    : lawfulSnapshot(gw.reactor, gw.validityNow(), operator);
  for (const d of records) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (!includeSevered && negated(d.id)) continue;
    const of = (role: string): string | number | boolean | undefined => {
      const p = d.claims.pointers.find((q) => q.role === role);
      return p?.target.kind === "primitive" ? p.target.value : undefined;
    };
    const channel = marker.target.entity.id.slice("channel:".length);
    const held = latest.get(channel);
    if (held !== undefined && held.at >= d.claims.timestamp) continue;
    const unreadable: string[] = [];
    for (const [role, holds] of RECORD_SHAPES) {
      if (!holds(of(role))) unreadable.push(role);
    }
    const address = d.claims.pointers.find((p) => p.role === "from");
    if (
      address !== undefined &&
      (address.target.kind !== "primitive" || typeof address.target.value !== "string")
    ) {
      unreadable.push("from");
    }
    const unattested: string[] = [];
    let debtUnreadable = false;
    for (const p of d.claims.pointers) {
      if (p.role !== "unattested") continue;
      if (p.target.kind !== "primitive") debtUnreadable = true;
      else unattested.push(String(p.target.value));
    }
    if (debtUnreadable) unreadable.push("unattested");
    latest.set(channel, {
      at: d.claims.timestamp,
      status: {
        name: channel,
        into: String(of("into") ?? ""),
        prefix: String(of("prefix") ?? ""),
        receiving: of("receiving") !== false,
        blessing: of("blessing") !== false,
        lastSyncedAt: Number(of("lastSyncedAt") ?? 0),
        consecutiveFailures: Number(of("consecutiveFailures") ?? 0),
        from: String(of("from") ?? ""),
        ...(typeof of("openedBy") === "string" ? { openedBy: String(of("openedBy")) } : {}),
        ...(typeof of("openedFrom") === "string" ? { openedFrom: String(of("openedFrom")) } : {}),
        unattested,
        unreadable,
      },
    });
  }
  const all = [...latest.values()].map((v) => v.status);
  return name === undefined ? all : all.filter((s) => s.name === name);
}

export interface Channel {
  readonly name: string;
  readonly into: string;
  readonly prefix: string;
  readonly pool: PeerEntry;
  sync(): Promise<SyncReport>;
}

const AGGREGATOR = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "\u0000none" } },
  in: "input",
} as const;

export const channelName = (into: string, prefix: string): string => `channel:${into}:${prefix}`;

async function bindArrived(
  gw: Gateway,
  ground: Peer,
  prefix: string,
): Promise<{ bound: string[]; parked: string[]; witnessed: string[] }> {
  const operator = ground.operatorAuthor;
  if (operator === undefined) throw new Error("bindArrived: this pool has no governing key");
  const bound: string[] = [];
  const parked: string[] = [];
  const witnessed: string[] = [];

  const members = [...ground.reactor.snapshot()];
  const rows = new Map<string, string>();
  for (const d of members) {
    if (!isRegistrationBinding(d.claims)) continue;
    if (d.claims.author === gw.operatorAuthor || ground.localAuthors().includes(d.claims.author)) {
      continue;
    }
    const target = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    if (target === undefined || target.target.kind !== "entity") continue;
    const pointed = target.target.entity.id;
    const entity = pointed.startsWith("registration:")
      ? pointed.slice("registration:".length)
      : pointed;
    if (!entity.startsWith("hyperschema:")) continue;
    const living = d.claims.pointers.find((p) => p.role === "schema");
    const lens =
      living?.target.kind === "entity" && living.target.entity.id.startsWith("schema:")
        ? living.target.entity.id.slice("schema:".length)
        : entity.slice("hyperschema:".length);
    rows.set(lens, entity);
  }
  if (rows.size === 0) return { bound, parked, witnessed };

  const pending = [...rows].filter(
    ([alias]) =>
      !members.some((d) => d.claims.author === operator && manifestAliasOf(d.claims) === alias),
  );
  if (pending.length > 0) {
    await ground.exportManifestRows(
      pending.map(([alias, entity]) => ({ alias, targetEntity: entity, kind: "schema" })),
    );
  }

  const version = freezeMembers([...ground.reactor.snapshot()]);
  const cursed = new Set(cursesOf(gw, channelNameOf(gw, prefix)).map((c) => c.living));
  for (const [alias] of rows) {
    const name = `${prefix}:${alias}`;
    if (cursed.has(name)) continue;
    try {
      const outcome = await ground.adoptLaw(version, alias, {
        as: name,
        expect: "schema",
        manifest: "operator",
        resolvers: "withhold",
      });
      if (outcome.kind === "witnessed") witnessed.push(name);
      else bound.push(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missing = /^no surviving schema definition for (\S+)$/.exec(message);
      parked.push(
        `${name}: ${
          missing === null
            ? message
            : explainMissingDefinition(DeltaSet.from(members), missing[1]!, ground.validityNow())
        }`,
      );
    }
  }
  if (bound.length > 0) gw.replayRegistrations();
  return { bound, parked, witnessed };
}

const appIdentity = (r: RendererBinding): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.channel.app",
        r.route,
        JSON.stringify([...r.consumes]),
        r.bundle,
        JSON.stringify([...(r.writable ?? [])]),
        r.pen ?? "",
        r.versionId ?? "",
      ]
        .map((field) => `${new TextEncoder().encode(field).length}:${field}`)
        .join(""),
    ),
  );

function arrivedBindings(gw: Gateway, ground: Peer): RendererBinding[] {
  const operator = gw.operatorAuthor;
  if (operator === undefined) return [];
  return readForeignRenderers(ground.reactor, ground.validityNow(), [
    operator,
    ...ground.localAuthors(),
  ]);
}

function appsOf(
  gw: Gateway,
  ground: Peer,
  channel: string,
  prefix: string,
  siblings: readonly string[],
): ArrivedApp[] {
  const mounted = new Map(readPoolRenderers(ground, gw).map((r) => [r.route, r]));
  const hostRoutes = new Set(gw.renderers().map((r) => r.route));
  const poolWinner = new Map(ground.renderers().map((r) => [r.route, r]));
  const offeredBindings = new Map(arrivedBindings(gw, ground).map((r) => [r.route, r]));
  const offered = new Map([...offeredBindings].map(([route, r]) => [route, appIdentity(r)]));
  const rows: ArrivedApp[] = [];
  for (const route of new Set([...offered.keys(), ...mounted.keys()])) {
    const hash = offered.get(route);
    const own = mounted.get(route);
    const serves = `${prefix}:${route}`;
    const hostHolds = hostRoutes.has(serves);
    const claimedBy = siblings
      .filter(
        (p) =>
          p.length > prefix.length && serves.startsWith(`${p}:`) && serves.length > p.length + 1,
      )
      .sort((a, b) => b.length - a.length)[0];
    const poolHolds =
      poolWinner.get(route) !== undefined && poolWinner.get(route)!.deltaId !== own?.deltaId;
    const shadow = hostHolds
      ? `your own route "${serves}"`
      : claimedBy !== undefined
        ? `the channel prefixed "${claimedBy}:", whose namespace that name falls inside`
        : poolHolds
          ? `your own route "${route}", seeded into this pool`
          : undefined;
    const remedy =
      shadow === undefined
        ? undefined
        : claimedBy !== undefined
          ? `drop that channel, or re-open this one under a prefix its namespace does not contain`
          : "your own law wins its own names; this one answers when yours stops";
    const dark =
      own !== undefined &&
      shadow === undefined &&
      (!routeServableOn(ground, own, "full") || !resolves(ground, own.schemaName));
    const blocked =
      own === undefined && poolHolds && !hostHolds && claimedBy === undefined
        ? `your own route "${route}", seeded into this pool`
        : undefined;
    const serving =
      own === undefined || shadow !== undefined || dark ? undefined : appIdentity(own);
    const offeredHere = offeredBindings.get(route);
    const unmountable =
      offeredHere === undefined
        ? undefined
        : offeredHere.versionId !== undefined
          ? "it pins a version of the peer's OWN store, and this store does not hold that delta"
          : route === "" || route.includes("/") || route.includes("\u0000")
            ? `this store's publish door will not accept the route "${route}"`
            : undefined;
    rows.push({
      channel,
      route,
      serves,
      ...(unmountable === undefined ? {} : { unmountable }),
      ...(offeredBindings.get(route)?.pen === undefined
        ? {}
        : { wantsPen: offeredBindings.get(route)!.pen! }),
      ...(hash === undefined ? {} : { hash }),
      ...(own === undefined ? {} : { mounted: appIdentity(own) }),
      ...(serving === undefined ? {} : { serving }),
      ...(shadow === undefined || blocked !== undefined
        ? {}
        : { shadowed: shadow, ...(remedy === undefined ? {} : { remedy }) }),
      ...(blocked === undefined ? {} : { blocked }),
      ...(dark ? { dark: true as const } : {}),
      blessed: hash !== undefined && hash === serving,
    });
  }
  return rows.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

export function channelAppsImpl(gw: Gateway, channel?: string): ArrivedApp[] {
  const out: ArrivedApp[] = [];
  const prefixes = channelStatusImpl(gw).map((c) => c.prefix);
  for (const status of channelStatusImpl(gw, channel)) {
    const ground = gw.store.channels(gw).get(status.name)?.gateway;
    if (ground === undefined) continue;
    out.push(...appsOf(gw, ground, status.name, status.prefix, prefixes));
  }
  return out;
}

export async function blessChannelAppImpl(
  gw: Gateway,
  channel: string,
  route: string,
  opts: { pen?: boolean; supersede?: boolean; expect?: string } = {},
): Promise<void> {
  const status = channelStatusImpl(gw, channel)[0];
  const ground = gw.store.channels(gw).get(channel)?.gateway;
  if (status === undefined || ground === undefined) {
    throw new Error(
      `bless-app refused: this store holds no open channel named "${channel}" — ` +
        "`loam federate list` names the ones it has, and a severed channel is gone for good",
    );
  }
  const arrived = arrivedBindings(gw, ground);
  const app = arrived.find((r) => r.route === route);
  if (app === undefined) {
    throw new Error(
      `bless-app refused: "${channel}" has received no app at the route "${route}" — it offers ` +
        (arrived.length === 0
          ? "none yet, so there is nothing to mount"
          : arrived.map((r) => `"${r.route}"`).join(", ")),
    );
  }
  if (opts.expect !== undefined) {
    if (opts.expect.length < 20) {
      throw new Error(
        `bless-app refused: --expect "${opts.expect}" is too short to identify an app. Every id ` +
          "starts `1e20`, so a short pin is mostly that constant — paste the whole id `loam " +
          "federate list` prints. A pin a peer can grind past reads as a pin and is not one.",
      );
    }
    if (!appIdentity(app).startsWith(opts.expect)) {
      throw new Error(
        `bless-app refused: "${route}" on "${channel}" is ${appIdentity(app).slice(0, 28)} now, ` +
          `and you asked for ${opts.expect}. The peer changed it between the listing and this ` +
          "call. Nothing was blessed; re-read `loam federate list`.",
      );
    }
  }
  const twin = ground.renderers().find((r) => r.route === route);
  if (twin !== undefined && gw.reactor.get(twin.deltaId) !== undefined) {
    throw new Error(
      `bless-app refused: this pool holds a copy of YOUR OWN route "${route}", seeded from this ` +
        "store's ground — so the name is already answered in there by law of yours. A peer's app " +
        "cannot take it. Rename your own route, or ask the peer to publish theirs elsewhere.",
    );
  }
  const operator = ground.operatorAuthor;
  if (gw.signer === undefined || operator === undefined) {
    throw new Error("only an operated store may bless an app (a blessing is the operator's claim)");
  }
  const alias = `app:${route}`;
  const members = [...ground.reactor.snapshot()];
  const mine = readManifest(
    members.filter((d) => d.claims.author === operator),
    gw.validityNow(),
  );
  if (mine.find((r) => r.alias === alias)?.target !== app.deltaId) {
    await ground.exportManifestRows([{ alias, targetAddress: app.deltaId, kind: "renderer" }]);
  }
  const frozen = [...ground.reactor.snapshot()];
  const version = freezeMembers(frozen);
  const resolved = readManifest(
    frozen.filter((d) => d.claims.author === operator),
    gw.validityNow(),
  ).find((r) => r.alias === alias);
  if (resolved?.target !== app.deltaId) {
    throw new Error(
      `bless-app refused: this pool's manifest no longer names "${route}" as the binding the ` +
        `listing showed (delta ${app.deltaId.slice(0, 12)}…) — nothing was blessed. Re-read ` +
        "`loam federate list` and bless the app it names.",
    );
  }
  await ground.adoptLaw(version, alias, {
    expect: "renderer",
    dependencies: "refuse",
    manifest: "operator",
    ...(opts.pen === true ? { pen: true } : {}),
    ...(opts.supersede === true ? { supersede: true } : {}),
  });
}

export async function blessChannelResolversImpl(
  gw: Gateway,
  channel: string,
  lens: string,
): Promise<string> {
  const status = channelStatusImpl(gw, channel)[0];
  const ground = gw.store.channels(gw).get(channel)?.gateway;
  if (status === undefined || ground === undefined) {
    throw new Error(
      `bless-app refused: this store holds no open channel named "${channel}" — ` +
        "`loam federate list` names the ones it has",
    );
  }
  if (gw.signer === undefined || gw.operatorAuthor === undefined) {
    throw new Error("only an operated store may bless law (a blessing is the operator's claim)");
  }
  const served = lens.startsWith(`${status.prefix}:`) ? lens : `${status.prefix}:${lens}`;
  const alias = served.slice(status.prefix.length + 1);
  const withheld = withheldLenses(gw, ground, status.prefix);
  if (!withheld.includes(served)) {
    throw new Error(
      `bless-app refused: "${served}" on "${channel}" holds no withheld resolvers — ` +
        (withheld.length === 0
          ? "nothing on this channel is waiting on that act"
          : `these are: ${withheld.map((l) => `"${l}"`).join(", ")}`),
    );
  }
  const version = freezeMembers([...ground.reactor.snapshot()]);
  await ground.adoptLaw(version, alias, {
    as: served,
    expect: "schema",
    manifest: "operator",
    resolvers: "grant",
    supersede: true,
  });
  await ground.prepareRead({ reconcileLaw: true });
  gw.replayRegistrations();
  return served;
}

export function withheldLenses(gw: Gateway, ground: Peer, prefix: string): string[] {
  const out: string[] = [];
  for (const r of ground.registered) {
    const specs = r.resolvers;
    if (specs === undefined) continue;
    const name = lensOf(r);
    if (!name.startsWith(`${prefix}:`)) continue;
    if (Object.entries(specs).some(([field, spec]) => isWithheldResolver(spec.code, name, field))) {
      out.push(name);
    }
  }
  return out.sort();
}

function resolves(ground: Peer, lens: string): boolean {
  try {
    ground.surface("full")?.hooks.resolve(lens, "loam:probe-no-such-entity", undefined);
    return true;
  } catch {
    return false;
  }
}

export async function attachChannelPool(gw: Gateway, name: string): Promise<Container> {
  const backend = gw.options.channelBackend?.(name);
  let pool: Container;
  try {
    pool = await gw.openContainer({
      name,
      channelPool: true,
      ...(backend === undefined ? {} : { backend }),
    });
  } catch (err) {
    await backend?.close().catch(() => {});
    throw err;
  }
  return pool;
}

function manifestAliasOf(claims: { pointers: readonly unknown[] }): string | undefined {
  const ps = claims.pointers as readonly {
    role: string;
    target: { kind: string; value?: unknown; entity?: { id: string; context: string } };
  }[];
  const isRow = ps.some(
    (p) => p.target.kind === "entity" && p.target.entity?.context === CTX_MANIFEST,
  );
  if (!isRow) return undefined;
  const alias = ps.find((p) => p.role === "alias");
  return alias?.target.kind === "primitive" ? String(alias.target.value) : undefined;
}

function channelNameOf(gw: Gateway, prefix: string): string {
  return channelStatusImpl(gw).find((c) => c.prefix === prefix)?.name ?? "";
}

function standingPrefixes(gw: Gateway): {
  standing: { channel: string; prefix: string }[];
  unresolved: string[];
} {
  const recorded = new Map(channelStatusImpl(gw).map((c) => [c.name, c.prefix]));
  const standing: { channel: string; prefix: string }[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const [name, rec] of readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor)
    .containers) {
    if (!name.startsWith("channel:")) continue;
    const prefix = recorded.get(name) ?? declaredPrefix(name, rec.inboxOf);
    if (prefix !== undefined) standing.push({ channel: name, prefix });
    else if (rec.inboxOf === undefined) continue;
    else unresolved.push(name);
    seen.add(name);
  }
  for (const [name, prefix] of recorded) {
    if (!seen.has(name)) standing.push({ channel: name, prefix });
  }
  return { standing, unresolved };
}

function declaredPrefix(name: string, inboxOf: string | undefined): string | undefined {
  if (inboxOf === undefined) return undefined;
  const lead = `channel:${inboxOf}:`;
  return name.startsWith(lead) ? name.slice(lead.length) : undefined;
}

export function channelBindingPrefix(gw: Gateway, status: ChannelStatus): string | undefined {
  if (!status.unreadable.includes("prefix")) return status.prefix;
  const parent = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(
    status.name,
  )?.inboxOf;
  const recordedParent = status.unreadable.includes("into") ? undefined : status.into;
  if (parent !== undefined && recordedParent !== undefined && parent !== recordedParent) {
    return undefined;
  }
  return declaredPrefix(status.name, parent ?? recordedParent);
}

export function prefixOfChannelName(name: string): string | undefined {
  if (!name.startsWith("channel:")) return undefined;
  const cut = name.indexOf(":", "channel:".length);
  return cut > 0 ? name.slice(cut + 1) : undefined;
}

async function syncChannel(
  gw: Gateway,
  pool: PeerEntry,
  declarationId: string | undefined,
  name: string,
  opts: OpenChannelOptions,
  incarnation?: LocalChannelOpening,
): Promise<SyncReport> {
  const ground = pool.gateway;
  let offered: readonly Delta[] = [],
    fault: unknown,
    failed = false;
  if (channelStatusImpl(gw, name)[0]?.receiving !== false) {
    try {
      offered = await opts.source.pull();
    } catch (err) {
      fault = err;
      failed = true;
    }
  }
  return withChannelCommit(gw, name, async () => {
    const current = channelStatusImpl(gw, name)[0];
    if (
      current === undefined ||
      ground === undefined ||
      gw.store.channels(gw).get(name) !== pool ||
      pool.declarationId !== declarationId ||
      currentPoolDeclaration(gw, name) !== declarationId ||
      !gw.store.holds(gw, ground) ||
      current.into !== opts.into ||
      current.prefix !== opts.prefix ||
      fromDisagrees(current.from, opts) ||
      current.openedBy !== opts.openedBy ||
      current.openedFrom !== opts.openedFrom
    )
      throw new Error(
        `stale channel operation ${name}: severed or changed association; re-open with loam federate open`,
      );
    const evidence = localChannelEvidence(gw, name);
    if (
      incarnation !== undefined &&
      (evidence.state !== "open" || evidence.opening.id !== incarnation.id)
    )
      throw new Error(`stale channel operation ${name}: protected opening changed or unavailable`);
    if (incarnation === undefined && evidence.state !== "legacy")
      throw new Error(`channel ${name}: no matching protected incarnation on handle`);
    return syncChannelCommit(
      gw,
      ground,
      name,
      {
        ...opts,
        source: {
          pull: () => {
            if (failed) throw fault;
            return Promise.resolve(offered);
          },
        },
      },
      incarnation,
    );
  });
}

async function syncChannelCommit(
  gw: Gateway,
  ground: Peer,
  name: string,
  opts: {
    into: string;
    prefix: string;
    from?: string;
    source: ChannelSource;
    bless?: boolean;
    openedBy?: string;
    openedFrom?: string;
  },
  incarnation?: LocalChannelOpening,
): Promise<SyncReport> {
  const before = channelStatusImpl(gw, name)[0];
  const illegible = before?.unreadable ?? [];
  const from = before?.from ?? opts.from ?? "";
  const owed = (before?.unattested ?? []).filter((id) => ground.reactor.get(id) !== undefined);
  if (before?.receiving === false) {
    return {
      offered: 0,
      accepted: 0,
      duplicates: 0,
      bound: [],
      parked: [],
      witnessed: [],
      apps: appsOf(
        gw,
        ground,
        name,
        opts.prefix,
        channelStatusImpl(gw).map((c) => c.prefix),
      ),
    };
  }
  let offered: readonly Delta[];
  try {
    offered = await opts.source.pull();
  } catch (err) {
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        ...opener(opts),
        receiving: before?.receiving ?? true,
        blessing: before?.blessing ?? opts.bless !== false,
        lastSyncedAt: before?.lastSyncedAt ?? 0,
        consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
        from,
        unattested: owed,
      },
      illegible,
      false,
    );
    throw err;
  }
  const pooled = new Set(
    offered.filter((d) => ground.reactor.get(d.id) !== undefined).map((d) => d.id),
  );
  const declared = [
    ...new Set([...owed, ...offered.map((d) => d.id).filter((id) => !pooled.has(id))]),
  ];
  if (declared.length > owed.length) {
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        ...opener(opts),
        receiving: before?.receiving ?? true,
        blessing: before?.blessing ?? opts.bless !== false,
        lastSyncedAt: before?.lastSyncedAt ?? 0,
        consecutiveFailures: before?.consecutiveFailures ?? 0,
        from,
        unattested: declared,
      },
      illegible.filter((r) => r !== "unattested"),
      false,
    );
  }
  const received =
    incarnation === undefined
      ? undefined
      : await receiveChannelOfferInCommit(gw, incarnation, offered);
  const report =
    received === undefined ? await ground.federate([...offered], { ids: true }) : received.report;
  if (received !== undefined && !received.ok) {
    try {
      if (received.missingAdmittedIds && report.accepted > 0 && report.acceptedIds === undefined)
        await attestArrival(gw, ground, name, from, report, owed);
      throw received.error;
    } catch (err) {
      await stamp(
        gw,
        {
          name,
          into: opts.into,
          prefix: opts.prefix,
          ...opener(opts),
          receiving: before?.receiving ?? true,
          blessing: before?.blessing ?? opts.bless !== false,
          lastSyncedAt: before?.lastSyncedAt ?? 0,
          consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
          from,
          unattested: [...new Set([...owed, ...(report.acceptedIds ?? [])])],
        },
        illegible,
        false,
      );
      throw err;
    }
  }
  const blessing = before?.blessing ?? opts.bless !== false;
  const { bound, parked, witnessed } = blessing
    ? await bindArrived(gw, ground, opts.prefix)
    : { bound: [] as string[], parked: [] as string[], witnessed: [] as string[] };
  try {
    await attestArrival(gw, ground, name, from, report, owed);
  } catch (err) {
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        ...opener(opts),
        receiving: before?.receiving ?? true,
        blessing,
        lastSyncedAt: before?.lastSyncedAt ?? 0,
        consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
        from,
        unattested: err instanceof UnattestedArrivals ? err.unattested : owed,
      },
      illegible,
      false,
    );
    throw err;
  }
  const quiet =
    report.accepted === 0 &&
    before !== undefined &&
    before.lastSyncedAt > 0 &&
    before.consecutiveFailures === 0 &&
    before.unattested.length === 0 &&
    declared.length === owed.length &&
    illegible.length === 0;
  if (quiet && channelLineageSevered(gw, name)) {
    throw new Error(
      `refused to stamp "${name}": it was severed and its channel record negated, so a ` +
        `stale handle cannot re-create it. Re-open it with \`loam federate open\` to receive on it ` +
        `again.`,
    );
  }
  if (!quiet) {
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        ...opener(opts),
        receiving: before?.receiving ?? true,
        blessing: before?.blessing ?? opts.bless !== false,
        lastSyncedAt: gw.now(),
        consecutiveFailures: 0,
        from,
        unattested: [],
      },
      illegible.filter(
        (r) => r !== "lastSyncedAt" && r !== "consecutiveFailures" && r !== "unattested",
      ),
      false,
    );
  }
  return {
    offered: report.offered,
    accepted: report.accepted,
    duplicates: report.offered - report.accepted,
    bound,
    parked,
    witnessed,
    apps: appsOf(
      gw,
      ground,
      name,
      opts.prefix,
      channelStatusImpl(gw).map((c) => c.prefix),
    ),
  };
}

export async function openChannelImpl(gw: Gateway, opts: OpenChannelOptions): Promise<Channel> {
  return withChannelCommit(gw, channelName(opts.into, opts.prefix), () =>
    openChannelCommit(gw, opts),
  );
}
async function openChannelCommit(gw: Gateway, opts: OpenChannelOptions): Promise<Channel> {
  if (gw.signer === undefined) {
    throw new Error(
      "openChannel: only an operated store can open a federation channel — the pool's declaration " +
        "is signed constitutional data (§46)",
    );
  }
  const name = channelName(opts.into, opts.prefix);

  const flattened = legalNameFor(opts.prefix);
  const prefixes = standingPrefixes(gw);
  if (prefixes.unresolved.length > 0) {
    throw new Error(
      `openChannel refused: this store declares ${prefixes.unresolved.length} channel pool(s) ` +
        `whose assigned prefix it cannot name. A pool's prefix is read from its channel record, ` +
        `or cut from its name against the parent its declaration marks; neither answers for these, ` +
        `so a collision check over the others would report a clean result it did not verify. The ` +
        `container listing names them: re-declare each with an \`inboxOf\` that leads its name, or ` +
        `drop it. Nothing was created.`,
    );
  }
  const claimed = prefixes.standing.find((s) => s.channel === name);
  for (const standing of prefixes.standing) {
    if (standing.channel === name) {
      if (standing.prefix === opts.prefix) continue;
      throw new Error(
        `openChannel refused: the pool "${name}" already belongs to the channel this store opened ` +
          `with the prefix "${standing.prefix}", and this call asks for "${opts.prefix}". A pool ` +
          `is named "channel:<into>:<prefix>" and a container name may carry colons, so two ` +
          `different (container, prefix) pairs can name one pool — resuming here would re-point ` +
          `the standing channel instead. Choose another receiving container or another prefix. ` +
          `Nothing was changed.`,
      );
    }
    if (legalNameFor(standing.prefix) === flattened) {
      throw new Error(
        claimed === undefined
          ? `openChannel refused: the prefix "${opts.prefix}" collides with the prefix ` +
              `"${standing.prefix}" already assigned by "${standing.channel}". A living name is ` +
              `"<prefix>:<alias>" and carries no container, so two channels sharing a prefix aim at ` +
              `the same names — and the door flattens every non-alphanumeric to "_", so near-misses ` +
              `collide too. Choose another prefix.`
          : `openChannel refused: "${name}" and "${standing.channel}" BOTH stand in this store, ` +
              `and their prefixes "${claimed.prefix}" and "${standing.prefix}" answer at one ` +
              `GraphQL field. A store opened before this check could reach that state, and while it ` +
              `holds, one peer's claims can answer a lens blessed from the other. Sever one of the ` +
              `two (\`loam federate drop\`) and re-open. Nothing was changed.`,
      );
    }
  }
  const standingBeforeOpen = channelStatusImpl(gw, name)[0];
  const priorPoolLifecycle =
    currentPoolDeclaration(gw, name) !== undefined || gw.store.channels(gw).has(name);
  if (
    standingBeforeOpen !== undefined &&
    (standingBeforeOpen.into !== opts.into ||
      standingBeforeOpen.prefix !== opts.prefix ||
      fromDisagrees(standingBeforeOpen.from, opts) ||
      standingBeforeOpen.openedBy !== opts.openedBy ||
      standingBeforeOpen.openedFrom !== opts.openedFrom)
  )
    throw new Error(
      `channel ${name} already stands with other options; re-open it with the options it ` +
        `stands with, or drop it before opening it another way`,
    );
  const existing = gw.federationChannels.get(name);
  if (existing !== undefined) return existing;

  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  if (danglingAncestor(table, opts.into) !== undefined) {
    throw new Error(
      `${opts.into} stands, but it hangs from a container that does not, so it is reachable ` +
        `from no page the person has — a channel cannot be opened there`,
    );
  }
  if (!table.containers.has(opts.into)) {
    if (opts.openedBy === undefined) {
      if (everDeclared(gw.reactor, gw.operatorAuthor, opts.into)) {
        throw new Error(
          `${opts.into} was declared and then dropped, so a channel cannot be opened into it — ` +
            `declaring it again would restore what the drop removed`,
        );
      }
      const missingHere: string[] = [];
      let up = opts.into;
      while (!table.containers.has(up) && up.includes(":")) {
        missingHere.push(up);
        up = up.slice(0, up.lastIndexOf(":"));
      }
      if (missingHere.length === 0 && !table.containers.has(up)) missingHere.push(up);
      const struckHere = [...missingHere, ...(table.containers.has(up) ? [] : [up])].find(
        (container) => everDeclared(gw.reactor, gw.operatorAuthor, container),
      );
      if (struckHere !== undefined) {
        throw new Error(
          `${struckHere} was declared and then dropped, so a channel cannot be opened there — ` +
            `declaring it again would restore what the drop removed`,
        );
      }
      if (table.containers.has(up) && danglingAncestor(table, up) !== undefined) {
        throw new Error(
          `${up} stands, but it hangs from a container that does not, so it is reachable from no ` +
            `page the person has — a channel cannot be opened beneath it`,
        );
      }
      const standing = new Set(table.containers.keys());
      await gw.append(
        missingHere.reverse().map((container) => {
          const parent = container.includes(":")
            ? container.slice(0, container.lastIndexOf(":"))
            : undefined;
          const spec = {
            container,
            trust: "curated" as const,
            posture: "shared" as const,
            membership: AGGREGATOR,
            ...(parent !== undefined && standing.has(parent) ? { parent } : {}),
          };
          standing.add(container);
          return gw.signer!.sign(
            withStamp(gw.stamp(), (t) => containerClaims(spec, gw.operatorAuthor!, t)),
          );
        }),
      );
    } else {
      const signer = gw.signer;
      const stop = opts.openedBy;
      const missing: string[] = [];
      let at = opts.into;
      while (at !== stop && !table.containers.has(at) && at.includes(":")) {
        missing.push(at);
        at = at.slice(0, at.lastIndexOf(":"));
      }
      const struck = missing.find((container) =>
        everDeclared(gw.reactor, gw.operatorAuthor, container),
      );
      if (struck !== undefined) {
        throw new Error(
          `${struck} was declared and then dropped, so a channel cannot be opened there — ` +
            `declaring it again would restore what the drop removed`,
        );
      }
      if (!table.containers.has(at)) {
        throw new Error(
          `${at} does not stand, so there is nothing for ${opts.into} to hang from — a channel ` +
            `cannot be opened there`,
        );
      }
      if (danglingAncestor(table, at) !== undefined) {
        throw new Error(
          `${at} stands, but it hangs from a container that does not, so a channel cannot be ` +
            `opened there`,
        );
      }
      await gw.append(
        missing.reverse().map((container) =>
          signer.sign(
            withStamp(gw.stamp(), (t) =>
              containerClaims(
                {
                  container,
                  trust: "curated",
                  posture: "shared",
                  membership: AGGREGATOR,
                  parent: container.slice(0, container.lastIndexOf(":")),
                },
                gw.operatorAuthor!,
                t,
              ),
            ),
          ),
        ),
      );
    }
  }

  if (standingBeforeOpen !== undefined) {
    const pool = gw.store.channels(gw).get(name) ?? (await attachChannelPool(gw, name));
    gw.store.setChannel(gw, name, pool);
    const state = localChannelEvidence(gw, name);
    const incarnation =
      state.state === "open" || state.state === "closed" ? state.opening : undefined;
    const declarationId = pool.declarationId;
    const resumed: Channel = {
      name,
      into: standingBeforeOpen.into,
      prefix: standingBeforeOpen.prefix,
      ...opener(standingBeforeOpen),
      pool,
      sync: () => syncChannel(gw, pool, declarationId, name, opts, incarnation),
    };
    gw.federationChannels.set(name, resumed);
    return resumed;
  }

  const poolDeclaration = gw.signer.sign(
    withStamp(gw.stamp(), (t) =>
      containerClaims(
        { container: name, trust: "untrusted", posture: "separate", inboxOf: opts.into },
        gw.operatorAuthor!,
        t,
      ),
    ),
  );
  await gw.append([poolDeclaration]);

  const pool = gw.store.channels(gw).get(name) ?? (await attachChannelPool(gw, name));
  const ground = pool.gateway;
  if (ground === undefined) {
    throw new Error(
      `openChannel: ${name} resolved without its own ground — a pool must be separate`,
    );
  }

  const statusAtOpen = await stamp(
    gw,
    {
      name,
      into: opts.into,
      prefix: opts.prefix,
      ...opener(opts),
      receiving: true,
      blessing: opts.bless !== false,
      ...opener(opts),
      lastSyncedAt: 0,
      consecutiveFailures: 0,
      from: opts.from ?? "",
      unattested: [],
    },
    [],
    true,
  );

  gw.store.setChannel(gw, name, pool);
  let incarnation: LocalChannelOpening | undefined;
  const eventText = (value: string | undefined, empty = false): boolean =>
    value !== undefined && (empty || value.length > 0) && !value.includes("\0");
  const protectedOpener =
    (opts.openedBy === undefined && opts.openedFrom === undefined) ||
    (eventText(opts.openedBy) && eventText(opts.openedFrom) && openerStands(gw, opts));
  if (
    !priorPoolLifecycle &&
    eventText(name) &&
    eventText(opts.into) &&
    eventText(opts.prefix) &&
    eventText(opts.from ?? "", true) &&
    protectedOpener
  ) {
    if (
      pool.declarationId !== poolDeclaration.id ||
      currentPoolDeclaration(gw, name) !== poolDeclaration.id ||
      !gw.store.holds(gw, ground)
    )
      throw new Error(`openChannel: ${name} changed its exact pool association during opening`);
    const event = await issueChannelEvent(gw, {
      action: "open",
      opening: {
        channel: name,
        into: opts.into,
        prefix: opts.prefix,
        from: opts.from ?? "",
        ...opener(opts),
        statusAtOpen,
        poolDeclaration: poolDeclaration.id,
      },
    });
    incarnation = {
      id: event.id,
      channel: name,
      into: opts.into,
      prefix: opts.prefix,
      from: opts.from ?? "",
      ...opener(opts),
      statusAtOpen,
      poolDeclaration: poolDeclaration.id,
    };
    const state = localChannelLifecycle(gw, name);
    if (state.state !== "open" || state.opening.id !== incarnation.id)
      throw new Error(`openChannel: ${name} changed its exact association during event issuance`);
  }
  const channel: Channel = {
    name,
    into: opts.into,
    prefix: opts.prefix,
    ...opener(opts),
    pool,
    sync: () => syncChannel(gw, pool, poolDeclaration.id, name, opts, incarnation),
  };

  gw.federationChannels.set(name, channel);
  gw.store.setChannel(gw, name, pool);
  return channel;
}

export async function dropChannelImpl(gw: Gateway, name: string): Promise<void> {
  return withChannelCommit(gw, name, () => dropChannelCommit(gw, name));
}
async function dropChannelCommit(gw: Gateway, name: string): Promise<void> {
  const statusGone = channelStatusImpl(gw, name).length === 0;
  const severed = channelsEverImpl(gw, name)[0];
  const standing = currentPoolDeclaration(gw, name);
  if (
    statusGone &&
    (severed === undefined || standing === undefined || orphanedDeclaration(gw, standing))
  ) {
    const attached = gw.store.channels(gw).get(name)?.gateway;
    const held =
      attached !== undefined && gw.store.holds(gw, attached) && attached.reactor.size !== 0;
    throw new Error(
      severed === undefined
        ? `dropChannel refused: this store has no channel named "${name}" — ` +
            `\`loam federate list\` names the ones it has.`
        : held
          ? `dropChannel refused: "${name}" reads severed (no status record, and no declaration ` +
            `a channel opening names), but a pool is still attached here under that name and ` +
            `holds bytes. Restart this store, open the channel again under the name, then drop it.`
          : `dropChannel refused: "${name}" was already severed, so there is nothing left to remove.`,
    );
  }

  const channel = gw.federationChannels.get(name);

  const attached = gw.store.channels(gw).get(name);
  if (channel === undefined && attached === undefined && gw.options.channelBackend === undefined) {
    throw new Error(
      `dropChannel refused: this store has no live handle on "${name}" and no channelBackend to ` +
        `re-open it with, so a purge here would run against an empty in-memory copy and report a ` +
        `completeness it never verified. Open the channel in this process first, or configure ` +
        `channelBackend. Nothing was removed.`,
    );
  }
  const cached = channel?.pool ?? attached;
  const stale =
    cached !== undefined && (cached.gateway === undefined || !gw.store.holds(gw, cached.gateway));
  if (stale) {
    gw.federationChannels.delete(name);
    gw.store.dropChannel(gw, name);
    if (gw.options.channelBackend === undefined)
      throw new Error(
        `dropChannel refused: the handle on "${name}" is stale (its pool is no longer attached) ` +
          `and this store has no channelBackend to re-open it with. Configure channelBackend and ` +
          `drop again. Nothing was removed.`,
      );
  }
  const pool = stale
    ? await attachChannelPool(gw, name)
    : (cached ?? (await attachChannelPool(gw, name)));
  gw.store.setChannel(gw, name, pool);
  if (pool.drop === undefined) {
    throw new Error(
      `dropChannel refused: ${name} has no drop — only a SEPARATE container purges its own bytes, ` +
        `and a channel pool that is not separate cannot be severed provably (§46)`,
    );
  }
  const evidence = localChannelLifecycle(gw, name);
  if (evidence.state === "open")
    await issueChannelEvent(gw, { action: "close", channel: name, opening: evidence.opening.id });
  else if (
    evidence.state === "unavailable" &&
    (statusGone ||
      evidence.reason === "attached pool declaration changed" ||
      (pool.declarationId !== undefined && orphanedDeclaration(gw, pool.declarationId)))
  )
    void 0;
  else if (evidence.state === "unavailable")
    throw new Error(`dropChannel refused: ${evidence.reason}`);
  await pool.drop();
  gw.federationChannels.delete(name);
  gw.store.dropChannel(gw, name);
  gw.replayRegistrations();

  if (gw.signer !== undefined) {
    const operator = gw.operatorAuthor!;
    const now = gw.validityNow();
    const severedForGood = (id: string): boolean =>
      gw.reactor.negationsOf(id).some((negId) => {
        const n = gw.reactor.get(negId);
        return (
          n !== undefined &&
          n.claims.author === operator &&
          n.claims.validUntil === undefined &&
          n.claims.validFrom <= now &&
          gw.reactor.negationsOf(negId).length === 0
        );
      });
    for (const d of [...lawfulHistory(gw.reactor, operator)]) {
      const marker = d.claims.pointers.find(
        (pt) => pt.target.kind === "entity" && pt.target.entity.context === CTX_CHANNEL,
      );
      if (marker === undefined || marker.target.kind !== "entity") continue;
      if (marker.target.entity.id !== `channel:${name}`) continue;
      if (severedForGood(d.id)) continue;
      await gw.append([
        gw.signer.sign(withStamp(gw.stamp(operator), (t) => makeNegationClaims(operator, t, d.id))),
      ]);
    }
  }
}

function channelLineageSevered(gw: Gateway, name: string): boolean {
  return channelStatusImpl(gw, name).length === 0 && channelsEverImpl(gw, name).length > 0;
}

async function stamp(
  gw: Gateway,
  status: Omit<ChannelStatus, "unreadable">,
  illegible: readonly string[],
  opening: boolean,
): Promise<string> {
  if (!opening && channelLineageSevered(gw, status.name)) {
    throw new Error(
      `refused to stamp "${status.name}": it was severed and its channel record negated, so a ` +
        `stale handle cannot re-create it. Re-open it with \`loam federate open\` to receive on it ` +
        `again.`,
    );
  }
  const claims = withStamp(gw.stamp(), (t) =>
    channelRecordClaims({ ...status, unreadable: [] }, gw.operatorAuthor!, t),
  );
  const delta = gw.signer!.sign(
    illegible.length === 0
      ? claims
      : { ...claims, pointers: claims.pointers.filter((p) => !illegible.includes(p.role)) },
  );
  await gw.append([delta]);
  return delta.id;
}

export async function setChannelImpl(
  gw: Gateway,
  name: string,
  next: { receiving?: boolean; blessing?: boolean },
): Promise<ChannelStatus> {
  const held = channelStatusImpl(gw, name)[0];
  if (held === undefined) {
    throw new Error(`setChannel refused: this store has no channel named "${name}"`);
  }
  const status: ChannelStatus = {
    ...held,
    ...(next.receiving === undefined ? {} : { receiving: next.receiving }),
    ...(next.blessing === undefined ? {} : { blessing: next.blessing }),
  };
  await stamp(
    gw,
    status,
    held.unreadable.filter(
      (r) =>
        !(r === "receiving" && next.receiving !== undefined) &&
        !(r === "blessing" && next.blessing !== undefined),
    ),
    false,
  );
  return channelStatusImpl(gw, name)[0] ?? status;
}

export interface StandingSync {
  stop(): Promise<void>;
}

export function keepSyncingImpl(gw: Gateway, opts: { everyMs?: number } = {}): StandingSync {
  const everyMs = Math.max(20, opts.everyMs ?? 60_000);
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    const records = new Map(gw.channelStatus().map((s) => [s.name, s]));
    const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
    for (const channel of [...gw.federationChannels.values()]) {
      const record = records.get(channel.name);
      if (record === undefined || !openerStands(gw, record)) continue;
      if (record.openedBy !== undefined && !receivesNow(table, record.into)) continue;
      if (stopped) return;
      try {
        await channel.sync();
      } catch {}
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    running = running.then(tick);
  }, everyMs);
  timer.unref?.();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

export const CTX_CURSE = "loam.channel.curse";

export async function curseChannelLawImpl(
  gw: Gateway,
  channel: string,
  living: string,
  opts: { lift?: boolean } = {},
): Promise<void> {
  if (gw.signer === undefined) {
    throw new Error("curseChannelLaw: only an operated store may retire law it blessed (§46)");
  }
  const standing = channelStatusImpl(gw, channel)[0];
  if (standing === undefined) {
    throw new Error(`curseChannelLaw refused: this store has no channel named "${channel}"`);
  }

  if (opts.lift === true) {
    const liftPool = gw.store.channels(gw).get(channel)?.gateway;
    if (liftPool === undefined || !gw.store.holds(gw, liftPool)) {
      throw new Error(
        `curseChannelLaw refused: the pool of "${channel}" is not attached here, and a lift acts ` +
          `only in that pool. Open the channel again, then lift. Nothing was changed.`,
      );
    }
    for (const g of [liftPool]) {
      const lifted = negatedAt(g.reactor, g.validityNow(), undefined);
      for (const binding of [...g.reactor.snapshot()]) {
        if (!isRegistrationBinding(binding.claims)) continue;
        const p = binding.claims.pointers.find((pt) => pt.role === "schema");
        const lens =
          p?.target.kind === "entity" && p.target.entity.id.startsWith("schema:")
            ? p.target.entity.id.slice("schema:".length)
            : undefined;
        if (lens !== living) continue;
        for (const negationId of g.reactor.negationsOf(binding.id)) {
          if (lifted(negationId)) continue;
          await g.strike([negationId]);
        }
      }
    }
    await replayEverywhere(gw);
    for (const d of cursesOf(gw, channel)) {
      if (d.living !== living) continue;
      await gw.append([
        gw.signer.sign(
          withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, d.deltaId)),
        ),
      ]);
    }
    return;
  }

  const alreadyCursed = cursesOf(gw, channel).some((c) => c.living === living);

  const livesAt = (d: Delta): string | undefined => {
    const p = d.claims.pointers.find((pt) => pt.role === "schema");
    if (p?.target.kind !== "entity") return undefined;
    const id = p.target.entity.id;
    return id.startsWith("schema:") ? id.slice("schema:".length) : id;
  };
  const pool = gw.store.channels(gw).get(channel)?.gateway;
  if (pool === undefined || !gw.store.holds(gw, pool)) {
    throw new Error(
      `curseChannelLaw refused: the pool of "${channel}" is not attached here, and a curse acts ` +
        `only in that pool. Open the channel again, then curse. Nothing was negated and nothing ` +
        `was recorded.`,
    );
  }
  const grounds = [
    {
      reactor: pool.reactor,
      now: pool.validityNow(),
      governor: pool.operatorAuthor!,
      sign: (id: string): Promise<void> => pool.strike([id]),
    },
  ];
  const bindings: { id: string; sign: (id: string) => Promise<void> }[] = [];
  for (const g of grounds) {
    const struckHere = negatedAt(g.reactor, g.now, g.governor);
    for (const d of g.reactor.snapshot()) {
      if (!isRegistrationBinding(d.claims)) continue;
      if (livesAt(d) !== living) continue;
      if (struckHere(d.id)) continue;
      bindings.push({ id: d.id, sign: g.sign });
    }
  }
  if (bindings.length === 0 && !alreadyCursed) {
    throw new Error(
      `curseChannelLaw refused: "${living}" is not served by this store, so there is nothing to ` +
        `retire. Nothing was negated and nothing was recorded.`,
    );
  }

  await gw.append([
    gw.signer.sign({
      ...gw.stamp(),
      author: gw.operatorAuthor!,
      pointers: [
        {
          role: "curse",
          target: { kind: "entity", entity: { id: `channel:${channel}`, context: CTX_CURSE } },
        },
        { role: "living", target: { kind: "primitive", value: living } },
      ],
    }),
  ]);
  for (const binding of bindings) {
    await binding.sign(binding.id);
  }
  await replayEverywhere(gw);

  const poolServes = pool.registered.some((r) => lensOf(r) === living);
  const rootServes = gw.registered.some((r) => r.channel === channel && lensOf(r) === living);
  if (poolServes || rootServes) {
    throw new Error(
      `curseChannelLaw refused: negated ${bindings.length} binding(s) for "${living}" and the lens ` +
        `is STILL SERVED. Something else binds that name — the curse is recorded, so the standing ` +
        `sync will not re-bless it, but this store is still answering the name now.`,
    );
  }
}

async function replayEverywhere(gw: Gateway): Promise<void> {
  for (const pool of gw.store.channels(gw).values())
    await pool.gateway?.prepareRead({ reconcileLaw: true });
  gw.replayRegistrations();
}

export function cursesOf(gw: Gateway, channel: string): { living: string; deltaId: string }[] {
  const operator = gw.operatorAuthor;
  const negated = negatedAt(gw.reactor, gw.validityNow(), operator);
  const out: { living: string; deltaId: string }[] = [];
  for (const d of lawfulSnapshot(gw.reactor, gw.validityNow(), operator)) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CURSE,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (marker.target.entity.id !== `channel:${channel}`) continue;
    if (negated(d.id)) continue;
    const living = d.claims.pointers.find((p) => p.role === "living");
    if (living?.target.kind === "primitive") {
      out.push({ living: String(living.target.value), deltaId: d.id });
    }
  }
  return out;
}

export function sourceFor(
  from: string,
  token: string | undefined,
  readOffer: (path: string) => string,
  parseOffer: (raw: string) => Delta[],
): ChannelSource {
  const isUrl = /^https?:\/\//i.test(from);
  if (!isUrl) {
    return { pull: () => Promise.resolve(parseOffer(readOffer(from))) };
  }
  return {
    pull: async () => {
      const res = await fetch(`${from}/federate`, {
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          connection: "close",
        },
      });
      if (!res.ok) {
        throw new Error(
          `the peer answered ${res.status} at ${from}/federate` +
            (res.status === 403
              ? " — federation wants the peer's operator token today; a container-scoped offer " +
                "token is T188's loam_federate_offer, which waits on where a credential lives (T196)"
              : ""),
        );
      }
      return parseOffer(await res.text());
    },
  };
}

export function resumeChannelImpl(gw: Gateway, standing: ChannelStatus, token: string): Channel {
  const evidence = localChannelEvidence(gw, standing.name);
  const incarnation =
    evidence.state === "open" || evidence.state === "closed" ? evidence.opening : undefined;
  const poolOf = (): PeerEntry => {
    const held = gw.store.channels(gw).get(standing.name);
    if (held === undefined) {
      throw new Error(
        `${standing.name} is not attached in this process, so its bytes are unreadable — the ` +
          `channel record stands and the pool did not open`,
      );
    }
    return held;
  };
  const pool = poolOf();
  const declarationId = pool.declarationId;
  const opts = {
    into: standing.into,
    prefix: standing.prefix,
    ...opener(standing),
    from: standing.from,
    source: sourceFor(
      standing.from,
      token,
      () => {
        throw new Error("a resumed channel pulls from its recorded address, never a file");
      },
      parseOffer,
    ),
  };
  return {
    name: standing.name,
    into: standing.into,
    prefix: standing.prefix,
    ...opener(standing),
    get pool(): PeerEntry {
      return poolOf();
    },
    sync: () => syncChannel(gw, pool, declarationId, standing.name, opts, incarnation),
  };
}
