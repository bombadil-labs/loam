import {
  DeltaSet,
  HYPER_SCHEMA_SCHEMA,
  SCHEMA_SCHEMA,
  contentAddress,
  evalTerm,
  loadHyperSchema,
  loadSchema,
  termCanonicalHex,
  type Claims,
  type Delta,
  type HyperSchema,
  type Reactor,
  type Schema,
} from "@bombadil/rhizomatic";
import { ADOPTION_ENTITY, CTX_ADOPTION, isAdoption } from "./adopt.js";
import { bytesRefOf } from "./bytes.js";
import { CTX_CONTAINER } from "./container-law.js";
import type { ModuleVersion } from "./container-identity.js";
import type { Gateway } from "./gateway.js";
import { publishRegistrationImpl } from "./lifecycle.js";
import {
  lensOf,
  parseClaimTemplates,
  parseResolvers,
  versionedSchemaHash,
  type ClaimTemplates,
  type LensName,
  type ResolverSpecs,
  type ResolverSpec,
} from "./registration.js";
import { lawfulHistory, lawfulScopeAt, lawfulSnapshot } from "./lawful.js";
import { negatedAt } from "./negation.js";
import { CTX_RENDERER, publishRendererImpl } from "./renderers.js";
import {
  survivalOver,
  type ManifestRow,
  readManifest,
  byAge,
  entityOf,
  primitiveOf,
  NUL,
  withheldResolverCode,
  isRegistrationBinding,
  explainMissingDefinition,
} from "./adopt-vocab.js";

const ROLE_HS_DEFINES = "rhizomatic.hyperschema.defines";
const ROLE_SCHEMA_DEFINES = "rhizomatic.schema.defines";

const schemaLawAddress = (hyperschema: HyperSchema, schema: Schema): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.law.schema",
        hyperschema.name,
        String(hyperschema.alg ?? 1),
        termCanonicalHex(hyperschema.body),
        versionedSchemaHash(schema),
      ].join(NUL),
    ),
  );

const rendererLawAddress = (b: {
  route: string;
  schemaName: string;
  consumes: readonly string[];
  bundle: string;
  writable?: readonly string[];
  pen?: string;
}): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.law.renderer",
        b.route,
        b.schemaName,
        JSON.stringify([...b.consumes]),
        b.bundle,
        JSON.stringify([...(b.writable ?? [])]),
        b.pen ?? "",
      ].join(NUL),
    ),
  );

interface SchemaExport {
  readonly kind: "schema";
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly lensName: LensName;
  readonly schemaEntity: string;
  readonly mutations?: ClaimTemplates;
  readonly writable?: readonly string[];
  readonly resolvers?: ResolverSpecs;
  readonly timestamps: readonly number[];
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly address: string;
  readonly lineage: readonly string[];
}

interface RendererExport {
  readonly kind: "renderer";
  readonly route: string;
  readonly schemaName: LensName;
  readonly consumes: readonly string[];
  readonly bundle: string;
  readonly writable?: readonly string[];
  readonly pen?: string;
  readonly timestamp: number;
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly address: string;
  readonly lineage: readonly string[];
}

interface FactExport {
  readonly kind: "fact";
  readonly what: string;
}

type Export = SchemaExport | RendererExport | FactExport;

const jsonList = (claims: Claims, role: string): string[] | undefined => {
  const raw = primitiveOf(claims, role);
  if (typeof raw !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) return parsed;
  } catch {
    return undefined;
  }
  return undefined;
};

const carriesBytes = (members: readonly Delta[], ref: string): boolean =>
  members.some((d) =>
    d.claims.pointers.some((p) => p.target.kind === "bytes" && bytesRefOf(p.target.value) === ref),
  );

const isRendererBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.context === CTX_RENDERER &&
      p.target.entity.id.startsWith("renderer:"),
  );

interface Source {
  readonly version: ModuleVersion;
  readonly members: readonly Delta[];
  readonly survives: (id: string) => boolean;
  readonly livesAtSource: (id: string) => boolean;
  readonly dset: DeltaSet;
  readonly container?: string;
  readonly from: string;
  readonly now: number;
}

function classify(src: Source, row: ManifestRow): Export {
  const struck = (what: string, id: string): never => {
    throw new Error(
      `adoption refused: "${row.alias}" names ${what} its own author RETRACTED inside the ` +
        `module (${id} is negated in this version's members) — a blessing must not re-speak law ` +
        `its author took back. Survival, not presence, at the source (§24.4).`,
    );
  };

  if (row.by === "address") {
    const target = src.members.find((d) => d.id === row.target);
    if (target === undefined) {
      if (carriesBytes(src.members, row.target)) {
        return { kind: "fact", what: `the byte-blob ${row.target.slice(0, 12)}…` };
      }
      throw new Error(
        `adoption refused: manifest row "${row.alias}" names ${row.target}, which resolves to ` +
          `nothing in this module version — a stranger's manifest gets no silent skips`,
      );
    }
    if (!src.survives(target.id)) struck("an export", target.id);
    if (isRendererBinding(target.claims)) return rendererExport(row, target);
    if (isRegistrationBinding(target.claims)) {
      throw new Error(
        `adoption refused: manifest row "${row.alias}" names a registration BINDING by address ` +
          `(${row.target}) — schema law is named by its hyperschema ENTITY, the identifier that ` +
          `survives a republish (§27.8)`,
      );
    }
    return { kind: "fact", what: `the byte/fact delta ${row.target}` };
  }

  const definitions = src.members.filter((d) => entityOf(d.claims, ROLE_HS_DEFINES) === row.target);
  if (definitions.length > 0) {
    const live = definitions.filter((d) => src.survives(d.id));
    if (live.length === 0) struck("a hyperschema definition", definitions[0]!.id);
    return schemaExport(src, row, live, src.now);
  }
  const mentioned = src.members.some((d) =>
    d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.id === row.target),
  );
  if (!mentioned) {
    throw new Error(
      `adoption refused: manifest row "${row.alias}" names the entity ${row.target}, which this ` +
        `module version says nothing about — a stranger's manifest gets no silent skips`,
    );
  }
  return { kind: "fact", what: `the entity ${row.target}` };
}

function rendererExport(row: ManifestRow, target: Delta): RendererExport {
  const claims = target.claims;
  const route = primitiveOf(claims, "route");
  const schemaName = primitiveOf(claims, "schema");
  const bundle = primitiveOf(claims, "bundle");
  if (typeof route !== "string" || typeof schemaName !== "string" || typeof bundle !== "string") {
    throw new Error(
      `adoption refused: manifest row "${row.alias}" names ${target.id}, a renderer binding ` +
        `missing its route, schema, or bundle — malformed law binds nothing anywhere, and it is ` +
        `named here rather than skipped`,
    );
  }
  if (primitiveOf(claims, "versionId") !== undefined) {
    throw new Error(
      `adoption refused: the renderer at "${row.alias}" pins a §17 registration VERSION of the ` +
        `module's own store (${String(primitiveOf(claims, "versionId"))}), a delta id this store ` +
        `does not hold — the pin would go dark here. Adopt the schema, then publish the renderer ` +
        `against this store's own version.`,
    );
  }
  const writable = jsonList(claims, "writable");
  const penRaw = primitiveOf(claims, "pen");
  const pen = typeof penRaw === "string" && penRaw !== "" ? penRaw : undefined;
  const writeReady = writable !== undefined && writable.length > 0 && pen !== undefined;
  const core = {
    route,
    schemaName: schemaName as LensName,
    consumes: jsonList(claims, "consumes") ?? [],
    bundle,
    ...(writeReady ? { writable: writable as readonly string[], pen } : {}),
  };
  return {
    kind: "renderer",
    ...core,
    timestamp: claims.timestamp,
    sourceDelta: target.id,
    producedBy: claims.author,
    address: rendererLawAddress(core),
    lineage: [target.id],
  };
}

function schemaExport(
  src: Source,
  row: ManifestRow,
  definitions: readonly Delta[],
  now: number,
): SchemaExport {
  const definition = [...definitions]
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1)!;
  const bindings = src.members.filter(
    (d) => isRegistrationBinding(d.claims) && entityOf(d.claims, "hyperschema") === row.target,
  );
  if (bindings.length === 0) {
    throw new Error(
      `adoption refused: "${row.alias}" names the hyperschema ${row.target}, which this module ` +
        `defines but never REGISTERS — there is no resolution program to bless (a definition ` +
        `alone resolves nothing, §21)`,
    );
  }
  const live = bindings.filter((d) => src.survives(d.id));
  if (live.length === 0) {
    throw new Error(
      `adoption refused: "${row.alias}" names law whose registration its own author RETRACTED ` +
        `inside the module (${bindings[0]!.id} is negated in this version's members) — a blessing ` +
        `must not re-speak law its author took back`,
    );
  }
  const aliased = live.filter((d) => {
    const p = d.claims.pointers.find((pt) => pt.role === "schema");
    return p?.target.kind === "entity" && p.target.entity.id === `schema:${row.alias}`;
  });
  const binding = [...(aliased.length > 0 ? aliased : live)]
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1)!;
  const livingEntity = entityOf(binding.claims, "schema");
  const snapshotEntity = entityOf(binding.claims, "schemaVersion");
  const rootsJson = primitiveOf(binding.claims, "roots");
  if (livingEntity === undefined || snapshotEntity === undefined || typeof rootsJson !== "string") {
    throw new Error(
      `adoption refused: the registration binding at "${row.alias}" (${binding.id}) names no ` +
        `living Schema, snapshot, or roots — malformed law, named rather than skipped`,
    );
  }
  const hyperschema = loadHyperSchema(src.dset, row.target, now);
  const schema = loadSchema(src.dset, snapshotEntity, now);
  const roots = JSON.parse(rootsJson) as string[];
  const mutationsJson = primitiveOf(binding.claims, "mutations");
  const resolversJson = primitiveOf(binding.claims, "resolvers");
  const mutations =
    typeof mutationsJson === "string"
      ? parseClaimTemplates(JSON.parse(mutationsJson) as unknown)
      : undefined;
  const resolvers =
    typeof resolversJson === "string"
      ? parseResolvers(JSON.parse(resolversJson) as unknown)
      : undefined;
  const writable = jsonList(binding.claims, "writable");
  const livingDelta = latestAt(src, ROLE_SCHEMA_DEFINES, livingEntity);
  const snapshotDelta = latestAt(src, ROLE_SCHEMA_DEFINES, snapshotEntity);
  return {
    kind: "schema",
    hyperschema,
    schema,
    roots,
    lensName: (livingEntity.startsWith("schema:")
      ? livingEntity.slice("schema:".length)
      : livingEntity) as LensName,
    schemaEntity: row.target,
    ...(mutations === undefined ? {} : { mutations }),
    ...(writable === undefined ? {} : { writable }),
    ...(resolvers === undefined ? {} : { resolvers }),
    timestamps: [
      definition.claims.timestamp,
      livingDelta?.claims.timestamp ?? binding.claims.timestamp,
      snapshotDelta?.claims.timestamp ?? binding.claims.timestamp,
      binding.claims.timestamp,
    ],
    sourceDelta: binding.id,
    producedBy: binding.claims.author,
    address: schemaLawAddress(hyperschema, schema),
    lineage: [definition.id, livingDelta?.id, snapshotDelta?.id, binding.id].filter(
      (id): id is string => id !== undefined,
    ),
  };
}

const latestAt = (src: Source, role: string, entity: string): Delta | undefined =>
  [...src.members]
    .filter((d) => entityOf(d.claims, role) === entity && src.survives(d.id))
    .sort((a, b) =>
      byAge(
        { timestamp: a.claims.timestamp, deltaId: a.id },
        { timestamp: b.claims.timestamp, deltaId: b.id },
      ),
    )
    .at(-1);

function containerOf(gw: Gateway, version: ModuleVersion): string | undefined {
  const hits: string[] = [];
  for (const [entity, pool] of gw.store.namedPools(gw)) {
    if (!gw.store.hasPool(gw, pool)) continue;
    if (version.members.every((d) => pool.reactor.get(d.id) !== undefined)) hits.push(entity);
  }
  hits.sort();
  return hits[0];
}

function strikeIndex(members: readonly Delta[]): {
  counted: Set<string>;
  aboutAMember: Set<string>;
} {
  const byId = new Map(members.map((d) => [d.id, d]));
  const counted = new Set<string>();
  const aboutAMember = new Set<string>();
  for (const d of members) {
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = byId.get(p.target.deltaRef.delta);
      if (target === undefined) continue;
      aboutAMember.add(d.id);
      if (target.claims.author === d.claims.author) counted.add(d.id);
    }
  }
  return { counted, aboutAMember };
}

function operandSet(
  members: readonly Delta[],
  lives: (id: string) => boolean,
  reading: "blessing" | "exposure",
): DeltaSet {
  const { counted, aboutAMember } = strikeIndex(members);
  return DeltaSet.from(
    members.filter((d) => {
      if (reading === "exposure") return !aboutAMember.has(d.id);
      if (!lives(d.id)) return false;
      return !aboutAMember.has(d.id) || counted.has(d.id);
    }),
  );
}

function sourceOf(
  gw: Gateway,
  version: ModuleVersion,
  reading: "blessing" | "exposure" = "blessing",
): Source {
  const now = gw.validityNow();
  const livesAtSource = survivalOver(version.members, now);
  const container = containerOf(gw, version);
  return {
    now,
    version,
    members: version.members,
    survives: reading === "blessing" ? livesAtSource : () => true,
    livesAtSource,
    dset: operandSet(version.members, livesAtSource, reading),
    ...(container === undefined ? {} : { container }),
    from: container ?? "quarantine",
  };
}

export interface LawAdoption {
  readonly kind: "adopted-from" | "witnessed";
  readonly from: string;
  readonly alias: string;
  readonly moduleVersion: string;
  readonly target: string;
  readonly lawAddress: string;
  readonly adoptedDelta: string;
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly at: number;
}

const ROLE_RECORD_KIND = "record-kind";

interface RecordSpec {
  readonly kind: "adopted-from" | "witnessed";
  readonly from: string;
  readonly container?: string;
  readonly alias: string;
  readonly moduleVersion: string;
  readonly target: string;
  readonly lawAddress: string;
  readonly adoptedDelta: string;
  readonly sourceDelta: string;
  readonly producedBy: string;
}

function lawAdoptionRecordClaims(spec: RecordSpec, operator: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author: operator,
    pointers: [
      {
        role: "adopts",
        target: { kind: "entity", entity: { id: ADOPTION_ENTITY, context: CTX_ADOPTION } },
      },
      { role: "adopted", target: { kind: "delta", deltaRef: { delta: spec.adoptedDelta } } },
      { role: "adopted-from", target: { kind: "primitive", value: spec.from } },
      { role: "source-delta", target: { kind: "primitive", value: spec.sourceDelta } },
      { role: "produced-by", target: { kind: "primitive", value: spec.producedBy } },
      { role: "adopted-by", target: { kind: "primitive", value: operator } },
      { role: "at", target: { kind: "primitive", value: timestamp } },
      { role: ROLE_RECORD_KIND, target: { kind: "primitive", value: spec.kind } },
      { role: "alias", target: { kind: "primitive", value: spec.alias } },
      { role: "module-version", target: { kind: "primitive", value: spec.moduleVersion } },
      { role: "export-target", target: { kind: "primitive", value: spec.target } },
      { role: "law-address", target: { kind: "primitive", value: spec.lawAddress } },
      ...(spec.container === undefined
        ? []
        : [
            {
              role: "from-container" as const,
              target: {
                kind: "entity" as const,
                entity: { id: spec.container, context: CTX_CONTAINER },
              },
            },
          ]),
    ],
  };
}

export function readLawAdoptions(
  reactor: Reactor,
  now: number,
  operator: string,
  opts?: { includeStruck?: boolean },
): LawAdoption[] {
  const negated = negatedAt(reactor, now, operator);
  const out: LawAdoption[] = [];
  const records =
    opts?.includeStruck === true
      ? lawfulHistory(reactor, operator)
      : lawfulSnapshot(reactor, now, operator);
  for (const d of records) {
    if (!isAdoption(d.claims)) continue;
    if (opts?.includeStruck !== true && negated(d.id)) continue;
    const kind = primitiveOf(d.claims, ROLE_RECORD_KIND);
    if (kind !== "adopted-from" && kind !== "witnessed") continue;
    const adoptedPtr = d.claims.pointers.find((p) => p.role === "adopted");
    const adoptedDelta =
      adoptedPtr?.target.kind === "delta" ? adoptedPtr.target.deltaRef.delta : undefined;
    const from = primitiveOf(d.claims, "adopted-from");
    const alias = primitiveOf(d.claims, "alias");
    const moduleVersion = primitiveOf(d.claims, "module-version");
    const target = primitiveOf(d.claims, "export-target");
    const lawAddress = primitiveOf(d.claims, "law-address");
    const sourceDelta = primitiveOf(d.claims, "source-delta");
    const producedBy = primitiveOf(d.claims, "produced-by");
    const at = primitiveOf(d.claims, "at");
    if (
      adoptedDelta === undefined ||
      typeof from !== "string" ||
      typeof alias !== "string" ||
      typeof moduleVersion !== "string" ||
      typeof target !== "string" ||
      typeof lawAddress !== "string" ||
      typeof sourceDelta !== "string" ||
      typeof producedBy !== "string" ||
      at === undefined
    ) {
      continue;
    }
    out.push({
      kind,
      from,
      alias,
      moduleVersion,
      target,
      lawAddress,
      adoptedDelta,
      sourceDelta,
      producedBy,
      at: Number(at),
    });
  }
  return out;
}

export function withLivingNames<T>(gw: Gateway, body: () => Promise<T>): Promise<T> {
  const run = gw.livingNames.then(body);
  gw.livingNames = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface AdoptLawOptions {
  readonly supersede?: boolean;
  readonly as?: string;
  readonly pen?: boolean;
  readonly repoints?: Readonly<Record<string, string>>;

  readonly expect?: "schema" | "renderer";

  readonly dependencies?: "refuse";

  readonly manifest?: "operator";

  readonly resolvers?: "withhold" | "grant";
}

export interface AdoptionOutcome {
  readonly alias: string;
  readonly kind: "adopted-from" | "witnessed";
  readonly landed: readonly string[];
  readonly notes: string[];
}

export interface BlessAllOptions {
  readonly pen?: boolean;
  readonly repoints?: Readonly<Record<string, string>>;
}

export interface BlessAllReport {
  readonly blessed: string[];
  readonly witnessed: string[];
  readonly refused: string[];
  readonly notes: string[];
}

interface Winner {
  readonly address: string;
  readonly deltaId: string;
}

const schemaWinner = (gw: Gateway, lens: string): Winner | undefined => {
  const versions = gw.registrationVersions().filter((v) => lensOf(v) === lens);
  const winner = versions.at(-1);
  if (winner === undefined) return undefined;
  return {
    address: schemaLawAddress(winner.hyperschema, winner.schema),
    deltaId: winner.deltaId,
  };
};

const routeWinner = (gw: Gateway, route: string): Winner | undefined => {
  const held = gw.renderers().find((r) => r.route === route);
  if (held === undefined) return undefined;
  return { address: rendererLawAddress(held), deltaId: held.deltaId };
};

function boundElsewhere(
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  requestedName?: string,
): Winner | undefined {
  if (ex.kind === "schema") {
    for (const v of gw.registrationVersions()) {
      if (schemaLawAddress(v.hyperschema, v.schema) !== ex.address) continue;
      if (requestedName !== undefined && lensOf(v) !== requestedName) continue;
      return { address: ex.address, deltaId: v.deltaId };
    }
    return undefined;
  }
  for (const r of gw.renderers()) {
    if (rendererLawAddress(r) === ex.address) {
      return { address: ex.address, deltaId: r.deltaId };
    }
  }
  return undefined;
}

function entityCaptureRefusal(gw: Gateway, ex: SchemaExport): string | undefined {
  const held = boundHyperschemaAt(gw, ex.schemaEntity);
  if (held === undefined || hyperschemaAddress(held) === hyperschemaAddress(ex.hyperschema)) {
    return undefined;
  }
  return (
    `the export names the hyperschema entity ${ex.schemaEntity}, which this store's own lawful ` +
    `ground already defines as "${held.name}" with a DIFFERENT gather body — blessing it would ` +
    `land operator-signed bytes at the operator's own definition entity, and §21's latest-wins ` +
    `would let the module's timestamp decide which body every lens filed there resolves through. ` +
    `A module may not name one of your entities. Have the shipper publish at their own ` +
    `(\`hyperschema:<Name>\` of a name you do not use), or republish your own program yourself.`
  );
}

function boundHyperschemaAt(gw: Gateway, entity: string): HyperSchema | undefined {
  const definition = lawfulScopeAt(gw.reactor, gw.validityNow(), entity, gw.operatorAuthor);
  try {
    return loadHyperSchema(definition, entity, gw.validityNow());
  } catch {
    return undefined;
  }
}

const hyperschemaAddress = (hs: HyperSchema): string =>
  contentAddress(
    new TextEncoder().encode(
      ["loam.law.hyperschema", hs.name, String(hs.alg ?? 1), termCanonicalHex(hs.body)].join(NUL),
    ),
  );

const livingNameOf = (ex: SchemaExport | RendererExport, opts: AdoptLawOptions): string =>
  ex.kind === "schema" ? (opts.as ?? ex.lensName) : ex.route;

const winnerOf = (
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  name: string,
): Winner | undefined => (ex.kind === "schema" ? schemaWinner(gw, name) : routeWinner(gw, name));

export async function adoptLawImpl(
  gw: Gateway,
  version: ModuleVersion,
  alias: string,
  opts: AdoptLawOptions = {},
): Promise<AdoptionOutcome> {
  const src = sourceOf(gw, version);
  const rows = manifestRowsFor(gw, src, opts);
  const row = rows.find((r) => r.alias === alias);
  if (row === undefined) {
    throw new Error(
      `adoption refused: this module version lists no export named "${alias}" — its manifest ` +
        `offers ${rows.length === 0 ? "nothing" : rows.map((r) => `"${r.alias}"`).join(", ")}`,
    );
  }
  const ex = classify(src, row);
  if (ex.kind === "fact") {
    throw new Error(
      `adoption refused: "${alias}" is ${ex.what} — a FACT, and this module exports no law at ` +
        `that alias. Facts bind nothing and need no blessing: they read where they are and cross ` +
        `by promote-outputs (§24.3).`,
    );
  }
  if (opts.expect !== undefined && ex.kind !== opts.expect) {
    throw new Error(
      `adoption refused: "${alias}" names ${ex.kind} law, and this caller asked for ` +
        `${opts.expect} law. Blessing a NAME and mounting CODE THAT RUNS are different grants ` +
        `(§24.6) — an alias a peer chose may not turn one act into the other.`,
    );
  }
  return adoptOne(gw, src, row, ex, opts);
}

async function adoptOne(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  given: SchemaExport | RendererExport,
  opts: AdoptLawOptions,
): Promise<AdoptionOutcome> {
  if (gw.signer === undefined || gw.operatorAuthor === undefined) {
    throw new Error(
      "only an operated store may adopt law (a blessing is the operator's own claim)",
    );
  }
  const notes: string[] = [...skewNotes(gw, src, row)];
  const verdict: LensVerdict =
    given.kind === "renderer"
      ? resolveRendererLens(gw, src, row, given, opts, notes)
      : { kind: "unknown" };
  const ex = verdict.kind === "resolved" ? verdict.ex : given;
  const unblessed = verdict.kind === "unblessed" ? verdict.dependency : undefined;

  if (ex.kind === "renderer" && ex.pen !== undefined && opts.pen !== true) {
    throw new Error(
      `adoption refused: the renderer "${row.alias}" holds a PEN (${ex.pen}) — blessing code that ` +
        `can write needs its own deliberate flag ({ pen: true }), never an implicit ride. ` +
        `Blessing still confers no write standing: the pen must be granted and provisioned ` +
        `separately (§6's two keys).`,
    );
  }

  if (ex.kind === "schema") {
    const capture = entityCaptureRefusal(gw, ex);
    if (capture !== undefined) throw new Error(`adoption refused: ${capture}`);
  }

  const already = opts.resolvers === "grant" ? undefined : boundElsewhere(gw, ex, opts.as);
  if (already !== undefined) {
    const landed = await record(gw, src, row, ex, "witnessed", already.deltaId);
    return { alias: row.alias, kind: "witnessed", landed, notes };
  }

  if (ex.kind === "renderer" && verdict.kind === "unknown" && opts.dependencies === "refuse") {
    throw new Error(
      `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", and this ` +
        `module carries no definition of it — so nothing here can say WHOSE reading that name ` +
        `means. A law of that name may well be served; matching on the name would mount this app ` +
        `over it. Bless the schema it reads first, from the same source.`,
    );
  }

  if (
    ex.kind === "renderer" &&
    (unblessed !== undefined || !gw.registered.some((r) => lensOf(r) === ex.schemaName))
  ) {
    const dependency = unblessed;
    if (dependency === undefined) {
      throw new Error(
        `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", which ` +
          `this store does not serve and this module does not export — bless the schema it reads ` +
          `first, or register your own`,
      );
    }
    if (opts.dependencies === "refuse") {
      throw new Error(
        `adoption refused: the renderer "${row.alias}" reads the lens "${ex.schemaName}", which ` +
          `this store does not serve — bless the schema it reads first. This caller blesses one ` +
          `export at a time, so nothing binds a name the operator did not ask for.`,
      );
    }
    const inherited: AdoptLawOptions = {
      ...(opts.pen === undefined ? {} : { pen: opts.pen }),
      ...(opts.repoints === undefined ? {} : { repoints: opts.repoints }),
    };
    await adoptOne(gw, src, dependency.row, dependency.ex, inherited);
    notes.push(
      `blessed the schema export "${dependency.row.alias}" first — the renderer "${row.alias}" ` +
        `reads the lens "${ex.schemaName}", and a renderer over an unserved lens mounts nothing`,
    );
  }

  const name = livingNameOf(ex, opts);
  const confirmed = opts.repoints?.[row.alias] === row.target;
  const mayTake = opts.supersede === true || confirmed;

  const observed = await withLivingNames(gw, () => {
    const held = winnerOf(gw, ex, name);
    if (held !== undefined && held.address !== ex.address && !mayTake) {
      throw new Error(
        `adoption refused: ${ex.kind === "schema" ? `the name "${name}"` : `the route "${name}"`} ` +
          `is already answered here by DIFFERENT-content law (${held.deltaId}) — a blessing must ` +
          `not silently re-point an existing reading. Bless it with { supersede: true } to take ` +
          `the name (reversibly), or { as: "<OtherName>" } to serve both side by side.`,
      );
    }
    return Promise.resolve(held);
  });

  await gw.adoptionHold?.();

  const landed = await withLivingNames(gw, async () => {
    const held = winnerOf(gw, ex, name);
    if (held?.address !== observed?.address) {
      throw new Error(
        `adoption refused: the WINNER of ${ex.kind === "schema" ? `"${name}"` : `route "${name}"`} ` +
          `MOVED between this blessing's name-check and its append (${
            observed?.deltaId ?? "nothing was bound"
          } → ${held?.deltaId ?? "nothing is bound"}) — another door took the name. Nothing was ` +
          `published; re-read the winner and bless again.`,
      );
    }
    const takesName =
      held !== undefined && (held.address !== ex.address || opts.resolvers === "grant");
    const negates = takesName ? [held.deltaId] : [];
    return publish(gw, ex, opts, negates);
  });

  const provenance = await record(gw, src, row, ex, "adopted-from", landed[0] ?? ex.sourceDelta);
  return { alias: row.alias, kind: "adopted-from", landed: [...landed, ...provenance], notes };
}

function withheldResolvers(
  specs: ResolverSpecs | undefined,
  lens: string,
): ResolverSpecs | undefined {
  if (specs === undefined) return undefined;
  const out: Record<string, ResolverSpec> = {};
  for (const [field, spec] of Object.entries(specs)) {
    out[field] = { rung: spec.rung, type: spec.type, code: withheldResolverCode(lens, field) };
  }
  return out;
}

function manifestRowsFor(gw: Gateway, src: Source, opts: AdoptLawOptions): ManifestRow[] {
  if (opts.manifest !== "operator") return readManifest(src.members, src.now);
  return readManifest(
    src.members.filter((d) => d.claims.author === gw.operatorAuthor),
    src.now,
  );
}

type LensVerdict =
  | { readonly kind: "resolved"; readonly ex: RendererExport }
  | { readonly kind: "unblessed"; readonly dependency: { row: ManifestRow; ex: SchemaExport } }
  | { readonly kind: "unknown" };

function resolveRendererLens(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: RendererExport,
  opts: AdoptLawOptions,
  notes: string[],
): LensVerdict {
  const dependency = dependencyRow(gw, src, ex.schemaName, opts);
  if (dependency === undefined) return { kind: "unknown" };
  const served = gw.registered.find(
    (r) => schemaLawAddress(r.hyperschema, r.schema) === dependency.ex.address,
  );
  if (served === undefined) return { kind: "unblessed", dependency };
  const under = lensOf(served);
  if (under === ex.schemaName) return { kind: "resolved", ex };
  notes.push(
    `the renderer "${row.alias}" reads the peer's lens "${ex.schemaName}", which this store serves ` +
      `as "${under}" — the binding names the reading THIS store answers`,
  );
  const core = { ...ex, schemaName: under };
  return { kind: "resolved", ex: { ...core, address: rendererLawAddress(core) } };
}

function dependencyRow(
  gw: Gateway,
  src: Source,
  lens: string,
  opts: AdoptLawOptions,
): { row: ManifestRow; ex: SchemaExport } | undefined {
  for (const candidate of manifestRowsFor(gw, src, opts)) {
    let ex: Export;
    try {
      ex = classify(src, candidate);
    } catch {
      continue;
    }
    if (ex.kind === "schema" && ex.lensName === lens) return { row: candidate, ex };
  }
  return undefined;
}

async function publish(
  gw: Gateway,
  ex: SchemaExport | RendererExport,
  opts: AdoptLawOptions,
  negates: readonly string[],
): Promise<string[]> {
  if (ex.kind === "schema") {
    const lens = opts.as ?? ex.lensName;
    const resolvers =
      opts.resolvers === "withhold" ? withheldResolvers(ex.resolvers, lens) : ex.resolvers;
    let tick = 0;
    const clock = (): number => ex.timestamps[Math.min(tick++, ex.timestamps.length - 1)]!;
    const outcome = await publishRegistrationImpl(
      gw,
      ex.hyperschema,
      { ...ex.schema, name: lens, alg: ex.schema.alg ?? 1 },
      ex.roots,
      undefined,
      ex.schemaEntity,
      ex.mutations,
      ex.writable,
      resolvers,
      undefined,
      { clock, negates },
    );
    if (!outcome.bound) {
      throw new Error(
        `adoption refused: the blessed law for "${lens}" persisted but does not serve — ${
          outcome.reason ?? "the store did not re-derive it"
        }`,
      );
    }
    const winner = schemaWinner(gw, lens);
    if (winner?.address !== ex.address) {
      throw new Error(
        `adoption refused after the append: "${lens}" persisted, but this store now binds ` +
          `DIFFERENT law there (${winner === undefined ? "nothing binds" : winner.deltaId}) — the ` +
          `blessed definition did not win its entity ${ex.schemaEntity}, so the blessing would be ` +
          `a provenance record over law that is not serving. The deltas persist (the ground is ` +
          `append-only); no adoption was recorded. Resolve the entity conflict and bless again.`,
      );
    }
    return [winner.deltaId];
  }
  await publishRendererImpl(
    gw,
    {
      route: ex.route,
      schemaName: ex.schemaName,
      consumes: [...ex.consumes],
      bundle: ex.bundle,
      ...(ex.writable === undefined ? {} : { writable: [...ex.writable] }),
      ...(ex.pen === undefined ? {} : { pen: ex.pen }),
    },
    undefined,
    { timestamp: ex.timestamp, negates },
  );
  const winner = routeWinner(gw, ex.route);
  if (winner?.address !== ex.address) {
    throw new Error(
      `adoption refused after the append: the renderer at route "${ex.route}" persisted, but this ` +
        `store now serves DIFFERENT law there (${
          winner === undefined ? "nothing binds" : winner.deltaId
        }) — no adoption was recorded over law that is not serving.`,
    );
  }
  return [winner.deltaId];
}

async function record(
  gw: Gateway,
  src: Source,
  row: ManifestRow,
  ex: SchemaExport | RendererExport,
  kind: "adopted-from" | "witnessed",
  adoptedDelta: string,
): Promise<string[]> {
  const held = readLawAdoptions(gw.reactor, gw.validityNow(), gw.operatorAuthor!, {
    includeStruck: true,
  }).some(
    (r) =>
      r.moduleVersion === src.version.id && r.alias === row.alias && r.lawAddress === ex.address,
  );
  if (held) return [];
  const delta = gw.signer!.sign(
    lawAdoptionRecordClaims(
      {
        kind,
        from: src.from,
        ...(src.container === undefined ? {} : { container: src.container }),
        alias: row.alias,
        moduleVersion: src.version.id,
        target: row.target,
        lawAddress: ex.address,
        adoptedDelta,
        sourceDelta: ex.sourceDelta,
        producedBy: ex.producedBy,
      },
      gw.operatorAuthor!,
      row.timestamp,
    ),
  );
  await gw.append([delta]);
  return [delta.id];
}

function skewNotes(gw: Gateway, src: Source, row: ManifestRow): string[] {
  const others = new Set<string>();
  for (const rec of readLawAdoptions(gw.reactor, gw.validityNow(), gw.operatorAuthor!)) {
    if (rec.from !== src.from || rec.alias === row.alias) continue;
    if (rec.moduleVersion !== src.version.id) others.add(rec.moduleVersion);
  }
  if (others.size === 0) return [];
  return [
    `version skew: sibling law of "${src.from}" is bound from module version ` +
      `${[...others].sort().join(", ")}, while this blessing names ${src.version.id} — mixed ` +
      `versions are lawful; silently mixed ones are how a wrong-winner resolution gets blamed on ` +
      `an author who never shipped that combination`,
  ];
}

interface Planned {
  readonly row: ManifestRow;
  readonly ex: SchemaExport | RendererExport;
}

export async function blessAllImpl(
  gw: Gateway,
  version: ModuleVersion,
  opts: BlessAllOptions = {},
): Promise<BlessAllReport> {
  const src = sourceOf(gw, version);
  const rows = readManifest(src.members, src.now);
  const notes: string[] = [];
  const refused: string[] = [];
  const witnessed: string[] = [];
  const plan: Planned[] = [];
  const pens: string[] = [];
  const captures: string[] = [];
  const collisions: string[] = [];
  let lawRows = 0;
  const trail = readLawAdoptions(gw.reactor, gw.validityNow(), gw.operatorAuthor!);

  for (const row of rows) {
    const ex = classify(src, row);
    if (ex.kind === "fact") {
      notes.push(
        `"${row.alias}" is ${ex.what} — a fact, passed over: facts bind nothing and need no ` +
          `blessing (§27.8)`,
      );
      continue;
    }
    lawRows += 1;
    if (ex.kind === "renderer" && ex.pen !== undefined && opts.pen !== true) {
      pens.push(`"${row.alias}" (route ${ex.route}, pen ${ex.pen})`);
      continue;
    }
    if (ex.kind === "schema") {
      const capture = entityCaptureRefusal(gw, ex);
      if (capture !== undefined) {
        captures.push(`"${row.alias}": ${capture}`);
        continue;
      }
    }
    const repointed = trail.find(
      (r) => r.from === src.from && r.alias === row.alias && r.target !== row.target,
    );
    if (repointed !== undefined && opts.repoints?.[row.alias] !== row.target) {
      refused.push(
        `"${row.alias}" was RE-POINTED: it was blessed at ${repointed.target} and this manifest ` +
          `names ${row.target} — confirm it explicitly ({ repoints: { "${row.alias}": ` +
          `"${row.target}" } }) or bless it singly. An alias carries the reputation; the swap ` +
          `inherits it.`,
      );
      continue;
    }
    if (boundElsewhere(gw, ex) !== undefined) {
      witnessed.push(row.alias);
      continue;
    }
    const name = livingNameOf(ex, {});
    const confirmed = opts.repoints?.[row.alias] === row.target;
    const held = winnerOf(gw, ex, name);
    if (held !== undefined && held.address !== ex.address && !confirmed) {
      collisions.push(
        `"${row.alias}" would take ${ex.kind === "schema" ? `the name "${name}"` : `the route "${name}"`} ` +
          `from different-content law already bound here (${held.deltaId})`,
      );
      continue;
    }
    plan.push({ row, ex });
  }

  if (pens.length > 0) {
    throw new Error(
      `blessAll refused: ${pens.join(", ")} hold a PEN — a write-capable renderer never rides the ` +
        `bulk gesture. Re-run with { pen: true } once you mean it, or bless the rest singly. ` +
        `Nothing was blessed.`,
    );
  }
  if (captures.length > 0) {
    throw new Error(
      `blessAll refused: ${captures.join("; ")} NOTHING was blessed — an entity capture is not a ` +
        `per-row decision the operator can confirm away.`,
    );
  }
  if (collisions.length > 0) {
    throw new Error(
      `blessAll refused: ${collisions.join("; ")} — a collision is a per-row DECISION ` +
        `(supersede vs as), and decisions do not ride bulk gestures. Resolve the named row(s) ` +
        `singly and re-run; idempotence makes the re-run cheap. NOTHING was blessed.`,
    );
  }
  if (lawRows === 0) {
    throw new Error(
      `blessAll refused: this module version exports no law — every manifest row is a fact, and ` +
        `facts bind nothing (they read where they are, and cross by promote-outputs)`,
    );
  }

  plan.sort((a, b) => rank(a.ex) - rank(b.ex) || (a.row.alias < b.row.alias ? -1 : 1));
  const blessed: string[] = [];
  for (const { row, ex } of plan) {
    if (boundElsewhere(gw, ex) !== undefined) {
      witnessed.push(row.alias);
      continue;
    }
    try {
      const outcome = await adoptOne(gw, src, row, ex, {
        pen: opts.pen ?? false,
        ...(opts.repoints === undefined ? {} : { repoints: opts.repoints }),
      });
      notes.push(...outcome.notes);
      if (outcome.kind === "witnessed") witnessed.push(row.alias);
      else blessed.push(row.alias);
    } catch (err) {
      throw new Error(
        `blessAll refused the remainder at "${row.alias}": ${
          err instanceof Error ? err.message : String(err)
        } — LANDED: ${blessed.length === 0 ? "nothing" : blessed.join(", ")}. Re-run to bless the ` +
          `rest; what landed witnesses silently.`,
        { cause: err },
      );
    }
  }
  for (const row of rows) {
    if (!witnessed.includes(row.alias)) continue;
    const ex = classify(src, row);
    if (ex.kind === "fact") continue;
    const held = boundElsewhere(gw, ex);
    if (held !== undefined) await record(gw, src, row, ex, "witnessed", held.deltaId);
  }
  return { blessed, witnessed: [...new Set(witnessed)], refused, notes };
}

const rank = (ex: SchemaExport | RendererExport): number => (ex.kind === "schema" ? 0 : 1);

export interface LawFromRow {
  readonly alias?: string;
  readonly address: string;
  readonly kind: "schema" | "renderer";
  readonly versions: readonly string[];

  readonly withdrawnAtSource?: boolean;
}

export function lawFromImpl(gw: Gateway, versions: readonly ModuleVersion[]): LawFromRow[] {
  const out = new Map<string, { row: LawFromRow; versions: Set<string> }>();
  for (const version of versions) {
    const src = sourceOf(gw, version, "exposure");
    for (const row of readManifest(src.members, src.now)) {
      let ex: Export;
      try {
        ex = classify(src, row);
      } catch {
        continue;
      }
      if (ex.kind === "fact") continue;
      if (boundElsewhere(gw, ex) === undefined) continue;
      const withdrawn = ex.lineage.some((id) => !src.livesAtSource(id));
      const key = [ex.kind, ex.address, row.alias].join(NUL);
      const held = out.get(key);
      if (held === undefined) {
        out.set(key, {
          row: {
            alias: row.alias,
            address: ex.address,
            kind: ex.kind,
            versions: [],
            ...(withdrawn ? { withdrawnAtSource: true } : {}),
          },
          versions: new Set([version.id]),
        });
      } else {
        held.versions.add(version.id);
        if (withdrawn) held.row = { ...held.row, withdrawnAtSource: true };
      }
    }
  }
  return [...out.values()].map((e) => ({ ...e.row, versions: [...e.versions].sort() }));
}

export interface ExactReceivedSchema {
  readonly registration: string;
  readonly lens: string;
  readonly entity: string;
  readonly author: string;
  readonly hyperschema: HyperSchema;
  readonly schema: Schema;
  readonly roots: readonly string[];
  readonly lineage: readonly string[];
}

export function sameSchemaLaw(
  left: Pick<ExactReceivedSchema, "hyperschema" | "schema">,
  right: { readonly hyperschema: HyperSchema; readonly schema: Schema },
): boolean {
  return (
    schemaLawAddress(left.hyperschema, left.schema) ===
    schemaLawAddress(right.hyperschema, right.schema)
  );
}

interface ExactBinding {
  readonly id: string;
  readonly author: string;
  readonly timestamp: number;
  readonly entity: string;
  readonly living: string;
  readonly snapshot: string;
  readonly roots: readonly string[];
}

function exactBinding(d: Delta): ExactBinding | undefined {
  if (!isRegistrationBinding(d.claims)) return undefined;
  const one = (role: string): Claims["pointers"][number]["target"] | undefined => {
    const hits = d.claims.pointers.filter((p) => p.role === role);
    return hits.length === 1 ? hits[0]!.target : undefined;
  };
  const entity = one("hyperschema");
  const living = one("schema");
  const snapshot = one("schemaVersion");
  const roots = one("roots");
  if (
    entity?.kind !== "entity" ||
    living?.kind !== "entity" ||
    snapshot?.kind !== "entity" ||
    roots?.kind !== "primitive" ||
    typeof roots.value !== "string"
  )
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(roots.value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === "string")) return undefined;
  return {
    id: d.id,
    author: d.claims.author,
    timestamp: d.claims.timestamp,
    entity: entity.entity.id,
    living: living.entity.id,
    snapshot: snapshot.entity.id,
    roots: parsed,
  };
}

function definitionWinner(
  dset: DeltaSet,
  bootstrap: HyperSchema,
  entity: string,
  now: number,
): Delta {
  const result = evalTerm(bootstrap.body, dset, now, entity);
  if (result.sort !== "hview") throw new Error("bootstrap body must yield an HView");
  const defs = result.hview.props.get("definition") ?? [];
  const latest = [...defs].sort((a, b) => {
    const dt = b.delta.claims.timestamp - a.delta.claims.timestamp;
    if (dt !== 0) return dt;
    return a.delta.id < b.delta.id ? -1 : 1;
  })[0];
  if (latest === undefined) throw new Error(explainMissingDefinition(dset, entity, now));
  return latest.delta;
}

export function classifyExactReceivedSchema(
  received: readonly Delta[],
  lens: string,
  registration: string,
  now: number,
): ExactReceivedSchema {
  const survives = survivalOver(received, now);
  const named = received.find((d) => d.id === registration);
  if (named === undefined)
    throw new Error(`registration ${registration} is not among the received`);
  if (!survives(named.id))
    throw new Error(`registration ${registration} was retracted by its author`);
  const binding = exactBinding(named);
  if (binding === undefined)
    throw new Error(`registration ${registration} is not a well-formed binding`);
  const siblings = received
    .filter((d) => survives(d.id))
    .map(exactBinding)
    .filter((b): b is ExactBinding => b !== undefined && b.living === `schema:${lens}`);
  const entities = new Set(siblings.map((b) => b.entity));
  if (entities.size > 1)
    throw new Error(
      `schema:${lens} is claimed by ${entities.size} hyperschema entities among the received`,
    );
  const current = [...siblings]
    .sort((a, b) =>
      byAge({ timestamp: a.timestamp, deltaId: a.id }, { timestamp: b.timestamp, deltaId: b.id }),
    )
    .at(-1);
  if (current === undefined || current.id !== binding.id)
    throw new Error(
      `registration ${registration} is not the current binding of schema:${lens}` +
        (current === undefined ? "" : ` (${current.id} is)`),
    );
  const dset = operandSet(received, survives, "blessing");
  const definition = definitionWinner(dset, HYPER_SCHEMA_SCHEMA, binding.entity, now);
  const snapshot = definitionWinner(dset, SCHEMA_SCHEMA, binding.snapshot, now);
  const hyperschema = loadHyperSchema(dset, binding.entity, now);
  const schema = loadSchema(dset, binding.snapshot, now);
  return Object.freeze({
    registration: binding.id,
    lens,
    entity: binding.entity,
    author: binding.author,
    hyperschema,
    schema,
    roots: Object.freeze([...binding.roots]),
    lineage: Object.freeze([...new Set([binding.id, definition.id, snapshot.id])]),
  });
}
