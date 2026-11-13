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
import { declaredInboxes, readContainerTable } from "../gateway/container-law.js";
import { readErasures, refusedIds } from "../gateway/erase-law.js";
import {
  cutClaims,
  cutsHere,
  manifestClaims,
  incarnationId,
  outcomeClaims,
  outcomesOf,
  type Outcome,
} from "../gateway/recovery-cut.js";
import { readClosedIds } from "../gateway/slate-law.js";
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
import type { Ground } from "../gateway/ground.js";

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
  readonly openBackend: (path: string) => StoreBackend;
  readonly channelBackend?: (pool: string) => StoreBackend;
  readonly abandonAttempt?: boolean;
  readonly afterJournal?: () => void;
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
  readonly retired: readonly string[];
  readonly predecessor?: Journal;
  readonly cuts?: Readonly<Record<string, readonly string[]>>;
}

const HOST = "";

const journalPath = (home: string, name: string): string => `${userSeedPath(home, name)}.recovery`;

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
    if (process.platform !== "win32") throw err;
  }
}

function writeSeedDurable(path: string, seed: string, attempt: string): void {
  const temp = `${path}.${attempt}.tmp`;
  rmSync(temp, { force: true });
  writeDurable(temp, `${seed}\n`);
  linkSync(temp, path);
  unlinkSync(temp);
  syncDir(path);
}

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

function moveNoClobber(from: string, to: string): void {
  linkSync(from, to);
  unlinkSync(from);
  syncDir(to);
}

function struckForGood(
  reactor: Ground,
  operator: string,
  id: string,
  now: number,
  erased: ReadonlySet<string>,
): boolean {
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

function otherRootClaims(reactor: Ground, operator: string, name: string, keep: string): string[] {
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

const strikes = (gw: Gateway, ids: readonly string[]): Delta[] => {
  const law = gw.signer!;
  return [...new Set(ids)]
    .filter(
      (id) =>
        !struckForGood(
          gw.reactor,
          law.author,
          id,
          gw.validityNow(),
          readClosedIds(gw, gw.validityNow()),
        ),
    )
    .map((id) =>
      law.sign(withStamp(gw.stamp(law.author), (t) => makeNegationClaims(law.author, t, id))),
    );
};

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

function signCut(ground: Gateway, spec: { attempt: string; recovery: string; key: string }): Delta {
  const law = ground.signer!;
  const store = incarnationId(ground.reactor, law.author, refusedIds(ground.reactor, law.author));
  if (store === undefined) throw new Error("the store has no incarnation marker to cut against");
  return law.sign(
    withStamp(ground.stamp(law.author), (t) => cutClaims({ ...spec, store }, law.author, t)),
  );
}

const poolGateway = (gw: Gateway, name: string): Gateway | undefined =>
  gw.connectionInboxes.get(name)?.gateway ?? gw.channelPools.get(name)?.gateway;

async function settleCuts(gw: Gateway, j: Journal, outcome: Outcome): Promise<string[]> {
  const pending: string[] = [];
  for (const [pool, ids] of Object.entries(j.cuts ?? {})) {
    const where = pool === HOST ? "the host" : pool;
    const ground = pool === HOST ? gw : poolGateway(gw, pool);
    if (ground === undefined) {
      pending.push(`the ${outcome} outcome in ${where} (not attached)`);
      continue;
    }
    const law = ground.signer!;
    const operator = law.author;
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
            law.sign(
              withStamp(ground.stamp(operator), (t) => outcomeClaims(id, outcome, operator, t)),
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

export async function recoverUser(o: RecoverOptions): Promise<number> {
  return recover(o, undefined);
}

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
    const roster =
      previous === undefined ? [] : declaredInboxes(readContainerTable(gw.reactor, now, operator));
    const unreachable = roster.filter((pool) => poolGateway(gw, pool) === undefined);
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
      const temp = `${journalPath(home, name)}.next`;
      rmSync(temp, { force: true });
      writeDurable(temp, next);
      renameSync(temp, journalPath(home, name));
      syncDir(journalPath(home, name));
    }
    o.afterJournal?.();
    if (archive !== undefined) moveNoClobber(userSeedPath(home, name), archive);
    writeSeedDurable(userSeedPath(home, name), newSeed, attempt);

    let j = readJournal(home, name)!;
    const cut = (ground: Gateway, pool: string): Delta => {
      const d = signCut(ground, { attempt, recovery: record.id, key: previous! });
      j = { ...j, cuts: { ...j.cuts, [pool]: [...(j.cuts?.[pool] ?? []), d.id] } };
      updateJournal(home, name, j);
      return d;
    };
    if (previous !== undefined) {
      for (const pool of roster) {
        const ground = poolGateway(gw, pool)!;
        try {
          await ground.append([cut(ground, pool)]);
        } catch (err) {
          await gw.close().catch(() => {});
          return afterAppendError(o, opSeed, err);
        }
      }
      await o.afterCuts?.(gw);
    }

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
    const struck = strikes(gw, [
      ...otherRootClaims(gw.reactor, operator, name, root),
      ...[...retired].flatMap((key) => standingOf(gw.reactor, key)),
    ]);
    try {
      const barrier: Delta[] = [];
      if (previous !== undefined) {
        const hostCut = cut(gw, HOST);
        const landed = roster.flatMap((pool) =>
          (j.cuts?.[pool] ?? []).filter(
            (id) => poolGateway(gw, pool)!.reactor.get(id) !== undefined,
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
      if (barrier.length > 0) await gw.append(barrier);
      await gw.append([record, lineage, rootClaim, ...struck]);
    } catch (err) {
      await gw.close().catch(() => {});
      return afterAppendError(o, opSeed, err);
    }
  } finally {
    await gw.close().catch(() => {});
  }
  return resume(o, opSeed, operator, readJournal(home, name)!);
}

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
      committed = gw.reactor.get(journal.record) !== undefined;
      if (!committed) pending = await settleCuts(gw, journal, "aborted");
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

function abortPending(o: RecoverOptions, cause: unknown, pending: readonly string[]): number {
  o.io.err(
    `user recover: the recovery of ${o.name} did not land (${cause instanceof Error ? cause.message : String(cause)}). ` +
      `PENDING: ${pending.join(", ")}; the old key stays paused there. Run this again to finish ` +
      `the abort.`,
  );
  return 1;
}

function rollback(o: RecoverOptions, j: Journal): void {
  const path = userSeedPath(o.home, o.name);
  const current = readUserSeed(o.home, o.name);
  if (current.kind === "present" && authorForSeed(current.seed) === j.root)
    rmSync(path, { force: true });
  if (j.archive !== undefined && existsSync(j.archive) && !existsSync(path))
    moveNoClobber(j.archive, path);
  if (j.predecessor !== undefined) updateJournal(o.home, o.name, j.predecessor);
  else rmSync(journalPath(o.home, o.name), { force: true });
}

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
    const landed =
      held || (gw.peer?.journal.snapshot().base.arrivals.some((a) => a.id === j.record) ?? false);
    const recordErased =
      userGroundOf(gw.reactor).erased().has(j.record) ||
      readErasures(gw.reactor, gw.validityNow(), operator).has(j.record);
    if (landed && recordErased) {
      io.err(
        `user recover: ${name}'s recovery record ${j.record} landed and was then erased, so it is ` +
          `not in force. This attempt cannot finish. The journal is kept at ${journalPath(home, name)} ` +
          `as the account of it. Resolve ${name}'s recovery history (\`loam store\` shows it), then ` +
          `remove the journal and recover again.`,
      );
      return 1;
    }
    if (!held) {
      const pending = await settleCuts(gw, j, "aborted");
      if (pending.length > 0) return abortPending(o, "an earlier attempt stopped first", pending);
      rollback(o, j);
      io.err(
        `user recover: an earlier attempt for ${name} did not land. It is rolled back; nothing changed. Run this again to recover.`,
      );
      return 1;
    }
    const seedRead = readUserSeed(home, name);
    if (seedRead.kind !== "present" || authorForSeed(seedRead.seed) !== j.root) {
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
    const pending: string[] = await settleCuts(gw, j, "committed");
    if (j.retired.length > 0) {
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
          const deltas = strikes(ground, ids);
          if (deltas.length > 0) await ground.append(deltas);
          journal = { ...journal, pools: [...journal.pools, pool] };
          updateJournal(home, name, journal);
        } catch {
          pending.push(pool);
        }
      }
    }
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
