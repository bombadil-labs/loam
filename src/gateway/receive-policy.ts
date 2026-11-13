import { Reactor, computeId, governedDeltas, verifyDelta, type Delta } from "@bombadil/rhizomatic";
import { lensOf, readRegistrations, type Registration } from "./registration.js";
import { negatedAt } from "./negation.js";
import { selectReceivingSnapshot } from "./receive-snapshot.js";

interface Input {
  readonly receiver: string;
  readonly destination: string;
  readonly decisions: readonly Delta[];
  readonly sources: readonly { readonly id: string; readonly deltas: readonly Delta[] }[];
  readonly now: number;
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
  const value: unknown = JSON.parse(payload.target.value);
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
    const negated = negatedAt(policy, input.now, input.receiver);
    const decisions: Decision[] = [];
    for (const d of governedDeltas(policy.snapshot(), input.now, new Set([input.receiver]))) {
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
    const bindings = decisions.filter((b) => b.kind === "binding");
    const lapsed = (d: Delta): boolean =>
      input.now < d.claims.validFrom ||
      (d.claims.validUntil !== undefined && input.now >= d.claims.validUntil);
    const withdrawnBinding = (id: string): Decision | undefined => {
      const named = policy.get(id);
      if (named === undefined || named.claims.author !== input.receiver) return;
      if (!negated(id) && !lapsed(named)) return;
      try {
        const parsed = parse(named);
        return parsed?.kind === "binding" ? parsed : undefined;
      } catch {
        return undefined;
      }
    };
    const stray = new Set<string>();
    for (const p of decisions) {
      if (p.kind !== "pause") continue;
      const named = bindings.find((b) => b.id === p.bindingId) ?? withdrawnBinding(p.bindingId!);
      if (named?.relationship === p.relationship && named.reading === p.reading) continue;
      stray.add(p.relationship);
      if (named !== undefined) stray.add(named.relationship);
    }
    const results: LiveReceivingResult[] = [];
    for (const [relationship, group] of groups) {
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
      if (stray.has(relationship) || (d.mode !== "live" && pauses.length > 0)) {
        results.push({ ...base, status: "invalid-selection" });
        continue;
      }
      if (
        pauses.some(
          (p) =>
            p.selection !== null &&
            selectReceivingSnapshot(source, d, p.selection, true, input.now).status ===
              "invalid-selection",
        )
      ) {
        results.push({ ...base, status: "invalid-selection" });
        continue;
      }
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
          input.now,
        );
        if (pinned.status !== "selected") {
          results.push({ ...base, status: pinned.status });
          continue;
        }
        selected = pinned.registration;
        operand = pinned.operand;
      } else {
        const rows = readRegistrations(source, input.now, d.sourceAuthor).filter(
          (r) => r.entity === d.entity && lensOf(r) === d.reading,
        );
        if (rows.length !== 1) {
          results.push({ ...base, status: rows.length > 1 ? "conflict" : "unavailable" });
          continue;
        }
        selected = rows[0]!;
      }
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
    for (const relationship of [...stray].sort())
      if (!results.some((r) => r.relationship === relationship))
        results.push({ relationship, destination: input.destination, status: "invalid-selection" });
    results.sort((a, b) =>
      a.relationship! < b.relationship! ? -1 : a.relationship! > b.relationship! ? 1 : 0,
    );
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
