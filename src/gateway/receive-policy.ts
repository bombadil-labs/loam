/** Internal experimental receiving reference projection (T281/T282), not a package API.
 * The caller supplies authenticated destination authority and explicitly separated source
 * scopes. Source IDs are boundary assertions, not facts inferred from signer identity.
 * No ingestion adapter, signer, ambient ground, dependency interpreter or persistent cache.
 * Decision wire profile is intentionally experimental: one exact context pointer plus JSON.
 * Bindings select one source lineage/reading; curses survive until lawfully negated.
 * Multiple surviving bindings for a relationship refuse, rather than guessing chronology.
 * All input is verified before projection. This bounded in-memory proof is not a
 * production-scale implementation; even unrelated malformed input refuses the batch.
 */
import { Reactor, computeId, verifyDelta, type Delta } from "@bombadil/rhizomatic";
import { lawfulNegated, lensOf, readRegistrations, type Registration } from "./registration.js";
import { selectReceivingSnapshot } from "./receive-snapshot.js";

interface Input {
  readonly receiver: string;
  readonly destination: string;
  readonly decisions: readonly Delta[];
  readonly sources: readonly { readonly id: string; readonly deltas: readonly Delta[] }[];
}
interface Decision {
  kind: "binding" | "curse" | "pause";
  id?: string;
  bindingId?: string;
  selection?: unknown;
  relationship: string;
  reading: string;
  source?: string;
  destination?: string;
  sourceAuthor?: string;
  entity?: string;
  mode?: string;
}
export interface LiveReceivingResult {
  readonly status:
    | "selected"
    | "cursed"
    | "unavailable"
    | "missing-source"
    | "unsupported"
    | "conflict"
    | "invalid-input"
    | "invalid-selection";
  readonly relationship?: string;
  readonly source?: string;
  readonly destination?: string;
  readonly reading?: string;
  /** Law candidate only, NOT ready-to-serve: callers must withhold the named
   * resolver fields (or reject this candidate), never silently serve policy fallback. */
  readonly registration?: Registration;
  readonly withheldResolvers?: boolean;
  readonly withheldResolverFields?: readonly string[];
}
const CONTEXT = "loam.receive.experimental.v1";
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && !v.includes("\0");
function parse(d: Delta): Decision | undefined {
  const ps = d.claims.pointers;
  if (!ps.some((p) => p.target.kind === "entity" && p.target.entity.context === CONTEXT))
    return undefined;
  const marker = ps.find((p) => p.role === "decision");
  const payload = ps.find((p) => p.role === "payload");
  if (
    ps.length !== 2 ||
    marker?.target.kind !== "entity" ||
    marker.target.entity.id !== "receive-policy" ||
    payload?.target.kind !== "primitive" ||
    typeof payload.target.value !== "string"
  )
    throw new Error("decision envelope");
  // With exactly these two roles and a primitive payload, earlier context
  // discovery can only have matched the entity marker.
  const value: unknown = JSON.parse(payload.target.value);
  // Exact kind/key validation below rejects JSON scalars and arrays; null throws
  // on property access and the projection catches it as invalid-input.
  const v = value as Record<string, unknown>;
  const keys =
    v.kind === "binding"
      ? [
          "kind",
          "relationship",
          "reading",
          "source",
          "destination",
          "sourceAuthor",
          "entity",
          "mode",
        ]
      : v.kind === "curse"
        ? ["kind", "relationship", "reading"]
        : v.kind === "pause"
          ? ["kind", "relationship", "reading", "bindingId"]
          : [];
  const hasSelection = Object.hasOwn(v, "selection");
  const selectionAllowed = v.kind === "pause" || (v.kind === "binding" && v.mode === "one-time");
  if (
    keys.length === 0 ||
    Object.keys(v).length !== keys.length + (hasSelection && selectionAllowed ? 1 : 0) ||
    (v.kind === "pause" && !hasSelection) ||
    !keys.every((k) => nonempty(v[k]))
  )
    throw new Error("decision shape");
  return v as unknown as Decision;
}
function reactor(ds: readonly Delta[]): Reactor {
  const r = new Reactor();
  for (const d of ds) {
    if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified")
      throw new Error("unverified delta");
    if (r.ingest(d).status === "rejected") throw new Error("rejected delta");
  }
  return r;
}
// Dependencies need a source-relative effective-adoption registry. Until it exists,
// reject every program carrying an expansion, fixpoint or embedded resolution.
function dependencies(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("kind" in value && ["expand", "fix", "resolve"].includes(String(value.kind))) return true;
  return Object.values(value).some(dependencies);
}
export function projectLiveReceiving(input: Input): LiveReceivingResult[] {
  try {
    if (!nonempty(input.receiver) || !nonempty(input.destination))
      throw new Error("missing authority/scope");
    const policy = reactor(input.decisions);
    const sources = new Map<string, Reactor>();
    for (const source of input.sources) {
      if (!nonempty(source.id) || sources.has(source.id)) throw new Error("source identity");
      sources.set(source.id, reactor(source.deltas));
    }
    const negated = lawfulNegated(policy, input.receiver);
    const decisions: Decision[] = [];
    for (const d of policy.snapshot()) {
      // Stranger claims are verified but never acquire recipient policy authority.
      if (d.claims.author !== input.receiver) continue;
      // A lawfully struck delta is not live input, however malformed; only survivors are parsed.
      if (negated(d.id)) continue;
      const decision = parse(d);
      if (decision !== undefined) decisions.push({ ...decision, id: d.id });
    }
    const groups = new Map<string, Decision[]>();
    for (const d of decisions.filter((d) => d.kind === "binding")) {
      const group = groups.get(d.relationship) ?? [];
      group.push(d);
      groups.set(d.relationship, group);
    }
    const results: LiveReceivingResult[] = [];
    for (const [relationship, group] of [...groups].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (!group.some((d) => d.destination === input.destination)) continue;
      const d = group[0]!;
      const base = {
        relationship,
        source: d.source!,
        destination: input.destination,
        reading: d.reading,
      };
      if (group.length !== 1) {
        results.push({ relationship, destination: input.destination, status: "conflict" });
        continue;
      }
      if (
        decisions.some(
          (c) => c.kind === "curse" && c.relationship === relationship && c.reading === d.reading,
        )
      ) {
        results.push({ ...base, status: "cursed" });
        continue;
      }
      if (d.mode !== "live" && !(d.mode === "one-time" && d.selection !== undefined)) {
        results.push({ ...base, status: "unsupported" });
        continue;
      }
      const source = sources.get(d.source!);
      if (source === undefined) {
        results.push({ ...base, status: "missing-source" });
        continue;
      }
      let selected: Registration;
      let operand = source;
      const pauses = decisions.filter((p) => p.kind === "pause" && p.bindingId === d.id);
      // A pause pins a LIVE binding to a snapshot. On a one-time binding it is a decision the
      // projection cannot honour, so it is refused rather than ignored.
      if (
        (d.mode !== "live" && pauses.length > 0) ||
        pauses.some((p) => p.relationship !== relationship || p.reading !== d.reading)
      ) {
        results.push({ ...base, status: "invalid-selection" });
        continue;
      }
      if (
        pauses.some(
          (p) =>
            p.selection !== null &&
            selectReceivingSnapshot(source, d, p.selection, true).status === "invalid-selection",
        )
      ) {
        results.push({ ...base, status: "invalid-selection" });
        continue;
      }
      // Equivalent pauses are idempotent by normalized selection; incompatible surviving
      // decisions require explicit recipient negation rather than a timestamp guess.
      const pauseKeys = new Set(
        pauses.map((p) => {
          const value = p.selection;
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const v = value as Record<string, unknown>;
            return JSON.stringify([
              v.source,
              v.registrationId,
              v.versionId,
              Array.isArray(v.memberIds) ? [...(v.memberIds as unknown[])].sort() : v.memberIds,
            ]);
          }
          return JSON.stringify(value);
        }),
      );
      if (pauseKeys.size > 1) {
        results.push({ ...base, status: "conflict" });
        continue;
      }
      const pause = pauses[0];
      if (pause?.selection === null) {
        results.push({ ...base, status: "unavailable" });
        continue;
      }
      if (d.mode === "one-time" || pause !== undefined) {
        const pinned = selectReceivingSnapshot(
          source,
          d,
          pause === undefined ? d.selection : pause.selection,
          pause !== undefined,
        );
        if (pinned.status !== "selected") {
          results.push({ ...base, status: pinned.status });
          continue;
        }
        selected = pinned.registration;
        operand = pinned.operand;
      } else {
        const rows = readRegistrations(source, d.sourceAuthor).filter(
          (r) => r.entity === d.entity && lensOf(r) === d.reading,
        );
        if (rows.length !== 1) {
          results.push({ ...base, status: rows.length > 1 ? "conflict" : "unavailable" });
          continue;
        }
        selected = rows[0]!;
      }
      // The legacy reader drops malformed resolver envelopes. That tolerance must
      // not turn withheld code into an apparently equivalent policy-only field.
      const bindingPointers = operand.get(selected.boundId!)!.claims.pointers;
      const rootsPointers = bindingPointers.filter((p) => p.role === "roots");
      if (
        rootsPointers.length !== 1 ||
        !Array.isArray(selected.roots) ||
        !selected.roots.every(nonempty)
      ) {
        results.push({ ...base, status: "unsupported" });
        continue;
      }
      const resolverPointers = bindingPointers.filter((p) => p.role === "resolvers");
      if (
        resolverPointers.length > 1 ||
        (resolverPointers.length === 1 && selected.resolvers === undefined)
      ) {
        results.push({ ...base, status: "unsupported" });
        continue;
      }
      // The legacy parser uses a plain object: special own keys such as __proto__
      // can vanish. Refuse any lossy translation of signed override field names.
      if (resolverPointers.length === 1) {
        const target = resolverPointers[0]!.target;
        if (target.kind !== "primitive" || typeof target.value !== "string") {
          results.push({ ...base, status: "unsupported" });
          continue;
        }
        const raw: unknown = JSON.parse(target.value);
        const rawKeys = Object.keys(raw as object).sort();
        if (JSON.stringify(rawKeys) !== JSON.stringify(Object.keys(selected.resolvers!).sort())) {
          results.push({ ...base, status: "unsupported" });
          continue;
        }
      }
      if (dependencies(selected.hyperschema.body)) {
        results.push({ ...base, status: "unsupported" });
        continue;
      }
      // Return only declarative reading metadata: no executable resolver or write capability.
      const registration: Registration = {
        hyperschema: selected.hyperschema,
        schema: selected.schema,
        roots: selected.roots,
        entity: selected.entity!,
        lensName: selected.lensName!,
        boundAt: selected.boundAt!,
        firstBoundAt: selected.firstBoundAt!,
        boundId: selected.boundId!,
        boundBy: selected.boundBy!,
      };
      results.push({
        ...base,
        status: "selected",
        registration,
        withheldResolvers: selected.resolvers !== undefined,
        withheldResolverFields: Object.keys(selected.resolvers ?? {}).sort(),
      });
    }
    // A receiving name cannot silently choose between independent relationships.
    return results.map((r) =>
      r.status === "selected" &&
      results.some(
        (other) => other !== r && other.status === "selected" && other.reading === r.reading,
      )
        ? {
            relationship: r.relationship!,
            source: r.source!,
            destination: r.destination!,
            reading: r.reading!,
            status: "conflict",
          }
        : r,
    );
  } catch {
    return [{ status: "invalid-input" }];
  }
}
