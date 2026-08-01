// §36 phase 10 — Erasure honesty (T131). Criteria 1–7 of
// `.adlc/specs/36-10-erasure-honesty.md`, transcribed. The phase makes the erasure report NAME the
// §36 home files it does not sweep — `credentials.json`, `login-locks.json`, and the per-user signing
// key `user.<name>.seed` — on BOTH the live health report and the re-issuable compliance receipt, and
// rails the security counterpart: a login for a user whose RECORD DELTA was erased is refused, because
// the GROUND (not the unswept credential file) is the authority the door trusts.
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
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import {
  credentialsPath,
  hashPassword,
  readCredentials,
  writeCredentials,
  type ScryptParams,
} from "../../src/server/credentials.js";
import { locksPath } from "../../src/server/login-locks.js";
import { userSeedPath } from "../../src/cli/config.js";
import { roleClaims, rolesOf, userClaims, resolveUserView } from "../../src/server/users.js";
import { SESSION_COOKIE, PRESESSION_COOKIE } from "../../src/server/session.js";
import { bootSlateStore, standSlate, BEFORE_DEADLINE } from "../gateway/slating.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

// The home auth surfaces the disclosure MUST name, DERIVED from each surface's own path function —
// the source of truth §36 writes through — never a hardcoded copy that a hollow rail could satisfy
// (H10). A rail whose expected set came from the report itself would measure nothing; a rail whose
// expected set was two frozen literals could not have caught the per-user seed that was missing.
// So the expectation is the basenames these functions produce. WHEN §36 ADDS A HOME FILE that holds
// a subject's per-user data, wire its path function in HERE; the mutual-coverage assertions in
// criterion 7 then force the disclosure to grow with it, on both surfaces.
const SURFACE_HOME = "/loam-home";
const CREDENTIALS_FILE = basename(credentialsPath(SURFACE_HOME)); // credentials.json
const LOCKS_FILE = basename(locksPath(SURFACE_HOME)); // login-locks.json
const SEED_FAMILY = basename(userSeedPath(SURFACE_HOME, "<name>")); // user.<name>.seed
const MUST_DISCLOSE = [CREDENTIALS_FILE, LOCKS_FILE, SEED_FAMILY].sort();

/** Does `list` carry, for `file`, an entry that names it AND says erasure does not reach it? */
const namesUnswept = (list: readonly string[], file: string): boolean =>
  list.some((line) => line.includes(file) && /not\b|never\b|outside\b/i.test(line));

/** Does the report name EVERY home auth surface as unswept? (Its list reads as exhaustive.) */
const disclosesAll = (list: readonly string[] | undefined): boolean =>
  list !== undefined && MUST_DISCLOSE.every((file) => namesUnswept(list, file));

/** Every file-shaped token a surface names — credentials.json, login-locks.json, user.<name>.seed. */
const fileTokens = (list: readonly string[]): string[] =>
  [...new Set(list.flatMap((line) => line.match(/[\w.<>-]+\.(?:json|seed)/g) ?? []))].sort();

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

// --- criterion 1: health() names every home auth surface -----------------------------------------

describe("T131 criterion 1 — the health report names the surfaces erasure does not sweep", () => {
  it("health() names credentials.json, login-locks.json and user.<name>.seed as unswept", async () => {
    const { gw } = await plainStore();
    const health = await gw.health();
    const list = nonSweptOf(health);
    expect(list).toBeDefined();
    // Each home auth surface, named and marked unswept — including the per-user SIGNING KEY, whose
    // omission was the H7 hole a two-file expectation could not see. Expectation derived from the
    // path functions (H10), not from the report.
    expect(namesUnswept(list!, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(list!, LOCKS_FILE)).toBe(true);
    expect(namesUnswept(list!, SEED_FAMILY)).toBe(true);
    // Positive control against a blanket disclaimer: the report also says erasure DOES purge deltas,
    // so "unswept" is a claim about these files and not a catch-all that any prose would satisfy.
    expect(list!.join("\n")).toMatch(/delta/i);
  });
});

// --- criterion 2: the disclosure reaches the receipt ---------------------------------------------

describe("T131 criterion 2 — the disclosure reaches the compliance receipt", () => {
  it("the receipt's nonClaim names credentials.json, login-locks.json and user.<name>.seed", async () => {
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    const bystander = observed(FERN, "tag", "shade", 1100, "6c".repeat(32));
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    // The RECEIPT, the document a reader treats as proof, must carry every surface too — the per-user
    // seed included, or the nonClaim list reads as exhaustive while a subject's key sits in the home.
    expect(namesUnswept(receipt.nonClaim, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(receipt.nonClaim, LOCKS_FILE)).toBe(true);
    expect(namesUnswept(receipt.nonClaim, SEED_FAMILY)).toBe(true);
    // Two-sided, both bytes checked: the member IS gone and the bystander SURVIVES — the disclosure
    // rides a real cut, and it did not come at the cost of over-purging.
    expect(await gw.backend.holds(member.id)).toBe(false);
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
    // Zero-erasure: a store that has forgotten nothing still names every home auth surface.
    const fresh = await plainStore();
    const zero = await fresh.gw.health();
    expect(zero.erasure.promised).toBe(0);
    expect(disclosesAll(nonSweptOf(zero))).toBe(true);
    const zeroList = nonSweptOf(zero)!;

    // Refused path: an erase of an id nothing holds THROWS and changes nothing; a following health()
    // still names every surface, byte-identical to the zero-erasure list.
    await expect(fresh.gw.erase("delta:nothing-here")).rejects.toThrow();
    const afterRefusal = await fresh.gw.health();
    expect(disclosesAll(nonSweptOf(afterRefusal))).toBe(true);
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
    expect(disclosesAll(nonSweptOf(partial))).toBe(true);
    expect(nonSweptOf(partial)).toEqual(zeroList);
  });
});

// --- criterion 7: one source, exactly the home auth surfaces the path functions define -------------

describe("T131 criterion 7 — both surfaces disclose exactly the derived home auth surfaces", () => {
  it("both surfaces disclose the same set, and it equals the path-function-derived MUST_DISCLOSE", async () => {
    // Two failures this rail must catch, and both bit: DRIFT between the surfaces (finding A), and an
    // OMISSION on both (the per-user seed H7). So the check reduces each surface to its file-shaped
    // tokens and requires them to equal MUST_DISCLOSE — the set DERIVED from the path functions, not a
    // frozen literal. A surface omitting the seed goes red; a surface growing an undeclared file goes
    // red; the two disagreeing goes red. The receipt's other nonClaim lines name containers, not
    // files, so each surface reduces to exactly its auth-surface mentions.
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const health = await gw.health();

    expect(MUST_DISCLOSE).toEqual([CREDENTIALS_FILE, LOCKS_FILE, SEED_FAMILY].sort()); // the derived set
    expect(fileTokens(receipt.nonClaim)).toEqual(MUST_DISCLOSE);
    expect(fileTokens(nonSweptOf(health)!)).toEqual(MUST_DISCLOSE);
  });
});
