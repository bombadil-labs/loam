// SPEC §55 criterion (c) — the container detail page carries the census (T254; the working
// spec at .adlc/specs/55-container-census.md). The page a person reads: physical, linked,
// dark, and the vocabulary bucket, each with its data-census marker; the dark count's
// safe-direction approximation named in the page's own words; and the DASHBOARD tree
// byte-unchanged — the census lives where the scope read is already paid (§55 position 4, H8).
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { signIn } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const OPAL_SEED = "0a".repeat(32);
const OPAL = authorForSeed(OPAL_SEED);

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function seededDoor(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  await op(userClaims("opal", OPERATOR, ts++));
  await op(roleClaims("opal", "operator", OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "opal", trust: "curated", posture: "shared", membership: authoredBy(OPAL) },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, OPAL, "write", OPERATOR, ts++));
  // One dark member: opal writes data no registered lens reads.
  await gateway.append([
    signClaims(
      {
        timestamp: 20_000,
        author: OPAL,
        pointers: [
          {
            role: "note",
            target: {
              kind: "entity",
              entity: { id: "scrap:idea", context: "unregistered-scratch" },
            },
          },
          { role: "text", target: { kind: "primitive", value: "a stray thought" } },
        ],
      } as never,
      OPAL_SEED,
    ),
  ]);
  const home = mkdtempSync(join(tmpdir(), "loam-t254-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { opal: await hashPassword(PASSWORD, CHEAP) } });
  writeUserSeed(home, "opal", OPAL_SEED);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, gateway };
}

const pageOf = async (base: string, session: string, path: string): Promise<string> =>
  (
    await fetch(`${base}${path}`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    })
  ).text();

describe("§55(c) — the detail page carries the census; the dashboard tree does not", () => {
  it("physical, linked, dark and vocabulary render with their markers, and the approximation is named", async () => {
    const { base } = await seededDoor();
    const session = await signIn(base, "opal", PASSWORD);
    const html = await pageOf(base, session, "/admin/container?name=opal");

    expect(html).toContain("Census.");
    // A shared root: the stray is linked, not physical; it is dark; the counts are the page's.
    expect(html).toContain('data-census-physical="0"');
    expect(html).toContain('data-census-linked="1"');
    expect(html).toContain('data-census-dark="1"');
    expect(html).toContain('data-census-vocabulary="0"');
    // The full opening tags, not only the attributes: a mangled bracket inside the template
    // still carries the attribute text, and a person reads tags, not substrings.
    expect(html).toContain("<li data-census-physical=");
    expect(html).toContain("<li data-census-linked=");
    expect(html).toContain("<li data-census-dark=");
    expect(html).toContain("<li data-census-vocabulary=");
    expect(html).toContain("<h2>Census.</h2>");
    // The safe-direction sentence, in the page's own words — a dark count rendered bare would
    // overclaim exactly what the metric cannot know.
    expect(html).toContain("undercount by design");
  });

  it("the dashboard tree is census-free: the numbers live where the scope read is already paid", async () => {
    const { base } = await seededDoor();
    const session = await signIn(base, "opal", PASSWORD);
    const dashboard = await pageOf(base, session, "/admin");
    expect(dashboard).not.toContain("data-census-");
    expect(dashboard).toContain("Your containers");
  });
});
