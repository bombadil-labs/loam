// `loam user recover <name>` (step 5, PR 3e-2; the design is refactor/audit/user-recovery.md). The
// operator moves a user to a new key. The readers (3e-1) do the enforcing: once the recovery record
// lands, the old key holds no standing anywhere the host's users are read. This command writes that
// evidence in the one order that can be resumed or rolled back honestly, and says which it did.
//
// The order, and why:
//   1. Every refusal before anything is written, so a refusal leaves no journal and no file moved.
//   2. The JOURNAL first, durable, naming the attempt. A crash after this point is always resumable.
//   3. The old seed archived (never deleted), the new seed written.
//   4. The cuts (recovery-history.md): one in every declared inbox pool, each journaled before it
//      is written. From its cut on, a pool pauses the old key. A pool that is not attached refuses
//      the recovery in step 1, because it could not be cut.
//   5. One atomic operator append: the host's own cut, the cut manifest (every cut that landed), the
//      record, its lineage, the new root claim, and strikes of the old key's standing in the host.
//      The door admits the record only if the manifest names a live cut in this store and in every
//      declared pool, so a pool declared since step 1 refuses the commit. From here the fence holds
//      everywhere.
//   6. The outcomes: `committed` beside every cut once the record landed, `aborted` once it provably
//      did not. An abort lands before the key files roll back, so no pool stays paused unjournaled.
//   7. After an append error, READ before undoing: the append may have committed. A read that
//      cannot tell leaves everything in place and reports "pending".
//   8. Pool strikes (hygiene), then the new key's binding. Each step is journaled; the journal is
//      removed only when all are done.

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { CTX_GRANTS, grantsNaming } from "../gateway/accounts.js";
import { keysEverOf } from "../gateway/principal.js";
import { withStamp } from "../gateway/stamp.js";
import { attachedPool, declaredInboxes, readContainerTable } from "../gateway/container.js";
import { refusedIds } from "../gateway/erase.js";
import {
  cutClaims,
  cutsHere,
  manifestClaims,
  incarnationId,
  outcomeClaims,
  outcomesOf,
  type Outcome,
} from "../gateway/recovery-cut.js";
import { readClosedIds } from "../gateway/slate.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { Gateway } from "../gateway/gateway.js";
import {
  CTX_ROOT,
  verified,
  lineageClaims,
  recoveryChain,
  recoveryClaims,
  userEntity,
  userGroundOf,
  userRootAt,
} from "../gateway/user-root.js";
import { rootClaims, resolveUserView } from "../server/users.js";
import type { StoreBackend } from "../store/backend.js";
import { readSeed, readUserSeed, userSeedPath } from "./config.js";

export interface RecoverIO {
  out(line: string): void;
  err(line: string): void;
}

export interface RecoverOptions {
  readonly home: string;
  readonly name: string;
  readonly replaceSeed: boolean;
  readonly storePath: string;
  readonly io: RecoverIO;
  /** Opens the store's backend. The CLI passes its sqlite opener; a test passes a faulty one. */
  readonly openBackend: (path: string) => StoreBackend;
  /** Opens an inbox pool's backend, so the pools this store holds are attached and reachable. */
  readonly channelBackend?: (pool: string) => StoreBackend;
  /** Discard a landed attempt whose new key file is lost, and recover again to a fresh key. */
  readonly abandonAttempt?: boolean;
  /** Test seam: called once the journal is durable and before any seed file moves. */
  readonly afterJournal?: () => void;
  /** Test seam: called once every pool is cut and before the host commit. */
  readonly afterCuts?: (gw: Gateway) => void | Promise<void>;
}

interface Journal {
  readonly attempt: string;
  readonly previous?: string;
  readonly root: string;
  readonly record: string;
  readonly archive?: string;
  readonly pools: readonly string[];
  readonly bound: boolean;
  /** Every key the chain has retired, as of this attempt: whose inbox standing still needs striking. */
  readonly retired: readonly string[];
  /** The journal of a landed attempt this one abandons, restored if this one never commits. */
  readonly predecessor?: Journal;
  /** Every cut signed for this attempt, by pool (`HOST` for the host's own), before it is written. */
  readonly cuts?: Readonly<Record<string, readonly string[]>>;
}

/** The journal's key for the host's own cut. */
const HOST = "";

const journalPath = (home: string, name: string): string => `${userSeedPath(home, name)}.recovery`;

// Write `data` to a NEW file (`wx`, 0600), fsync it, then fsync its directory.
function writeDurable(path: string, data: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDir(path);
}

function syncDir(path: string): void {
  try {
    const fd = openSync(dirname(path), "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    // Windows cannot open a directory for fsync; there the rename is its own commit. Anywhere else
    // a failed directory sync is a real fault, and the caller must stop before moving a key file.
    if (process.platform !== "win32") throw err;
  }
}

// Write a key file durably and never over an existing one: the bytes fsynced under a temp name,
// linked into place (which refuses an existing target), the temp removed, the directory fsynced.
function writeSeedDurable(path: string, seed: string, attempt: string): void {
  const temp = `${path}.${attempt}.tmp`;
  rmSync(temp, { force: true });
  writeDurable(temp, `${seed}\n`);
  linkSync(temp, path);
  unlinkSync(temp);
  syncDir(path);
}

// Replace the journal with a new state: write beside it, then rename over it (atomic), so a crash
// leaves either the old journal or the new one, never none.
function updateJournal(home: string, name: string, j: Journal): void {
  const path = journalPath(home, name);
  const temp = `${path}.next`;
  rmSync(temp, { force: true });
  writeDurable(temp, JSON.stringify(j));
  renameSync(temp, path);
  syncDir(path);
}

function readJournal(home: string, name: string): Journal | undefined {
  const path = journalPath(home, name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Journal;
}

// Move `from` to `to` without ever overwriting `to`: link (which refuses an existing target), then
// unlink. The inode, and so the 0600 mode, is unchanged.
function moveNoClobber(from: string, to: string): void {
  linkSync(from, to);
  unlinkSync(from);
  syncDir(to);
}

// Is `id` struck for good by the operator at `now`: a strike already in force, with no end, itself
// unstruck? A strike that starts later is not yet one.
function struckForGood(
  reactor: Reactor,
  operator: string,
  id: string,
  now: number,
  erased: ReadonlySet<string>,
): boolean {
  // Only a strike the readers honor counts: verified, and not erased in THIS ground.
  return reactor.negationsOf(id).some((n) => {
    const neg = reactor.get(n);
    return (
      neg !== undefined &&
      !erased.has(n) &&
      verified(neg) &&
      neg.claims.author === operator &&
      neg.claims.validFrom <= now &&
      neg.claims.validUntil === undefined &&
      reactor.negationsOf(n).length === 0
    );
  });
}

// What `key` holds in `reactor` that a recovery strikes: every grant naming it, filed at any
// entity, and every delegation it signed. The fence already denies it standing; these strikes keep
// the record honest. Recovery is rare, so this walks the whole log rather than one index.
function standingOf(reactor: Reactor, key: string): string[] {
  const out: string[] = [];
  for (const d of reactor.arrivalLog()) {
    const grant = d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_GRANTS,
    );
    const names = d.claims.pointers.some(
      (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === key,
    );
    const kind = d.claims.pointers.find((p) => p.role === "kind")?.target;
    const delegation =
      d.claims.author === key && kind?.kind === "primitive" && kind.value === "delegation";
    if ((grant && names) || delegation) out.push(d.id);
  }
  return out;
}

// Every held operator root claim for `name` that names a key other than `keep`.
function otherRootClaims(reactor: Reactor, operator: string, name: string, keep: string): string[] {
  const entity = userEntity(name);
  const out: string[] = [];
  for (const id of reactor.byTarget(entity)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== operator) continue;
    const atRoot = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === CTX_ROOT,
    );
    const namesKeep = d.claims.pointers.some(
      (p) => p.target.kind === "primitive" && p.target.value === keep,
    );
    if (atRoot && !namesKeep) out.push(id);
  }
  return out;
}

// Strikes for good, valid from now: the stamp's ordering timestamp may run ahead of the clock, and
// is never a validity time.
const strikes = (gw: Gateway, operator: string, seed: string, ids: readonly string[]): Delta[] =>
  [...new Set(ids)]
    .filter(
      (id) =>
        !struckForGood(
          gw.reactor,
          operator,
          id,
          gw.validityNow(),
          // The ground's own withheld set (its erased-but-held deltas among them): an inbox's
          // erasures are its own, not its host's.
          readClosedIds(gw, gw.validityNow()),
        ),
    )
    .map((id) =>
      signClaims(
        withStamp(gw.stamp(operator), (t) => makeNegationClaims(operator, t, id)),
        seed,
      ),
    );

function bindingClaims(root: string, key: string, t: number): Claims {
  return {
    timestamp: t,
    validFrom: t,
    author: root,
    pointers: [
      {
        role: "principal",
        target: { kind: "entity", entity: { id: root, context: "rhizomatic.principal" } },
      },
      { role: "kind", target: { kind: "primitive", value: "binding" } },
      { role: "key", target: { kind: "primitive", value: key } },
    ],
  };
}

// A cut for `ground`: this store's incarnation, the recovery, and the key it retires.
function signCut(
  ground: Gateway,
  operator: string,
  seed: string,
  spec: { attempt: string; recovery: string; key: string },
): Delta {
  const store = incarnationId(ground.reactor, operator, refusedIds(ground.reactor, operator));
  if (store === undefined) throw new Error("the store has no incarnation marker to cut against");
  return signClaims(
    withStamp(ground.stamp(operator), (t) => cutClaims({ ...spec, store }, operator, t)),
    seed,
  );
}

// Settle every cut of this attempt that a store holds: write `outcome` beside a cut with none, and
// report a cut whose outcome says otherwise as a conflict, never as settled. A committed attempt must
// then read committed in every store it cut. Returns what is not settled, so the caller reports it
// and keeps the journal.
async function settleCuts(
  gw: Gateway,
  operator: string,
  seed: string,
  j: Journal,
  outcome: Outcome,
): Promise<string[]> {
  const pending: string[] = [];
  for (const [pool, ids] of Object.entries(j.cuts ?? {})) {
    const where = pool === HOST ? "the host" : pool;
    const ground = pool === HOST ? gw : attachedPool(gw, pool);
    if (ground === undefined) {
      pending.push(`the ${outcome} outcome in ${where} (not attached)`);
      continue;
    }
    const erased = refusedIds(ground.reactor, operator);
    const open: string[] = [];
    let conflict = false;
    for (const id of ids) {
      if (ground.reactor.get(id) === undefined || erased.has(id)) continue;
      const outs = outcomesOf(ground.reactor, operator, id, erased);
      if (outs.size === 0) open.push(id);
      else if (outs.size > 1 || !outs.has(outcome)) {
        conflict = true;
        pending.push(
          `a conflict in ${where}: cut ${id} reads ${[...outs].sort().join(" and ")}, not ${outcome}`,
        );
      }
    }
    try {
      if (open.length > 0) {
        await ground.append(
          open.map((id) =>
            signClaims(
              withStamp(ground.stamp(operator), (t) => outcomeClaims(id, outcome, operator, t)),
              seed,
            ),
          ),
        );
      }
    } catch (err) {
      pending.push(
        `the ${outcome} outcome in ${where} (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
    const committed = cutsHere(ground.reactor, operator, refusedIds(ground.reactor, operator)).some(
      (c) => c.recovery === j.record && c.key === j.previous && c.state === "committed",
    );
    if (outcome === "committed" && !conflict && !committed) {
      pending.push(`the cut in ${where}, which does not read committed`);
    }
  }
  return pending;
}

async function boot(o: RecoverOptions, seed: string): Promise<Gateway> {
  return Gateway.boot(o.openBackend(o.storePath), assembleGenesis({ operatorSeed: seed }), {
    ...(o.channelBackend === undefined ? {} : { channelBackend: o.channelBackend }),
  });
}

/** Run `loam user recover`. Returns the process exit code. */
export async function recoverUser(o: RecoverOptions): Promise<number> {
  return recover(o, undefined);
}

// `superseding` is the journal of a landed attempt being abandoned. It stays in place until this
// attempt's journal atomically replaces it, so a refusal or a crash before then leaves it as the
// account of the unfinished work; the retired set it carries is swept again by this attempt.
async function recover(o: RecoverOptions, superseding: Journal | undefined): Promise<number> {
  const { home, name, io } = o;
  const refuse = (line: string, code = 2) => {
    io.err(`user recover: ${line}`);
    return code;
  };
  let opSeed: string;
  try {
    opSeed = readSeed(home);
  } catch (err) {
    return refuse(
      `${home} has no readable operator identity, so nothing was written: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }
  const operator = authorForSeed(opSeed);
  const journal = readJournal(home, name);
  if (journal !== undefined && superseding === undefined)
    return resume(o, opSeed, operator, journal);

  // 1. Refusals, before anything is written.
  const seedRead = readUserSeed(home, name);
  if (seedRead.kind === "unreadable") {
    return refuse(
      `the key file at ${userSeedPath(home, name)} cannot be read (${seedRead.detail}). Nothing was written.`,
      1,
    );
  }
  if (seedRead.kind === "present" && !o.replaceSeed) {
    return refuse(
      `a key file for ${name} is at ${userSeedPath(home, name)}. Pass --replace-seed to archive it ` +
        `and move ${name} to a new key. Nothing was written.`,
    );
  }
  const gw = await boot(o, opSeed);
  try {
    const now = gw.validityNow();
    const users = userGroundOf(gw.reactor);
    if (resolveUserView(gw.reactor, operator, now, name) === undefined) {
      return refuse(`this store holds no standing user record for ${name}. Nothing was written.`);
    }
    const chain = recoveryChain(gw.reactor, operator, name, users.erased());
    if (chain.kind === "broken") {
      return refuse(
        `${name}'s recovery history is broken (competing or missing records), so a new recovery ` +
          `cannot say which one it follows. Erase the wrong record first. Nothing was written.`,
      );
    }
    // 2. The standing preflight: once the new key is the root, a grant naming the user must give it
    // write NOW. Asked through the door's own reading of effective grants (validity, strikes, the
    // issuer chain), not by finding a row.
    const standing = grantsNaming(gw.reactor, now, userEntity(name), operator).some(
      (g) => g.verb === "write" || g.verb === "admin",
    );
    if (!standing) {
      return refuse(
        `${name} holds no effective write or admin grant by name, so a new key could not write. ` +
          `Grant ${name} standing first. Nothing was written.`,
      );
    }
    const previous = userRootAt(gw.reactor, now, operator, name, users.erased());
    // The roster: every declared inbox pool is cut before the host commits, so each must be
    // reachable now. A first root retires no key and cuts nothing.
    const roster =
      previous === undefined ? [] : declaredInboxes(readContainerTable(gw.reactor, now, operator));
    const unreachable = roster.filter((pool) => attachedPool(gw, pool) === undefined);
    if (unreachable.length > 0) {
      return refuse(
        `the pools ${unreachable.join(", ")} are declared but not attached, so this recovery ` +
          `cannot cut them, and ${previous} could keep writing there unseen. Attach them first. ` +
          `Nothing was written.`,
      );
    }
    const newSeed = randomBytes(32).toString("hex");
    const root = authorForSeed(newSeed);
    const attempt = randomBytes(8).toString("hex");
    const retired = new Set(chain.kind === "chain" ? chain.retired : []);
    if (previous !== undefined) retired.add(previous);
    retired.delete(root);
    // Every signed claim takes its validity from the stamp's `validFrom` (now) and only its
    // ordering from `timestamp`, which may run ahead of the clock (#600).
    const record = signClaims(
      withStamp(gw.stamp(operator), (t) =>
        recoveryClaims(
          {
            name,
            ...(previous === undefined ? {} : { previous }),
            root,
            attempt,
            ...(chain.kind === "chain" ? { supersedes: chain.head } : {}),
            retired: [...retired],
          },
          operator,
          t,
        ),
      ),
      opSeed,
    );
    const archive =
      seedRead.kind === "present" ? `${userSeedPath(home, name)}.replaced-${attempt}` : undefined;

    // 3. The journal first, durable.
    const next = JSON.stringify({
      attempt,
      ...(previous === undefined ? {} : { previous }),
      root,
      record: record.id,
      ...(archive === undefined ? {} : { archive }),
      pools: [],
      bound: previous === undefined,
      retired: [...retired],
      ...(superseding === undefined ? {} : { predecessor: superseding }),
      cuts: {},
    } satisfies Journal);
    if (superseding === undefined) writeDurable(journalPath(home, name), next);
    else {
      // Replace the abandoned attempt's journal atomically: before the rename it still stands.
      const temp = `${journalPath(home, name)}.next`;
      rmSync(temp, { force: true });
      writeDurable(temp, next);
      renameSync(temp, journalPath(home, name));
      syncDir(journalPath(home, name));
    }
    o.afterJournal?.();
    if (archive !== undefined) moveNoClobber(userSeedPath(home, name), archive);
    // The new key file is durable BEFORE the record commits: a record naming a key whose secret a
    // crash lost would leave the user with a root no one holds.
    writeSeedDurable(userSeedPath(home, name), newSeed, attempt);

    // 4. The cuts. Each is journaled before it is written, so a crash can never leave a pool paused
    // by a cut the rerun does not know to settle.
    let j = readJournal(home, name)!;
    const cut = (ground: Gateway, pool: string): Delta => {
      const d = signCut(ground, operator, opSeed, { attempt, recovery: record.id, key: previous! });
      j = { ...j, cuts: { ...j.cuts, [pool]: [...(j.cuts?.[pool] ?? []), d.id] } };
      updateJournal(home, name, j);
      return d;
    };
    if (previous !== undefined) {
      for (const pool of roster) {
        const ground = attachedPool(gw, pool)!;
        try {
          await ground.append([cut(ground, pool)]);
        } catch (err) {
          await gw.close().catch(() => {});
          return afterAppendError(o, opSeed, err);
        }
      }
      await o.afterCuts?.(gw);
    }

    // 5. One atomic operator append, led by the host's own cut.
    const lineage = signClaims(
      withStamp(gw.stamp(operator), (t) =>
        lineageClaims({ name, recovery: record.id, root, retired: [...retired] }, operator, t),
      ),
      opSeed,
    );
    const rootClaim = signClaims(
      withStamp(gw.stamp(operator), (t) => rootClaims(name, root, operator, t)),
      opSeed,
    );
    const struck = strikes(gw, operator, opSeed, [
      ...otherRootClaims(gw.reactor, operator, name, root),
      ...[...retired].flatMap((key) => standingOf(gw.reactor, key)),
    ]);
    try {
      // The manifest names every cut this attempt landed, the host's included, and goes ahead of
      // the record: the door admits the record only behind it.
      const barrier: Delta[] = [];
      if (previous !== undefined) {
        const hostCut = cut(gw, HOST);
        const landed = roster.flatMap((pool) =>
          (j.cuts?.[pool] ?? []).filter(
            (id) => attachedPool(gw, pool)!.reactor.get(id) !== undefined,
          ),
        );
        barrier.push(
          hostCut,
          signClaims(
            withStamp(gw.stamp(operator), (t) =>
              manifestClaims(record.id, [hostCut.id, ...landed], operator, t),
            ),
            opSeed,
          ),
        );
      }
      await gw.append([...barrier, record, lineage, rootClaim, ...struck]);
    } catch (err) {
      await gw.close().catch(() => {});
      // 7. Read before undoing.
      return afterAppendError(o, opSeed, err);
    }
  } finally {
    await gw.close().catch(() => {});
  }
  return resume(o, opSeed, operator, readJournal(home, name)!);
}

// The append failed. Did it commit? Read the store again; only a successful read that finds no
// record proves it did not.
async function afterAppendError(
  o: RecoverOptions,
  opSeed: string,
  cause: unknown,
): Promise<number> {
  const journal = readJournal(o.home, o.name)!;
  let committed: boolean;
  let pending: string[] = [];
  try {
    const gw = await boot(o, opSeed);
    try {
      // The bytes decide whether the append committed; erased-but-held still committed, and resume
      // reports what the readers make of it.
      committed = gw.reactor.get(journal.record) !== undefined;
      if (!committed)
        pending = await settleCuts(gw, authorForSeed(opSeed), opSeed, journal, "aborted");
    } finally {
      await gw.close().catch(() => {});
    }
  } catch (err) {
    o.io.err(
      `user recover: the append failed (${String(cause)}) and the store cannot be read to tell ` +
        `whether it landed (${err instanceof Error ? err.message : String(err)}). Recovery is ` +
        `PENDING: the key files and the journal are left as they are. Run this again to finish.`,
    );
    return 1;
  }
  if (committed) return resume(o, opSeed, authorForSeed(opSeed), journal);
  if (pending.length > 0) return abortPending(o, cause, pending);
  rollback(o, journal);
  o.io.err(
    `user recover: the append failed (${cause instanceof Error ? cause.message : String(cause)}) ` +
      `and did not land. Nothing changed: the old key file is back in place.`,
  );
  return 1;
}

// An attempt that did not land, with cuts it could not yet abort: those pools still pause the old
// key. Nothing rolls back until they are settled, and the journal stays as the account of them.
function abortPending(o: RecoverOptions, cause: unknown, pending: readonly string[]): number {
  o.io.err(
    `user recover: the recovery of ${o.name} did not land (${cause instanceof Error ? cause.message : String(cause)}). ` +
      `PENDING: ${pending.join(", ")}; the old key stays paused there. Run this again to finish ` +
      `the abort.`,
  );
  return 1;
}

// Undo an attempt that provably did not land: the new seed goes, the archived one returns.
function rollback(o: RecoverOptions, j: Journal): void {
  const path = userSeedPath(o.home, o.name);
  const current = readUserSeed(o.home, o.name);
  if (current.kind === "present" && authorForSeed(current.seed) === j.root)
    rmSync(path, { force: true });
  if (j.archive !== undefined && existsSync(j.archive) && !existsSync(path))
    moveNoClobber(j.archive, path);
  // An abandoning attempt that never landed hands the journal back to the attempt it abandoned,
  // whose work is still pending.
  if (j.predecessor !== undefined) updateJournal(o.home, o.name, j.predecessor);
  else rmSync(journalPath(o.home, o.name), { force: true });
}

// Finish an attempt from its journal: decide whether it landed, then the pools and the binding.
async function resume(
  o: RecoverOptions,
  opSeed: string,
  operator: string,
  j: Journal,
): Promise<number> {
  const { home, name, io } = o;
  let gw: Gateway;
  try {
    gw = await boot(o, opSeed);
  } catch (err) {
    io.err(
      `user recover: the store cannot be read (${err instanceof Error ? err.message : String(err)}). ` +
        `Recovery is PENDING; run this again.`,
    );
    return 1;
  }
  try {
    const held = gw.reactor.get(j.record) !== undefined;
    if (held && userGroundOf(gw.reactor).erased().has(j.record)) {
      // It landed, and the operator has since erased it: the readers no longer see this recovery.
      // Nothing here is rolled back, and nothing is reported as done.
      io.err(
        `user recover: ${name}'s recovery record ${j.record} landed and was then erased, so it is ` +
          `not in force. This attempt cannot finish. The journal is kept at ${journalPath(home, name)} ` +
          `as the account of it. Resolve ${name}'s recovery history (\`loam store\` shows it), then ` +
          `remove the journal and recover again.`,
      );
      return 1;
    }
    if (!held) {
      const pending = await settleCuts(gw, operator, opSeed, j, "aborted");
      if (pending.length > 0) return abortPending(o, "an earlier attempt stopped first", pending);
      rollback(o, j);
      io.err(
        `user recover: an earlier attempt for ${name} did not land. It is rolled back; nothing changed. Run this again to recover.`,
      );
      return 1;
    }
    const seedRead = readUserSeed(home, name);
    if (seedRead.kind !== "present" || authorForSeed(seedRead.seed) !== j.root) {
      // The record names a key whose secret is not here. If it is truly lost, the remedy is a new
      // recovery that supersedes this one, to a fresh key.
      if (o.abandonAttempt) {
        io.out(
          `user recover: the key ${j.root} named by the last recovery is abandoned; recovering ` +
            `${name} again to a new key.`,
        );
        await gw.close().catch(() => {});
        return recover({ ...o, abandonAttempt: false, replaceSeed: true }, j);
      }
      io.err(
        `user recover: ${name}'s recovery landed, but ${userSeedPath(home, name)} does not hold its ` +
          `new key ${j.root}. Recovery is PENDING. If that file can be restored, restore it and run ` +
          `this again. If its secret is lost, run \`loam user recover ${name} --abandon-attempt\` ` +
          `to recover ${name} again to a new key.`,
      );
      return 1;
    }
    let journal = j;
    // The outcomes: the record landed, so every cut of this attempt is committed.
    const pending: string[] = await settleCuts(gw, operator, opSeed, j, "committed");
    // 8. Pools: strike the old key's standing in each attached inbox; name the ones not attached.
    if (j.retired.length > 0) {
      // An inbox the store declares but has not attached cannot be reached; the fence already
      // refuses the old key there, and this recovery stays pending until it is struck.
      const table = readContainerTable(gw.reactor, gw.validityNow(), operator);
      for (const [pool, rec] of table.containers) {
        if (rec.inboxOf === undefined || table.detached.has(pool)) continue;
        if (!gw.connectionInboxes.has(pool) && !journal.pools.includes(pool)) {
          pending.push(`${pool} (not attached)`);
        }
      }
      for (const [pool, handle] of gw.connectionInboxes) {
        if (journal.pools.includes(pool)) continue;
        const ground = handle.gateway;
        if (ground === undefined) {
          pending.push(pool);
          continue;
        }
        const ids = j.retired.flatMap((key) => standingOf(ground.reactor, key));
        try {
          const deltas = strikes(ground, operator, opSeed, ids);
          if (deltas.length > 0) await ground.append(deltas);
          journal = { ...journal, pools: [...journal.pools, pool] };
          updateJournal(home, name, journal);
        } catch {
          pending.push(pool);
        }
      }
    }
    // The binding, signed by the new key. An earlier run may have landed it and then failed to say
    // so; a binding already held is not signed again.
    if (
      !journal.bound &&
      j.previous !== undefined &&
      keysEverOf(gw.reactor, gw.validityNow(), { root: j.root }, operator).has(j.previous)
    ) {
      journal = { ...journal, bound: true };
      updateJournal(home, name, journal);
    }
    if (!journal.bound && j.previous !== undefined) {
      try {
        await gw.append([
          signClaims(
            withStamp(gw.stamp(j.root), (t) => bindingClaims(j.root, j.previous!, t)),
            seedRead.seed,
          ),
        ]);
        journal = { ...journal, bound: true };
        updateJournal(home, name, journal);
      } catch (err) {
        pending.push(`the binding (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    // Report completion only if the readers agree: the chain's head names this attempt's key.
    const erased = userGroundOf(gw.reactor).erased();
    const chain = recoveryChain(gw.reactor, operator, name, erased);
    const current = userRootAt(gw.reactor, gw.validityNow(), operator, name, erased);
    if (chain.kind !== "chain" || chain.root !== j.root || current !== j.root) {
      io.err(
        `user recover: this attempt landed, but ${name}'s recovery history does not now name ` +
          `${j.root} as root (${chain.kind !== "chain" ? "the history is broken or gone" : chain.root !== j.root ? "a different recovery leads" : "no standing root claim names it"}). ` +
          `The journal is kept at ${journalPath(home, name)}. Nothing is reported as done.`,
      );
      return 1;
    }
    const lines = [
      `${name} now signs with ${j.root}.`,
      ...(j.previous === undefined ? [] : [`${j.previous} is retired: it holds no standing here.`]),
      ...(j.archive === undefined ? [] : [`the old key file is kept at ${j.archive}.`]),
      `connections do not carry over: ${name} re-authorizes the ones to keep.`,
      // A pool declared while this ran (by another writer) has no cut. It shows none of the old
      // key's earlier writes, and a cut written now would come too late to draw the line honestly.
      ...(j.previous === undefined || j.cuts === undefined
        ? []
        : declaredInboxes(readContainerTable(gw.reactor, gw.validityNow(), operator))
            .filter((pool) => !(pool in j.cuts!))
            .map(
              (pool) =>
                `${pool} was declared during this recovery and has no cut: it shows none of ` +
                `${j.previous}'s earlier writes.`,
            )),
    ];
    for (const line of lines) io.out(`user recover: ${line}`);
    if (pending.length > 0) {
      io.err(
        `user recover: recovery landed; PENDING: ${pending.join(", ")}. Run this again to finish.`,
      );
      return 1;
    }
    rmSync(journalPath(home, name), { force: true });
    return 0;
  } finally {
    await gw.close().catch(() => {});
  }
}
