// §36 (T113), criterion (u): the report says what it does not do.
//
// §11 erasure sweeps DELTAS. A user's credential entry is a file in the home and never a delta, so no
// tombstone reaches it — and a report that stayed silent about that would let "settled" imply a
// completeness it does not have. That is H7, at the one surface §36 adds. So the erasure report
// NAMES credentials.json as unswept, and the login door refuses a user whose record has been
// forgotten from the ground even though the credential entry is still on disk.
//
// Two-sided, as every erasure rail must be: the target user cannot log in, AND a named bystander
// still can. This file erases only deltas it created itself, in its own temp home.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  beginLogin,
  bootStore,
  cookieFrom,
  createUser,
  dropHome,
  formTokenFor,
  makeHome,
  postDoor,
  postLogin,
  serveHome,
  signIn,
  storeDeltas,
  testIo,
  type Served,
} from "./user-fixture.js";
import { run } from "../../src/cli/cli.js";
import { CTX_USER, userEntity } from "../../src/server/users.js";
import { readCredentials } from "../../src/server/credentials.js";

vi.setConfig({ testTimeout: 20000 });

const WREN = "the bystander's own password";

let home: string;
let served: Served;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  await createUser(home, "wren", WREN, { operator: false });
  served = await serveHome(home);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

const attempt = async (name: string, password: string): Promise<Response> => {
  const begun = await beginLogin(served.base);
  return postLogin(served.base, name, password, {
    cookie: begun.cookie,
    formToken: begun.formToken,
  });
};

// The delta id of `name`'s user record — the fact in the ground that says the user exists.
const userRecordId = async (name: string): Promise<string> => {
  const entity = userEntity(name);
  type P = { target: { kind: string; entity?: { id: string; context: string } } };
  const hit = (await storeDeltas(home)).find((d) =>
    (d.claims.pointers as readonly P[]).some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity?.id === entity &&
        p.target.entity.context === CTX_USER,
    ),
  );
  if (hit === undefined) throw new Error(`no user record delta for ${name}`);
  return hit.id;
};

describe("the erasure report and the login door agree about what is swept", () => {
  it("(u) the report names credentials.json as a surface it does not sweep", async () => {
    const health = await served.gateway.health();
    // the file BY NAME, and the section that owns it — a report that cites the wrong section sends
    // whoever reads it to the wrong page
    const said = health.unswept.join(" ");
    expect(said).toMatch(/credentials\.json/);
    expect(said).toContain("§36");
    // EVERY unswept file this section adds, not just the first one. A list that reads as an enumeration
    // and is short by one is the H7 shape: a reader takes silence about login-locks.json for coverage.
    expect(said).toMatch(/login-locks\.json/);
    // and the operator reads the same words over HTTP, not a prettier summary
    const res = await fetch(`${served.base}/default/health`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unswept: string[] };
    expect(body.unswept).toEqual(health.unswept);
    expect(body.unswept.join(" ")).toMatch(/credentials\.json/);
  });

  it("(u) every home file §36 writes is named — a new one must be added to the list", async () => {
    // The list is prose, so this is the only way to keep it honest as the section grows: name the files
    // §36 creates in the home, and require each to appear. A future file that skips the report fails here.
    await attempt("myk", "wrong, so login-locks.json exists");
    const said = (await served.gateway.health()).unswept.join(" ");
    // EVERY file in the home, not only the .json ones — a future §36 file with another extension must
    // not slip past a filter. What older sections own is named here, so anything new is §36's to explain.
    const OLDER = ["config.json", "operator.seed", "serving.json", "store.sqlite"];
    const owned = readdirSync(home).filter(
      (f) => !OLDER.includes(f) && !f.startsWith("store.sqlite"),
    );
    // A FLOOR, so the loop cannot pass by checking nothing: both of §36's files must be there to check.
    expect(owned.sort()).toEqual(["credentials.json", "login-locks.json"]);
    for (const name of owned) expect(said, name).toContain(name);
    // and the temp siblings a crashed write leaves behind hold the same bytes, so they are named too
    expect(said).toContain(".tmp");
  });

  it("(u) the ROLE BINDING survives an erase of the user record, and the help says so", async () => {
    // A user is two deltas and erasure is per delta. This is the leftover a "forget me" request is
    // actually about: the role binding carries the user name inside its entity id. The door is shut
    // either way — `roleOf` needs the user record — so the honest move is to name the second delta
    // rather than let the operator believe one erasure finished the job.
    const record = await userRecordId("myk");
    await served.gateway.erase(record);
    expect((await attempt("myk", PASSWORD)).status).toBe(401);

    const surviving = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(`"${userEntity("myk")}"`),
    );
    expect(surviving.length).toBeGreaterThan(0); // the role binding is still there, by name
    expect(surviving.map((d) => d.id)).not.toContain(record);

    // the CLI help tells the operator there is a second delta, rather than implying one erase is all
    const io = testIo();
    await run(["user", "--help"], io.io);
    expect(io.out.join("\n")).toMatch(/TWO deltas/);
    expect(io.out.join("\n")).toMatch(/own erasure/);

    // and erasing that one too leaves nothing carrying the name
    for (const d of surviving) await served.gateway.erase(d.id);
    const left = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(`"${userEntity("myk")}"`),
    );
    expect(left).toEqual([]);
    // the bystander is untouched throughout
    expect((await attempt("wren", WREN)).status).toBe(200);
  });

  it("(u) an already-open session closes when the ground forgets its user — in this exact order", async () => {
    // The fresh-login rails cannot see this: they sign in AFTER the erase. A session already open, and a
    // token already minted, are the state that outlives an erasure.
    //
    // THE ORDER IS THE ASSERTION. An erasure does not reach the server's memory, and this file's own
    // report says so — so asserting a dead token straight after the erase would claim a completeness the
    // report disclaims, and it would pass only by accident of whatever request ran first. What is true is
    // narrower and worth pinning exactly: the token OUTLIVES the erase; the next touch of a login door
    // re-reads the ground, finds no user, and drops the session; and THAT is what retires the token.
    const session = await signIn(served.base, "myk", PASSWORD);
    const minted = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(minted.status).toBe(200);
    const { token } = (await minted.json()) as { token: string };
    const opensDoor = (): Promise<Response> =>
      fetch(`${served.base}/default/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
    expect((await opensDoor()).status).toBe(200);

    const bystander = await signIn(served.base, "wren", WREN);
    await served.gateway.erase(await userRecordId("myk"));

    // FIRST: the token still works. The erase reached the ground, not this process's memory.
    expect((await opensDoor()).status).toBe(200);

    // THEN: the session's next touch of a login door re-reads the ground and drops it
    const refused = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(refused.status).toBe(401);

    // AND SO: the drop revoked what the session had minted
    expect((await opensDoor()).status).toBe(401);

    // the bystander's live session is untouched throughout — the erase reached one user, not the door
    expect(await formTokenFor(served.base, bystander.cookie)).not.toBe("");
  });

  it("(u) a forgotten user record refuses the login, while the credential entry is still on disk", async () => {
    expect((await attempt("myk", PASSWORD)).status).toBe(200);

    await served.gateway.erase(await userRecordId("myk"), {
      reason: "the user asked to be forgotten",
    });

    // the ground no longer says myk is a user, so the door refuses — even though the secret survives
    expect(readCredentials(home).users["myk"]).toBeDefined();
    expect(readFileSync(join(home, "credentials.json"), "utf8")).toMatch(/myk/);
    const refused = await attempt("myk", PASSWORD);
    expect(refused.status).toBe(401);
    expect(cookieFrom(refused)).toBeUndefined();

    // the bystander is untouched: over-purging is the failure that matters most here
    const wren = await attempt("wren", WREN);
    expect(wren.status).toBe(200);
    expect(cookieFrom(wren)).toBeDefined();
  });

  it("(u) the report says nothing was swept that was not, and stays honest after the erase", async () => {
    const erased = await userRecordId("myk");
    await served.gateway.erase(erased);
    const health = await served.gateway.health();
    expect(health.unswept.join(" ")).toMatch(/credentials\.json/);
    // The COMPUTED half of the report, which is the half a false completion would live in. `unswept` is
    // a constant and cannot go wrong; `settled`, `pending` and `outstanding` can.
    expect(health.erasure.settled).toBe(true);
    expect(health.erasure.pending).toBe(0);
    expect(health.erasure.outstanding).toEqual([]);
    expect(health.erasure.unproven).toBe(false);
    expect(health.erasure.promised).toBeGreaterThan(0);
    expect(health.status).toBe("ok");

    // delta level: the record is gone from the store and the bystander's is not
    await expect(userRecordId("myk")).rejects.toThrow(/no user record/);
    expect(await userRecordId("wren")).toBeTruthy();
    // and through the probe the health report itself uses. NOT a byte scan: `holds` is a row lookup that
    // is tier-aware where `deltasSince` is not, and the byte guarantee below it belongs to the sqlite
    // driver's own secure-delete machinery. What this pins is that the store no longer HAS the row.
    // (The id STRING is still in the file, in the tombstone — a tombstone names what it forgot.)
    expect(await served.gateway.backend.holds(erased)).toBe(false);
    expect(await served.gateway.backend.holds(await userRecordId("wren"))).toBe(true);
  });
});
