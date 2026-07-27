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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  beginLogin,
  bootStore,
  cookieFrom,
  createUser,
  dropHome,
  makeHome,
  postLogin,
  serveHome,
  storeDeltas,
  type Served,
} from "./user-fixture.js";
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
    expect(health.unswept.join(" ")).toMatch(/credentials\.json/);
    // and the operator reads the same words over HTTP, not a prettier summary
    const res = await fetch(`${served.base}/default/health`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unswept: string[] };
    expect(body.unswept).toEqual(health.unswept);
    expect(body.unswept.join(" ")).toMatch(/credentials\.json/);
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
    await served.gateway.erase(await userRecordId("myk"));
    const health = await served.gateway.health();
    expect(health.unswept.join(" ")).toMatch(/credentials\.json/);
    // the erase settled at the delta level — the record's bytes are gone from the store
    const gone = await userRecordId("wren"); // the bystander's record is still findable
    expect(gone).toBeTruthy();
    await expect(userRecordId("myk")).rejects.toThrow(/no user record/);
  });
});
