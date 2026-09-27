// `loam user recover <name>` (step 5, PR 3e-2; the design is refactor/audit/user-recovery.md). The
// operator moves a user to a new key. The readers (3e-1) do the enforcing: once the recovery record
// lands, the old key holds no standing anywhere the host's users are read. This command writes that
// evidence in the one order that can be resumed or rolled back honestly, and says which it did.
//
// The order, and why:
//   1. Every refusal before anything is written, so a refusal leaves no journal and no file moved.
//   2. The JOURNAL first, durable, naming the attempt. A crash after this point is always resumable.
//   3. The old seed archived (never deleted), the new seed written.
//   4. One atomic operator append: the record, its lineage, the new root claim, and strikes of the
//      old key's standing in the host. From here the fence holds everywhere.
//   5. After an append error, READ before undoing: the append may have committed. A read that
//      cannot tell leaves everything in place and reports "pending".
//   6. Pool strikes (hygiene), then the new key's binding. Each step is journaled; the journal is
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
import { CTX_GRANTS } from "../gateway/accounts.js";
import { readContainerTable } from "../gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../gateway/genesis.js";
import { Gateway } from "../gateway/gateway.js";
import {
  CTX_ROOT,
  lineageClaims,
  recoveryChain,
  recoveryClaims,
  userEntity,
  userGroundOf,
  userRootAt,
} from "../gateway/user-root.js";
import { rootClaims, resolveUserView } from "../server/users.js";
import type { StoreBackend } from "../store/backend.js";
import { readSeed, readUserSeed, userSeedPath, writeUserSeed } from "./config.js";

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
  /** Test seam: called once the journal is durable and before any seed file moves. */
  readonly afterJournal?: () => void;
}

interface Journal {
  readonly attempt: string;
  readonly previous?: string;
  readonly root: string;
  readonly record: string;
  readonly archive?: string;
  readonly pools: readonly string[];
  readonly bound: boolean;
}

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
  } catch {
    // A platform that cannot open a directory for fsync (Windows) has no directory entry to sync.
  }
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

// Is `id` struck for good by the operator: a strike with no end, itself unstruck?
function struckForGood(reactor: Reactor, operator: string, id: string): boolean {
  return reactor.negationsOf(id).some((n) => {
    const neg = reactor.get(n);
    return (
      neg?.claims.author === operator &&
      neg.claims.validUntil === undefined &&
      reactor.negationsOf(n).length === 0
    );
  });
}

// What `key` holds in `reactor` that a recovery strikes: every grant naming it, and every
// delegation it signed. The fence already denies it standing; these strikes keep the record honest.
function standingOf(reactor: Reactor, key: string): string[] {
  const out: string[] = [];
  for (const id of reactor.byTarget(STORE_ENTITY)) {
    const d = reactor.get(id);
    if (d === undefined) continue;
    const grant = d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === STORE_ENTITY &&
        p.target.entity.context === CTX_GRANTS,
    );
    const names = d.claims.pointers.some(
      (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === key,
    );
    if (grant && names) out.push(id);
  }
  for (const id of reactor.byTarget(key)) {
    const d = reactor.get(id);
    if (d === undefined || d.claims.author !== key) continue;
    const kind = d.claims.pointers.find((p) => p.role === "kind")?.target;
    if (kind?.kind === "primitive" && kind.value === "delegation") out.push(id);
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

const strikes = (gw: Gateway, operator: string, seed: string, ids: readonly string[]): Delta[] =>
  [...new Set(ids)]
    .filter((id) => !struckForGood(gw.reactor, operator, id))
    .map((id) => signClaims(makeNegationClaims(operator, gw.stamp(operator).timestamp, id), seed));

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

async function boot(o: RecoverOptions, seed: string): Promise<Gateway> {
  return Gateway.boot(o.openBackend(o.storePath), assembleGenesis({ operatorSeed: seed }), {
    ...(o.channelBackend === undefined ? {} : { channelBackend: o.channelBackend }),
  });
}

/** Run `loam user recover`. Returns the process exit code. */
export async function recoverUser(o: RecoverOptions): Promise<number> {
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
  if (journal !== undefined) return resume(o, opSeed, operator, journal);

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
    // 2. The standing preflight: the new key must be able to write once it is the root.
    const standing = [...gw.reactor.byTarget(STORE_ENTITY)].some((id) => {
      const d = gw.reactor.get(id);
      if (d === undefined || d.claims.author !== operator) return false;
      const subject = d.claims.pointers.find((p) => p.role === "subject")?.target;
      const verb = d.claims.pointers.find((p) => p.role === "verb")?.target;
      return (
        subject?.kind === "primitive" &&
        subject.value === userEntity(name) &&
        verb?.kind === "primitive" &&
        (verb.value === "write" || verb.value === "admin") &&
        !struckForGood(gw.reactor, operator, id)
      );
    });
    if (!standing) {
      return refuse(
        `${name} holds no write or admin grant by name, so a new key could not write. Grant ` +
          `${name} standing first. Nothing was written.`,
      );
    }
    const previous = userRootAt(gw.reactor, now, operator, name, users.erased());
    const newSeed = randomBytes(32).toString("hex");
    const root = authorForSeed(newSeed);
    const attempt = randomBytes(8).toString("hex");
    const retired = new Set(chain.kind === "chain" ? chain.retired : []);
    if (previous !== undefined) retired.add(previous);
    retired.delete(root);
    const record = signClaims(
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
        gw.stamp(operator).timestamp,
      ),
      opSeed,
    );
    const archive =
      seedRead.kind === "present" ? `${userSeedPath(home, name)}.replaced-${attempt}` : undefined;

    // 3. The journal first, durable.
    writeDurable(
      journalPath(home, name),
      JSON.stringify({
        attempt,
        ...(previous === undefined ? {} : { previous }),
        root,
        record: record.id,
        ...(archive === undefined ? {} : { archive }),
        pools: [],
        bound: previous === undefined,
      } satisfies Journal),
    );
    o.afterJournal?.();
    if (archive !== undefined) moveNoClobber(userSeedPath(home, name), archive);
    writeUserSeed(home, name, newSeed);

    // 4. One atomic operator append.
    const t = gw.stamp(operator).timestamp;
    const lineage = signClaims(
      lineageClaims({ name, recovery: record.id, root, retired: [...retired] }, operator, t),
      opSeed,
    );
    const rootClaim = signClaims(rootClaims(name, root, operator, t), opSeed);
    const struck = strikes(gw, operator, opSeed, [
      ...otherRootClaims(gw.reactor, operator, name, root),
      ...(previous === undefined ? [] : standingOf(gw.reactor, previous)),
    ]);
    try {
      await gw.append([record, lineage, rootClaim, ...struck]);
    } catch (err) {
      await gw.close().catch(() => {});
      // 5. Read before undoing.
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
  try {
    const gw = await boot(o, opSeed);
    try {
      committed = gw.reactor.get(journal.record) !== undefined;
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
  rollback(o, journal);
  o.io.err(
    `user recover: the append failed (${cause instanceof Error ? cause.message : String(cause)}) ` +
      `and did not land. Nothing changed: the old key file is back in place.`,
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
  rmSync(journalPath(o.home, o.name), { force: true });
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
    if (gw.reactor.get(j.record) === undefined) {
      rollback(o, j);
      io.err(
        `user recover: an earlier attempt for ${name} did not land. It is rolled back; nothing changed. Run this again to recover.`,
      );
      return 1;
    }
    const seedRead = readUserSeed(home, name);
    if (seedRead.kind !== "present" || authorForSeed(seedRead.seed) !== j.root) {
      io.err(
        `user recover: ${name}'s recovery landed, but ${userSeedPath(home, name)} does not hold its ` +
          `new key. Recovery is PENDING; restore that file and run this again.`,
      );
      return 1;
    }
    let journal = j;
    // 6. Pools: strike the old key's standing in each attached inbox; name the ones not attached.
    const pending: string[] = [];
    if (j.previous !== undefined) {
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
        const ids = standingOf(ground.reactor, j.previous);
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
    // The binding, signed by the new key.
    if (!journal.bound && j.previous !== undefined) {
      try {
        await gw.append([
          signClaims(bindingClaims(j.root, j.previous, gw.stamp(j.root).timestamp), seedRead.seed),
        ]);
        journal = { ...journal, bound: true };
        updateJournal(home, name, journal);
      } catch (err) {
        pending.push(`the binding (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    const lines = [
      `${name} now signs with ${j.root}.`,
      ...(j.previous === undefined ? [] : [`${j.previous} is retired: it holds no standing here.`]),
      ...(j.archive === undefined ? [] : [`the old key file is kept at ${j.archive}.`]),
      `connections do not carry over: ${name} re-authorizes the ones to keep.`,
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
