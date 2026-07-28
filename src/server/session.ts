// The session table (SPEC §36 phase 4): sessions in server memory. No door, no cookie, no CLI reads
// this yet — the login door (phase 5) is the first caller.
//
// THIS TABLE IS ONE PROCESS'S STATE, DELIBERATELY. It is a plain `Map`, with no persistence and no
// cross-process coherence: a restart, or a second replica behind a load balancer, sees an empty
// table. That is the deliberate shape for one operator on one box (§9a), not a gap this phase closes
// — a clustered deployment is a different ticket's decision.
//
// THE CLOCK IS MONOTONIC, and that is a security property, not a style choice. `Date.now()` is a
// wall clock a caller or the OS can step backward (a manual change, an NTP correction); if an expiry
// check ever read a SMALLER "now" than an earlier read, an already-expired session would look like it
// had gained time back, which is a backward clock step reading as an extension of the session's
// life. `performance.now()` — the default here — is guaranteed non-decreasing within one process, so
// the default clock cannot produce that. The table also does not rely on the guarantee alone: a row
// is deleted the moment it is found past its idle window, so even a clock that goes backward later
// (an injected test clock, or a future clock source with a weaker guarantee) has no live row left to
// revive.
//
// `idleMs` and `ttlMs` are DURATIONS in milliseconds, always added to a `now()` reading inside this
// file — never compared against one directly. A caller passing an absolute timestamp (a `Date.now()`
// value) where a duration is expected would mint an effectively immortal session or token; nothing
// in this file's own defaults does that, but nothing type-checks it away either.

import { createHash, randomBytes } from "node:crypto";

export interface SessionTableOptions {
  /** How long a session may sit untouched before `touch` refuses it (default 30 minutes). */
  readonly idleMs?: number;
  /** How many signed-in sessions this table will hold at once (default 4096). */
  readonly maxSessions?: number;
  /** A monotonic millisecond source. Injectable so a test can drive it; never `Date.now()`. */
  readonly now?: () => number;
}

interface SessionRow {
  readonly user: string;
  expiresAt: number;
  /** Digests this session minted, so `drop` and pruning know which entries to erase. */
  readonly tokenDigests: Set<string>;
}

interface TokenEntry {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface SessionTable {
  /**
   * Open a signed-in session for `user`. Undefined when the table is at its cap — a full table
   * refuses a new session; it never evicts a LIVE one to make room (a flood of new logins evicting a
   * real operator's session would be worse than the flood itself). Before checking the cap, `open`
   * sweeps every session already past its idle window, so an abandoned session is reclaimed at the
   * next login rather than sitting until the process restarts.
   */
  open(user: string): { readonly id: string } | undefined;
  /**
   * Re-read a session, sliding its idle window forward. Undefined when `id` is unknown or was
   * already past its idle window — in the latter case the row is deleted, never merely reported
   * absent, so a later, smaller clock reading cannot revive it.
   */
  touch(id: string): { readonly user: string } | undefined;
  /** Drop a session and erase every token digest it minted. A session already absent is a no-op. */
  drop(id: string): void;
  /**
   * Mint a bearer-token secret bound to `id`'s session, valid for `ttlMs` from now — its OWN expiry,
   * never the session's idle expiry. Undefined when `id` names no live session. The table records
   * only the secret's SHA-256 digest, never the secret itself.
   */
  mintToken(id: string, ttlMs: number): string | undefined;
  /**
   * The user a live, unexpired token secret names, or undefined. Does NOT slide the named session's
   * idle window — presenting a token is a read of this table, not the activity that keeps a session
   * open; a caller that wants token traffic to do that calls `touch` itself (a phase 7 decision).
   */
  resolveToken(token: string): string | undefined;
  /** The digests `id`'s session currently holds, for observability and testing. Never the secrets. */
  tokenDigests(id: string): readonly string[];
  /** How many sessions are currently open. */
  readonly size: number;
}

const opaque = (): string => randomBytes(32).toString("base64url");
const digestOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const DEFAULTS = {
  idleMs: 30 * 60_000,
  maxSessions: 4096,
};

export function createSessionTable(options: SessionTableOptions = {}): SessionTable {
  const idleMs = options.idleMs ?? DEFAULTS.idleMs;
  const maxSessions = options.maxSessions ?? DEFAULTS.maxSessions;
  const now = options.now ?? ((): number => performance.now());

  const sessions = new Map<string, SessionRow>();
  const tokens = new Map<string, TokenEntry>();

  // Erase a session and every digest it minted from the shared token table. The one path both an
  // explicit `drop` and the idle-sweep in `open` go through, so an abandoned session's tokens never
  // outlive the session row that named them.
  const erase = (id: string, row: SessionRow): void => {
    for (const digest of row.tokenDigests) tokens.delete(digest);
    sessions.delete(id);
  };

  // Remove this session's own token digests that have outlived their TTL. Runs on both `mintToken`
  // and `touch` — minting alone would miss a session that mints once and is then kept alive by
  // ordinary activity for a long time, silently accumulating dead digests.
  const pruneTokens = (row: SessionRow, moment: number): void => {
    for (const digest of row.tokenDigests) {
      const entry = tokens.get(digest);
      if (entry === undefined || entry.expiresAt <= moment) {
        tokens.delete(digest);
        row.tokenDigests.delete(digest);
      }
    }
  };

  const sweepExpired = (moment: number): void => {
    for (const [id, row] of sessions) {
      if (row.expiresAt <= moment) erase(id, row);
    }
  };

  return {
    open(user) {
      const moment = now();
      sweepExpired(moment);
      if (sessions.size >= maxSessions) return undefined;
      const id = opaque();
      sessions.set(id, { user, expiresAt: moment + idleMs, tokenDigests: new Set() });
      return { id };
    },

    touch(id) {
      const row = sessions.get(id);
      if (row === undefined) return undefined;
      const moment = now();
      if (moment > row.expiresAt) {
        erase(id, row);
        return undefined;
      }
      row.expiresAt = moment + idleMs;
      pruneTokens(row, moment);
      return { user: row.user };
    },

    drop(id) {
      const row = sessions.get(id);
      if (row === undefined) return;
      erase(id, row);
    },

    mintToken(id, ttlMs) {
      const row = sessions.get(id);
      if (row === undefined) return undefined;
      const moment = now();
      if (moment > row.expiresAt) {
        erase(id, row);
        return undefined;
      }
      pruneTokens(row, moment);
      const secret = opaque();
      const digest = digestOf(secret);
      tokens.set(digest, { sessionId: id, expiresAt: moment + ttlMs });
      row.tokenDigests.add(digest);
      return secret;
    },

    resolveToken(token) {
      const digest = digestOf(token);
      const entry = tokens.get(digest);
      if (entry === undefined) return undefined;
      const moment = now();
      if (moment > entry.expiresAt) {
        tokens.delete(digest);
        sessions.get(entry.sessionId)?.tokenDigests.delete(digest);
        return undefined;
      }
      return sessions.get(entry.sessionId)?.user;
    },

    tokenDigests(id) {
      const row = sessions.get(id);
      return row === undefined ? [] : [...row.tokenDigests];
    },

    get size() {
      return sessions.size;
    },
  };
}
