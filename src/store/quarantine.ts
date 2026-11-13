import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export const DELTA_ID = /^1e20[0-9a-f]{64}$/;

export const DELTA_ID_LENGTH = 68;

export function isDeltaId(s: string): boolean {
  return DELTA_ID.test(s);
}

export type QuarantineReason = "unparseable" | "id-mismatch" | "invalid-signature" | "foreign-key";

export interface QuarantinedRow {
  readonly key: string;
  readonly reason: QuarantineReason;
  readonly preview: string;
  readonly negates?: readonly string[];
}

export function negatesOf(claims: Delta["claims"]): readonly string[] {
  const out: string[] = [];
  for (const p of claims.pointers) {
    if (p.role === "negates" && p.target.kind === "delta") out.push(p.target.deltaRef.delta);
  }
  return out;
}

export function strandedStrikeWarnings(rows: readonly QuarantinedRow[]): string[] {
  const out: string[] = [];
  let opaque = 0;
  for (const r of rows) {
    for (const target of r.negates ?? []) {
      out.push(
        `quarantined row ${r.key} CLAIMS TO NEGATE delta ${target} (unverified); if that negation ` +
          `was real — a retraction, revoked grant, or erasure — ${target} reads LIVE again until ` +
          `this row is settled (repair discard + re-federate the healthy copy).`,
      );
    }
    if ((r.negates ?? []).length === 0 && r.reason === "unparseable") opaque += 1;
  }
  if (opaque > 0) {
    out.push(
      `${opaque} quarantined row(s) could not be parsed — a retraction, revoked grant, or ` +
        `erasure MAY be missing from the ground. Verify negations after settling.`,
    );
  }
  return out;
}

export function previewOf(raw: string, max = 80): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  const printable = [...oneLine].map((c) => (c >= " " && c !== "\u007f" ? c : "\ufffd")).join("");
  return printable.length > max ? `${printable.slice(0, max)}…` : printable;
}

export interface RepairableBackend extends StoreBackend {
  quarantine(): Promise<QuarantinedRow[]>;

  discardRow(key: string): Promise<boolean>;

  restoreQuarantined?(deltas: Iterable<Delta>): Promise<readonly string[]>;
}

export function isRepairable(b: StoreBackend): b is RepairableBackend {
  return (
    typeof (b as Partial<RepairableBackend>).quarantine === "function" &&
    typeof (b as Partial<RepairableBackend>).discardRow === "function"
  );
}

export interface AdmissionDeps {
  parseClaims: (json: unknown) => Delta["claims"];
  computeId: (claims: Delta["claims"]) => string;
  makeDelta: (claims: Delta["claims"], sig?: string) => Delta;
  verifyDelta: (delta: Delta) => "verified" | "unsigned" | "invalid";
}

export type Admission =
  | { readonly ok: true; readonly delta: Delta }
  | {
      readonly ok: false;
      readonly reason: Exclude<QuarantineReason, "foreign-key">;
      readonly negates?: readonly string[];
    };

export function admit(
  filedId: string,
  claimedId: string,
  rawClaims: unknown,
  sig: string | undefined,
  deps: AdmissionDeps,
): Admission {
  let claims: Delta["claims"];
  try {
    claims = deps.parseClaims(rawClaims);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  const struck = negatesOf(claims);
  const negates = struck.length > 0 ? { negates: struck } : {};
  if (deps.computeId(claims) !== filedId || claimedId !== filedId) {
    return { ok: false, reason: "id-mismatch", ...negates };
  }
  const delta = deps.makeDelta(claims, sig);
  if (deps.verifyDelta(delta) === "invalid") {
    return { ok: false, reason: "invalid-signature", ...negates };
  }
  return { ok: true, delta };
}
