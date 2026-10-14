// The portable batch read (SPEC-16 M2, through the published package): Loam testifies to one
// frozen PRIMARY source, the package endpoint gathers then resolves it, and Loam decodes the
// receiver-signed answer. This module builds the signed descriptions and runs one attempt; it
// decides nothing about which reads take it (that is the classifier's job) and never falls back.
//
// In this trial one key plays receiver, caller and capturer: the peer's own signer.

import {
  array,
  bstr,
  canonicalBytes,
  contentAddress,
  decodeHViewEnvelope,
  encode,
  encodeMaterializationLimits,
  float,
  map,
  MATERIALIZATION_MAX_LIMITS,
  MaterializationEndpoint,
  preflightMaterializationInput,
  materializationDescriptionClaims,
  readMaterializationDescription,
  readMaterializationResult,
  serializeCommandDelta,
  tstr,
  type CborValue,
  type Delta,
  type HView,
  type MaterializationDescriptionKind,
  type MaterializationSourceCapability,
  type Target,
  type View,
} from "@bombadil/rhizomatic";
import type { Signer } from "./signer.js";

const PREFIX = "rhizomatic.materialization.";
type Fields = Record<string, readonly Target[]>;
const p = (value: string | number): Target => ({ kind: "primitive", value });
const ent = (id: string): Target => ({ kind: "entity", entity: { id } });
const ref = (id: string): Target => ({ kind: "delta", deltaRef: { delta: id } });
const blob = (value: Uint8Array): Target => ({ kind: "bytes", mime: "application/cbor", value });
const digest = (ids: readonly string[]): string =>
  contentAddress(encode(array([...ids].sort().map(tstr))));
const byId = (a: Delta, b: Delta): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function describe(
  signer: Signer,
  at: number,
  kind: MaterializationDescriptionKind,
  fields: Fields,
): Delta {
  return signer.sign(materializationDescriptionClaims(signer.author, at, kind, fields));
}

// Runs in the browser bundle too, so no Node Buffer.
const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (x) => parseInt(x, 16));

/** The full signed appearance the source snapshot and the envelope both carry. */
function appearance(d: Delta): Uint8Array {
  if (d.sig === undefined) throw new Error(`portable read: ${d.id} is unsigned`);
  return encode(
    map([
      ["id", tstr(d.id)],
      ["claims", bstr(canonicalBytes(d.claims))],
      ["sig", bstr(hexBytes(d.sig))],
    ]),
  );
}

/** The boot descriptions of one peer's batch endpoint: gather and resolve, one PRIMARY binding. */
export interface PortableBoot {
  readonly configuration: Delta;
  readonly declarations: readonly Delta[];
  readonly binding: Delta;
  readonly authority: Delta;
}

const SELECTION = map([
  ["profile", tstr("host-authorized-snapshot/1")],
  ["parameters", bstr(encode(map([])))],
]);

export function portableBoot(signer: Signer, at = 0): PortableBoot {
  const authorityRoot = contentAddress(encode(tstr(`loam-primary-authority:${signer.author}`)));
  const declarations = ["gather", "resolve"].map((verb) =>
    describe(signer, at, "operation/1", {
      name: [ent(PREFIX + verb)],
      interpreter: [p(`${PREFIX}${verb}/1`)],
      "input-contract": [p(`${PREFIX}${verb}/1`)],
      "output-contract": [p(`${PREFIX}outcome/1`)],
      effect: [p("none")],
      replay: [p("re-evaluate/1")],
      dependencies: [p("explicit-support/1")],
    }),
  );
  const binding = describe(signer, at, "source-binding/1", {
    receiver: [ent(signer.author)],
    spec: [
      blob(
        encode(
          map([
            ["sourceId", tstr("primary")],
            ["capturer", tstr(signer.author)],
            ["authorityRoot", tstr(authorityRoot)],
            ["selection", SELECTION],
          ]),
        ),
      ),
    ],
  });
  const authority = describe(signer, at, "authority/1", {
    "source-binding": [ref(binding.id)],
    spec: [
      blob(
        encode(
          map([
            ["root", tstr(authorityRoot)],
            ["epoch", float(1)],
            ["context", bstr(encode(map([])))],
          ]),
        ),
      ),
    ],
  });
  const configuration = describe(signer, at, "endpoint/1", {
    receiver: [ent(signer.author)],
    caller: [p(signer.author)],
    administrator: [p(signer.author)],
    installed: declarations.map((d) => ref(d.id)),
    "source-binding": [ref(binding.id)],
    limits: [blob(encodeMaterializationLimits(MATERIALIZATION_MAX_LIMITS))],
  });
  return { configuration, declarations, binding, authority };
}

/** One frozen source: the whole authorized PRIMARY ground at one observation, as signed testimony. */
export interface PortableSource {
  readonly capture: Delta;
  readonly snapshot: Delta;
  readonly revision: string;
}

export function portableSource(
  signer: Signer,
  boot: PortableBoot,
  deltas: readonly Delta[],
  observation: number,
  historicalCutoff?: number,
): PortableSource {
  const sorted = [...deltas].sort(byId);
  const originals = sorted.map((d) => {
    const bytes = appearance(d);
    return { d, bytes, key: contentAddress(bytes) };
  });
  const ids = sorted.map((d) => d.id);
  const component = map([
    ["peer", tstr(signer.author)],
    ["revision", tstr(digest(ids))],
    ["capturedAt", float(observation)],
    ["rawIds", array(ids.map(tstr))],
    ["operandIds", array(ids.map(tstr))],
  ]);
  const membership = digest(ids),
    appearanceDigest = digest(originals.map((o) => o.key)),
    selection = contentAddress(encode(SELECTION));
  const withoutCapturedAt = (c: CborValue): CborValue =>
    c.t === "map" ? map(c.v.filter(([k]) => k !== "capturedAt")) : c;
  const revision = contentAddress(
    encode(
      map([
        ["binding", tstr(boot.binding.id)],
        ["authority", tstr(boot.authority.id)],
        ["selection", tstr(selection)],
        ["components", array([withoutCapturedAt(component)])],
        ["membership", tstr(membership)],
        ["appearanceDigest", tstr(appearanceDigest)],
        ["exclusions", array([])],
      ]),
    ),
  );
  const common: (readonly [string, CborValue])[] = [
    ["binding", tstr(boot.binding.id)],
    ["authority", tstr(boot.authority.id)],
    ["selection", tstr(selection)],
    ["revision", tstr(revision)],
    ["servingAt", float(observation)],
    ...(historicalCutoff === undefined
      ? []
      : [["historicalCutoff", float(historicalCutoff)] as const]),
    ["components", array([component])],
    [
      "operands",
      array(
        originals.map((o) =>
          map([
            ["id", tstr(o.d.id)],
            ["appearance", tstr(o.key)],
            ["peers", array([tstr(signer.author)])],
          ]),
        ),
      ),
    ],
    ["exclusions", array([])],
    ["membership", tstr(membership)],
    ["appearanceDigest", tstr(appearanceDigest)],
  ];
  const payload = encode(
    map([
      ["format", tstr("rhizomatic.source-snapshot/1")],
      ...common,
      [
        "appearances",
        array(
          [...originals]
            .sort((a, b) => (a.key < b.key ? -1 : 1))
            .map((o) =>
              map([
                ["key", tstr(o.key)],
                ["value", bstr(o.bytes)],
              ]),
            ),
        ),
      ],
    ]),
  );
  const basis = encode(
    map([
      ["format", tstr("rhizomatic.source-basis/1")],
      ...common,
      ["snapshot", tstr(contentAddress(payload))],
    ]),
  );
  return {
    snapshot: describe(signer, observation, "snapshot/1", { data: [blob(payload)] }),
    capture: describe(signer, observation, "capture/1", {
      "source-binding": [ref(boot.binding.id)],
      authority: [ref(boot.authority.id)],
      basis: [blob(basis)],
    }),
    revision,
  };
}

/** The selected program: the exact original signed acts and their pins. */
export interface PortableProgram {
  readonly hyperschema: Delta;
  readonly hyperschemaPin: string;
  readonly schema: Delta;
  readonly schemaPin: string;
  /** Every other act the selected closure needs, besides the two top acts. */
  readonly definitions: readonly Delta[];
  readonly definitionAt: number;
}

/** One frozen invocation: route, source, program and times are fixed before dispatch. */
export interface PortableInvocation {
  readonly root: string;
  /** The operand instant: the host's observed now, or the as-of cutoff. */
  readonly at: number;
  /** The host observation, sampled once. Signed serving-at must equal it. */
  readonly receivedAt: number;
  readonly historicalCutoff?: number;
  readonly program: PortableProgram;
  readonly source: readonly Delta[];
  /** The source's present state, for the endpoint's final current-source check. */
  readonly currentSource: () => readonly Delta[];
}

export type PortableAnswer =
  | {
      readonly status: "completed";
      readonly hview: HView;
      readonly view: View;
      readonly hviewDigest: string;
      readonly viewDigest: string;
    }
  | {
      readonly status: "refused" | "indeterminate";
      readonly stage: "gather" | "resolve";
      readonly code: string;
    };

const field = (body: CborValue, key: string): CborValue | undefined =>
  body.t === "map" ? body.v.find(([k]) => k === key)?.[1] : undefined;
const textOf = (v: CborValue | undefined): string => {
  if (v?.t !== "tstr") throw new Error("portable read: malformed body text");
  return v.v;
};
const codeOf = (body: CborValue): string =>
  field(body, "code")?.t === "tstr" ? textOf(field(body, "code")) : "unknown";

/** A built invocation: the exact gather request and delivery that will be dispatched. */
export interface PreparedPortableRead {
  readonly boot: PortableBoot;
  readonly invocation: PortableInvocation;
  readonly source: PortableSource;
  readonly request: Delta;
  readonly delivery: readonly Delta[];
}

/** Build the signed source, request and delivery for one invocation. Nothing is dispatched. */
export function preparePortableRead(
  signer: Signer,
  boot: PortableBoot,
  inv: PortableInvocation,
): PreparedPortableRead {
  const src = portableSource(signer, boot, inv.source, inv.receivedAt, inv.historicalCutoff);
  const program = inv.program;
  const request = describe(signer, inv.receivedAt, "request/1", {
    receiver: [ent(signer.author)],
    configuration: [ref(boot.configuration.id)],
    operation: [ref(boot.declarations[0]!.id)],
    capture: [ref(src.capture.id)],
    snapshot: [ref(src.snapshot.id)],
    root: [ent(inv.root)],
    at: [p(inv.at)],
    "serving-at": [p(inv.receivedAt)],
    interpretation: [p("core/1")],
    hyperschema: [ref(program.hyperschema.id)],
    "hyperschema-pin": [p(program.hyperschemaPin)],
    schema: [ref(program.schema.id)],
    "schema-pin": [p(program.schemaPin)],
    bindings: [blob(encode(map([])))],
    "definition-at": [p(program.definitionAt)],
    definition: program.definitions.map((d) => ref(d.id)).sort(byTargetRef),
    ...(inv.historicalCutoff === undefined
      ? {}
      : { "historical-cutoff": [p(inv.historicalCutoff)] }),
  });
  const delivery = [
    request,
    src.capture,
    src.snapshot,
    boot.authority,
    program.hyperschema,
    program.schema,
    ...program.definitions,
  ];
  return { boot, invocation: inv, source: src, request, delivery };
}

/** The package's own input preflight over exactly what would be dispatched. */
export function preflightPortableRead(prepared: PreparedPortableRead) {
  const { boot } = prepared;
  return preflightMaterializationInput(
    {
      configuration: boot.configuration,
      declarations: boot.declarations,
      bindings: [boot.binding],
    },
    prepared.request.id,
    prepared.delivery.map(serializeCommandDelta),
    prepared.invocation.receivedAt,
  );
}

/** Run one gather then one resolve through the package endpoint. One attempt; no retry. */
export async function runPortableRead(
  signer: Signer,
  prepared: PreparedPortableRead,
): Promise<PortableAnswer> {
  const { boot, invocation: inv, request, delivery } = prepared;
  const src = prepared.source;
  const grant: MaterializationSourceCapability = {
    // Batch reads never recapture or restore: the captured source is the whole invocation.
    capture: () => Promise.resolve({ status: "source-unavailable" }),
    reacquireSnapshot: () => Promise.resolve({ status: "source-unavailable" }),
    checkCurrent(binding, revision, authority) {
      if (binding !== boot.binding.id || authority !== boot.authority.id)
        return Promise.resolve({ status: "unauthorized" });
      const now = portableSource(
        signer,
        boot,
        inv.currentSource(),
        inv.receivedAt,
        inv.historicalCutoff,
      );
      return Promise.resolve(
        now.revision === revision ? { status: "current" } : { status: "source-changed" },
      );
    },
  };
  const endpoint = MaterializationEndpoint.boot({
    configuration: boot.configuration,
    declarations: boot.declarations,
    bindings: [boot.binding],
    signer,
    sourceGrants: new Map([[boot.binding.id, grant]]),
    diagnostic: () => {},
  });
  const resolveOp = boot.declarations[1];
  const gathered = await endpoint.invoke(
    request.id,
    delivery.map(serializeCommandDelta),
    inv.receivedAt,
  );
  const context = {
    receiver: signer.author,
    configuration: boot.configuration.id,
    request: request.id,
    requestDelta: request,
    receivedAt: inv.receivedAt,
    capture: src.capture,
    snapshot: src.snapshot,
  };
  const gatherRead = readMaterializationResult(gathered, context);
  if (gatherRead.status !== "completed")
    return { status: gatherRead.status, stage: "gather", code: codeOf(gatherRead.body) };
  const payload = readMaterializationDescription(gathered).result?.[0];
  if (payload?.kind !== "bytes") throw new Error("portable read: gather carries no result");
  const evidence = describe(signer, inv.receivedAt, "evidence/1", { result: [payload] });
  const resolveRequest = describe(signer, inv.receivedAt, "request/1", {
    receiver: [ent(signer.author)],
    configuration: [ref(boot.configuration.id)],
    operation: [ref(resolveOp!.id)],
    evidence: [ref(evidence.id)],
  });
  const resolved = await endpoint.invoke(
    resolveRequest.id,
    [resolveRequest, evidence].map(serializeCommandDelta),
    inv.receivedAt,
  );
  const resolveRead = readMaterializationResult(resolved, {
    ...context,
    request: resolveRequest.id,
    requestDelta: resolveRequest,
    evidence,
  });
  if (resolveRead.status !== "completed" || resolveRead.value === undefined)
    return {
      status: resolveRead.status === "completed" ? "refused" : resolveRead.status,
      stage: "resolve",
      code: codeOf(resolveRead.body),
    };
  const envelope = field(gatherRead.body, "envelope");
  if (envelope?.t !== "bstr") throw new Error("portable read: gather body has no envelope");
  return {
    status: "completed",
    hview: decodeHViewEnvelope(envelope.v),
    view: resolveRead.value,
    hviewDigest: textOf(field(resolveRead.body, "hview")),
    viewDigest: textOf(field(resolveRead.body, "view")),
  };
}

function byTargetRef(a: Target, b: Target): number {
  const x = a.kind === "delta" ? a.deltaRef.delta : "",
    y = b.kind === "delta" ? b.deltaRef.delta : "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Prepare and run in one step, for callers that already chose the portable route. */
export async function portableRead(
  signer: Signer,
  boot: PortableBoot,
  inv: PortableInvocation,
): Promise<PortableAnswer> {
  return runPortableRead(signer, preparePortableRead(signer, boot, inv));
}
