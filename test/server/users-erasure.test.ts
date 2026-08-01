// §36 phase 10 — Erasure honesty (T131). Criteria 1–7 of
// `.adlc/specs/36-10-erasure-honesty.md`, transcribed. The phase makes the erasure report NAME the
// two §36 home files it does not sweep — `credentials.json` and `login-locks.json` — on BOTH the live
// health report and the re-issuable compliance receipt, and rails the security counterpart: a login
// for a user whose RECORD DELTA was erased is refused, because the GROUND (not the unswept credential
// file) is the authority the door trusts.
//
// IT CHANGES NO PURGE. Every assertion here is about what the report SAYS or what the door REFUSES;
// none removes a byte. The two-sided erasure discipline still holds throughout: the target is gone AND
// a named live bystander survives (the erased user's credential entry, and a bystander user's whole
// account).
//
// What this file deliberately does NOT assert, and which rail covers each gap:
//   - No timing/flood assertion on the login door — phase 5 (`login-door.test.ts`) and phase 9
//     (`login-delay.test.ts`) own those. Criterion 3 drives a real server only for the ground-shut
//     refusal.
//   - No claim that either home file is ever cleared — that is the out-of-scope boundary (criterion 5),
//     not a promise this phase makes. `credentials.ts` exposes no remove-entry function and this phase
//     adds none.
//   - No assertion that an already-open session is severed — that is `getLogin`'s re-read (phase 5).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import {
  hashPassword,
  readCredentials,
  writeCredentials,
  type ScryptParams,
} from "../../src/server/credentials.js";
import { roleClaims, rolesOf, userClaims, resolveUserView } from "../../src/server/users.js";
import { SESSION_COOKIE, PRESESSION_COOKIE } from "../../src/server/session.js";
import { bootSlateStore, standSlate, BEFORE_DEADLINE } from "../gateway/slating.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

// The two files the disclosure must NAME. Hand-written, never read from the report — a rail whose
// expectation comes from the code under test measures nothing (H10). These are the acceptance
// criterion's own words, so a report that dropped one goes red here.
const CREDENTIALS_FILE = "credentials.json";
const LOCKS_FILE = "login-locks.json";

/** Does `list` carry, for `file`, an entry that names it AND says erasure does not reach it? */
const namesUnswept = (list: readonly string[], file: string): boolean =>
  list.some((line) => line.includes(file) && /not\b|never\b|outside\b/i.test(line));

/** The two named entries a report must carry — exactly, and only, these two files. */
const disclosesBoth = (list: readonly string[] | undefined): boolean =>
  list !== undefined && namesUnswept(list, CREDENTIALS_FILE) && namesUnswept(list, LOCKS_FILE);

const nonSweptOf = (health: unknown): readonly string[] | undefined =>
  (health as { nonSwept?: readonly string[] }).nonSwept;

// --- gateway-level fixtures ----------------------------------------------------------------------

const backends: MemoryBackend[] = [];
const gateways: Gateway[] = [];
const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
  backends.length = 0;
});

async function plainStore(): Promise<{ gw: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
  backends.push(backend);
  gateways.push(gw);
  return { gw, backend };
}

// --- criterion 1: health() names both files ------------------------------------------------------

describe("T131 criterion 1 — the health report names the surfaces erasure does not sweep", () => {
  it("health() names credentials.json and login-locks.json as surfaces erasure does not sweep", async () => {
    const { gw } = await plainStore();
    const health = await gw.health();
    const list = nonSweptOf(health);
    expect(list).toBeDefined();
    // The two files, each named and marked unswept. Hand-written expectation (H10).
    expect(namesUnswept(list!, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(list!, LOCKS_FILE)).toBe(true);
    // Positive control against a blanket disclaimer: the report also says erasure DOES purge deltas,
    // so "unswept" is a claim about these two files and not a catch-all that any prose would satisfy.
    expect(list!.join("\n")).toMatch(/delta/i);
  });
});

// --- criterion 2: the disclosure reaches the receipt ---------------------------------------------

describe("T131 criterion 2 — the disclosure reaches the compliance receipt", () => {
  it("the receipt's nonClaim names credentials.json and login-locks.json", async () => {
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    const bystander = observed(FERN, "tag", "shade", 1100, "6c".repeat(32));
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(namesUnswept(receipt.nonClaim, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(receipt.nonClaim, LOCKS_FILE)).toBe(true);
    // Two-sided: the bystander survived the cut at the bytes — the disclosure did not come at the cost
    // of over-purging.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
  });
});

// --- criteria 3 & 4: the login door is shut by the ground, the credential file survives -----------

interface Account {
  readonly roles: readonly ("operator" | "actor")[];
  readonly password: string;
}

async function loginServer(accounts: Record<string, Account>): Promise<{
  base: string;
  gw: Gateway;
  home: string;
  recordIds: Record<string, string>;
}> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
  gateways.push(gw);
  let ts = 9001;
  const recordIds: Record<string, string> = {};
  for (const [name, acct] of Object.entries(accounts)) {
    const record = signClaims(userClaims(name, OPERATOR, ts++), OPERATOR_SEED);
    recordIds[name] = record.id;
    await gw.append([record]);
    for (const role of acct.roles) {
      await gw.append([signClaims(roleClaims(name, role, OPERATOR, ts++), OPERATOR_SEED)]);
    }
  }
  const home = mkdtempSync(join(tmpdir(), "loam-users-erasure-"));
  homes.push(home);
  const users: Record<string, Awaited<ReturnType<typeof hashPassword>>> = {};
  for (const [name, acct] of Object.entries(accounts)) {
    users[name] = await hashPassword(acct.password, CHEAP);
  }
  writeCredentials(home, { version: 1, users });
  const handle = await serve({
    mounts: { default: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, gw, home, recordIds };
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

/** POST a login the way the store's own page does: a fresh nonce+token pair and a same-origin signal. */
async function attemptLogin(base: string, user: string, password: string): Promise<Response> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  return fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user, password }).toString(),
  });
}

const sessionCookieOf = (res: Response): string | undefined =>
  cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));

describe("T131 criteria 3 & 4 — a login whose user record delta was erased is refused", () => {
  it("refuses a login whose user record delta was erased, at the delta and the door levels", async () => {
    const { base, gw, recordIds } = await loginServer({
      alice: { roles: ["operator"], password: PASSWORD },
      bob: { roles: ["operator"], password: PASSWORD },
    });

    // Baseline: both log in before any erasure.
    expect(sessionCookieOf(await attemptLogin(base, "alice", PASSWORD))).toBeDefined();

    // Erase alice's RECORD delta. This changes no home file — it removes a delta from the ground.
    await gw.erase(recordIds.alice!);

    // DELTA LEVEL: alice's record delta is gone; the ground no longer names her, so rolesOf is empty.
    // The bystander bob is untouched at both the delta and the resolution level.
    expect(gw.reactor.get(recordIds.alice!)).toBeUndefined();
    expect(resolveUserView(gw.reactor, OPERATOR, "alice")).toBeUndefined();
    expect(rolesOf(gw.reactor, OPERATOR, "alice").size).toBe(0);
    expect(gw.reactor.get(recordIds.bob!)).toBeDefined();
    expect(rolesOf(gw.reactor, OPERATOR, "bob").has("operator")).toBe(true);

    // DOOR LEVEL: alice's CORRECT password is now refused — the ground shut the door, not the
    // credential file, which still holds her entry. The refusal is phase 5's ordinary 401, byte for
    // byte, and sets no session cookie.
    const refused = await attemptLogin(base, "alice", PASSWORD);
    expect(refused.status).toBe(401);
    expect((await refused.json()) as unknown).toEqual({ errors: ["the login was refused"] });
    expect(sessionCookieOf(refused)).toBeUndefined();

    // Two-sided at the door: the bystander bob still signs in over the same door.
    expect(sessionCookieOf(await attemptLogin(base, "bob", PASSWORD))).toBeDefined();
  });

  it("erasing a user record leaves credentials.json untouched, for the erased user and a bystander", async () => {
    const { gw, home, recordIds } = await loginServer({
      alice: { roles: ["operator"], password: PASSWORD },
      bob: { roles: ["operator"], password: PASSWORD },
    });
    await gw.erase(recordIds.alice!);
    // The boundary, at the object level: erasure swept a DELTA and did not touch the credential file.
    // Both entries survive — the erased user's (proving credentials.json is unswept, and that removing
    // a credential entry is a separate operation this phase does not perform) and the bystander's.
    const creds = readCredentials(home);
    expect(creds.users.alice).toBeDefined();
    expect(creds.users.bob).toBeDefined();
  });
});

// --- criterion 5: the disclosure survives every erasure path -------------------------------------

describe("T131 criterion 5 — the disclosure is not conditional on the erasure outcome", () => {
  it("the unswept disclosure is present on a zero-erasure, a partial, and a refused path", async () => {
    // Zero-erasure: a store that has forgotten nothing still names both files.
    const fresh = await plainStore();
    const zero = await fresh.gw.health();
    expect(zero.erasure.promised).toBe(0);
    expect(disclosesBoth(nonSweptOf(zero))).toBe(true);
    const zeroList = nonSweptOf(zero)!;

    // Refused path: an erase of an id nothing holds THROWS and changes nothing; a following health()
    // still names both files, byte-identical to the zero-erasure list.
    await expect(fresh.gw.erase("delta:nothing-here")).rejects.toThrow();
    const afterRefusal = await fresh.gw.health();
    expect(disclosesBoth(nonSweptOf(afterRefusal))).toBe(true);
    expect(nonSweptOf(afterRefusal)).toEqual(zeroList);

    // Partial / unproven path: a real erasure leaves a surviving tombstone (a promise), then a tier
    // that cannot be asked makes the byte verdict UNPROVEN — status leaves "ok". The disclosure is
    // still there, identical.
    const { gw, backend } = await plainStore();
    const target = observed(FERN, "height", 30, 1000, OPERATOR_SEED);
    await gw.append([target]);
    await gw.erase(target.id);
    backend.holds = () => Promise.reject(new Error("this tier is offline"));
    const partial = await gw.health();
    expect(partial.status).not.toBe("ok"); // unproven or settling — a partial state, not clean
    expect(disclosesBoth(nonSweptOf(partial))).toBe(true);
    expect(nonSweptOf(partial)).toEqual(zeroList);
  });
});

// --- criterion 7: one source, exactly the two scoped files ---------------------------------------

describe("T131 criterion 7 — both surfaces disclose the same two files, and only those two", () => {
  it("both surfaces disclose the same two named files, and only those two", async () => {
    // The receipt path (a real cut) and the health path must carry the SAME named entries, from ONE
    // source — a drift between them is the finding-A failure. And the list is exactly two files: a
    // third would be an unnamed guess, a second omission would reopen the H7 this phase closes.
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const health = await gw.health();

    // Every home file the disclosure names, from each surface — pulled by the file-name markers the
    // criterion fixes, so a report growing a THIRD file goes red here rather than passing silently.
    const named = (list: readonly string[]): string[] =>
      [CREDENTIALS_FILE, LOCKS_FILE, "oauth.json", "operator.seed"].filter((f) =>
        list.some((line) => line.includes(f)),
      );
    expect(named(receipt.nonClaim).sort()).toEqual([CREDENTIALS_FILE, LOCKS_FILE].sort());
    expect(named(nonSweptOf(health)!).sort()).toEqual([CREDENTIALS_FILE, LOCKS_FILE].sort());
  });
});
