// The ingest doors (ticket T19: the Gateway's two entry points for deltas, in their own module).
// APPEND is the governed door: the batch is validated whole (verified signatures, the erasure
// holes, capability standing, resource budgets), persisted BEFORE it is served, refused loudly.
// FEDERATE is the union door: a peer's deltas cross by VERIFICATION alone plus an admission
// predicate — never authorize() — because federation is union at the substrate, not a governed
// mutation ("no authority deciding whose truth survives", SPEC §8); whether a peer's facts shape a
// local view is a read-time TRUST choice. Both doors remember the hole (§11): a tombstoned id is
// refused re-entry until its tombstone is lawfully struck.
//
// Foreign law stays inert by the SAME operator-rooting the local store uses: a federated grant /
// membership / registration / binding-definition authored by anyone but this store's operator binds
// nothing (grantHeld / readRegistrations / readBindingDefinitions all filter on the operator). This
// rests on one invariant the federation must keep: DISTINCT OPERATOR SEEDS ACROSS INSTANCES — two
// stores sharing an operator seed trust each other's constitution completely. Give every instance
// its own operator identity. (The §24.1 quarantine pool is the one sanctioned shared-seed case.)
//
// These are the implementations behind `Gateway.append` / `federate` / `admitFor` / `offeredDeltas`
// — thin delegating methods on the class, bodies here. They reach the gateway only through its
// declared internals seam (the `@internal` members on the class — see the seam note in gateway.ts).

import { computeId, evalTerm, verifyDelta, type Delta } from "@bombadil/rhizomatic";
import { authorize } from "./accounts.js";
import { budgetRefusal } from "./budget.js";
import { ERASE_ENTITY, eraseDefect, isTombstone, readTombstones } from "./erase.js";
import type { AppendReceipt, FederationReport, Gateway } from "./gateway.js";
import { publicDefect } from "./public.js";
import { readTrustPolicy } from "./trust.js";

// Persist a batch, THEN serve it (the body of `Gateway.append`). The batch is validated whole (one
// bad delta refuses the lot); it lands in the backend before the reactor sees it, so nothing a
// query or a subscriber can observe is ever less durable than the ground — a failed write means
// nothing happened, and the caller may simply retry. Only verified signatures pass: the substrate
// accepts unsigned deltas, the gateway does not (authority is always attested here). And each
// delta's author must hold STANDING — the operator, or a surviving operator-rooted write grant on
// this store; what the delta points at is not authorization's business (entities are unowned —
// trust is the reader's). Authorization reads the state as it stands before the batch — a batch
// cannot bootstrap its own permissions.
export async function appendImpl(gw: Gateway, deltas: Iterable<Delta>): Promise<AppendReceipt> {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  const batch = [...deltas];
  // The door remembers the hole (SPEC §11): an erased id is refused re-entry — through
  // append as through federation — until its tombstone is lawfully struck (forgiveness).
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  for (const d of batch) {
    if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified") {
      throw new Error(
        `append rejected: delta ${d.id} is unsigned or not what it claims to be — ` +
          `the gateway accepts only verified authorship`,
      );
    }
    if (dead.has(d.id)) {
      throw new Error(
        `append rejected: delta ${d.id} was erased — a tombstone at ${ERASE_ENTITY} refuses ` +
          `its return (strike the tombstone to forgive it)`,
      );
    }
    // Governance begins with the operator: a gateway holding no operator identity is an
    // ungoverned local store (any verified delta is welcome); one holding an operator
    // enforces capabilities on everyone but the operator. Deployed gateways (step 6) are
    // always governed.
    if (gw.operatorAuthor !== undefined) {
      const verdict = authorize(gw.reactor, d, gw.operatorAuthor);
      if (!verdict.ok) {
        throw new Error(`append rejected: ${verdict.refusal}`);
      }
    }
  }
  // Door resource budgets (SPEC §25): a granted author the operator has metered may not append
  // past their volume quota — deployment config, re-resolved live from `loam:budget`, layered
  // above §12's stranger floor. Absent a budget the author is unmetered (today's behavior); the
  // operator sets budgets and is never metered. Checked once for the whole batch, on the state
  // as it stands before it — the same discipline authorize() reads under.
  if (gw.operatorAuthor !== undefined) {
    const overBudget = budgetRefusal(gw.reactor, gw.operatorAuthor, batch);
    if (overBudget !== undefined) {
      throw new Error(`append rejected: ${overBudget}`);
    }
  }
  await gw.backend.append(batch); // a throw here means NOTHING was ingested or served
  let accepted = 0;
  let duplicates = 0;
  for (const d of batch) gw.justPersisted.add(d.id);
  try {
    for (const d of batch) {
      const result = gw.ingestVia(d);
      if (result.status === "accepted") accepted += 1;
      else duplicates += 1; // "rejected" is unreachable: the batch was validated above
    }
  } finally {
    // Always cleared — duplicates never hit the raw stream, and a mid-ingest throw must not
    // leave stale ids silently exempting future raw-stream writes.
    for (const d of batch) gw.justPersisted.delete(d.id);
  }
  return { accepted, duplicates };
}

// The admission function the store's own TRUST POLICY dictates (the body of `Gateway.admitFor`),
// resolved fresh from the live deltas at loam:trust each call (trust is data — see trust.ts): open
// admits every verified delta, roster admits the operator and the named authors, closed admits
// nothing. `federate` and `pullFrom` use this when no explicit admit is given; an explicit
// predicate always wins.
export function admitForImpl(gw: Gateway): (d: Delta) => boolean {
  const policy = readTrustPolicy(gw.reactor, gw.operatorAuthor);
  if (policy.mode === "open") return () => true;
  if (policy.mode === "closed") return () => false;
  return (d) => d.claims.author === gw.operatorAuthor || policy.roster.has(d.claims.author);
}

// The surviving deltas this store offers a peer — everything, or what the offered lens selects.
export function offeredDeltasImpl(gw: Gateway): Delta[] {
  const lens = gw.options.offeredLens;
  if (lens === undefined) return [...gw.reactor.snapshot()];
  const result = evalTerm(lens, gw.reactor.snapshot());
  if (result.sort !== "dset") throw new Error("an offered lens must select a delta set");
  return [...result.set];
}

// Admit a batch of peer deltas (the body of `Gateway.federate`): verify each (a forgery or an
// unsigned delta is refused, and one bad delta does not spoil the rest), apply the admission
// predicate, then ingest + write through. Idempotent — union dedups, so re-pulling accepts nothing
// new.
export async function federateImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  opts: { admit?: (d: Delta) => boolean } = {},
): Promise<FederationReport> {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  const all = [...deltas];
  const admit = opts.admit ?? admitForImpl(gw); // the store's trust policy, unless overridden
  // The door remembers the hole (SPEC §11): a tombstoned id is refused re-entry even past an
  // explicit admit override — un-erasure is striking the tombstone, never a lucky re-send.
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  const admitted: Delta[] = [];
  let rejected = 0;
  for (const d of all) {
    // A tombstone is a removal-order, not an inert claim — so it faces the same validator at
    // this door as at the append door (eraseDefect), and an unauthorized or malformed one is
    // refused rather than stored. Likewise a public-read declaration: it OPENS a door, so a
    // malformed one is refused here exactly as at append (publicDefect) — the two doors must
    // not disagree about what lawful loam:public data is. Everything the readers trust
    // downstream passed a door here.
    if (
      computeId(d.claims) !== d.id ||
      verifyDelta(d) !== "verified" ||
      dead.has(d.id) ||
      publicDefect(d.claims) !== undefined ||
      (isTombstone(d.claims) && eraseDefect(d, gw.reactor, gw.operatorAuthor) !== undefined) ||
      !admit(d)
    ) {
      rejected += 1;
      continue;
    }
    admitted.push(d);
  }
  let accepted = 0;
  if (admitted.length > 0) {
    await gw.backend.append(admitted);
    for (const d of admitted) gw.justPersisted.add(d.id);
    try {
      for (const d of admitted) {
        if (gw.ingestVia(d).status === "accepted") accepted += 1;
      }
    } finally {
      for (const d of admitted) gw.justPersisted.delete(d.id);
    }
  }
  // "accepted" counts deltas NEWLY ingested — a duplicate verified but merged into what was
  // already there, so a re-pull accepts nothing (union is idempotent).
  return { offered: all.length, accepted, rejected };
}
