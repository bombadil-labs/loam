// SPEC §30 criterion 17 — `loam artifact pack` is a THIN CLIENT of the door, and nothing more.
//
// The point is one shape for every door: the CLI writes bytes byte-identical to the door's body, and
// refuses with the door's own message on every refusal. A CLI that rephrased a refusal — or worse, that
// read a file and built the page itself — would be a second source of truth about what a renderer may be
// published as, and it would keep emitting a page whose binding, schema version, or declaration had been
// struck. Withdrawal must be live, so the emission is re-derived from `readRenderers` on every call.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { run, type IO } from "../../src/cli/cli.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const BUNDLE = 'export default (n) => "<p>h=" + n.view.height + "</p>";';

let handle: ServerHandle;
let base: string;
let gateway: Gateway;
let dir: string;

// The CLI's IO: two arrays, and the functions that fill them.
const io = (): { io: IO; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "loam-artifact-"));
  gateway = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
  ]);
  await gateway.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gateway.publishRegistration(
    PLANT,
    PLANT_POLICY,
    [FERN],
    undefined,
    undefined,
    undefined,
    PLANT_WRITABLE,
  );
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: BUNDLE,
  });
  await gateway.publishRenderer({
    route: "pinned",
    schema: "Plant",
    version: 1,
    consumes: ["height"],
    bundle: BUNDLE,
  });
  await gateway.declareArtifact(["plant", "pinned"]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true }, "alice-token": { actor: "a1".repeat(32) } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const cli = async (
  args: readonly string[],
): Promise<{ code: number; out: string[]; err: string[] }> => {
  const { io: sink, out, err } = io();
  const code = await run(args, sink);
  return { code: code as number, out, err };
};

const doorBody = async (query: string, token = "op-token"): Promise<string> =>
  (
    await fetch(`${base}/garden/artifact/plant/${encodeURIComponent(FERN)}${query}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).text();

describe("§30 criterion 17: the CLI is a thin client of the door", () => {
  it("writes bytes BYTE-IDENTICAL to the door's body", async () => {
    const out = join(dir, "page.html");
    const { code, err } = await cli([
      "artifact",
      "pack",
      `garden/plant/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
      "--out",
      out,
    ]);
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(await doorBody("?connector=My+Loam"));
  });

  it("reports the manifest and the capability statement the door derived", async () => {
    const { out } = await cli([
      "artifact",
      "pack",
      `garden/plant/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
      "--out",
      join(dir, "p2.html"),
    ]);
    expect(out.join("\n")).toContain("tools: loam_query,loam_mutate");
    expect(out.join("\n")).toContain("This app reads the lens");
  });

  it("without --out, the page goes to stdout", async () => {
    const { out } = await cli([
      "artifact",
      "pack",
      `garden/plant/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
    ]);
    expect(out.join("\n")).toContain("<!doctype html>");
  });

  it("refuses with the door's IDENTICAL message on every refusal", async () => {
    // The refusals this route can reach from a CLI invocation: an unusable connector name
    // (criterion 27), an undeclared route (criterion 2), and a version pin (criterion 12). Each is
    // compared against the door's own words rather than a rephrasing.
    const cases: ReadonlyArray<readonly [string, readonly string[], string]> = [
      ["an empty connector", [`garden/plant/${FERN}`, "--connector", ""], "?connector="],
      [
        "an over-length connector",
        [`garden/plant/${FERN}`, "--connector", "x".repeat(129)],
        `?connector=${"x".repeat(129)}`,
      ],
    ];
    for (const [why, args, query] of cases) {
      const { code, err } = await cli([
        "artifact",
        "pack",
        ...args,
        "--url",
        base,
        "--token",
        "op-token",
      ]);
      expect(code, why).toBe(2);
      const said = JSON.parse(await doorBody(query)) as { errors: string[] };
      expect(err[0], why).toBe(`artifact pack: ${said.errors[0]}`);
    }
  });

  it("relays the pinned-binding refusal, naming the gap rather than packing the latest", async () => {
    const { code, err } = await cli([
      "artifact",
      "pack",
      `garden/pinned/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
    ]);
    expect(code).toBe(2);
    expect(err[0]).toMatch(/pins a frozen reading, and MCP has no pinned read/);
  });

  it("relays the undeclared-route refusal", async () => {
    await gateway.publishRenderer({
      route: "quiet",
      schema: "Plant",
      consumes: ["height"],
      bundle: BUNDLE,
    });
    const { code, err } = await cli([
      "artifact",
      "pack",
      `garden/quiet/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
    ]);
    expect(code).toBe(2);
    expect(err[0]).toMatch(/not declared publishable/);
  });

  it("a NON-OPERATOR token gets the door's nonexistence, relayed as a refusal", async () => {
    // The CLI cannot soften this: to a token-bearing stranger the door is byte-identical to an
    // unknown verb, so what comes back is "no such surface" and the CLI says exactly that.
    const { code, err } = await cli([
      "artifact",
      "pack",
      `garden/plant/${FERN}`,
      "--url",
      base,
      "--token",
      "alice-token",
      "--connector",
      "My Loam",
    ]);
    expect(code).toBe(2);
    expect(err[0]).toMatch(/no such surface/);
  });

  it("refuses its own usage errors before it touches the network", async () => {
    for (const [args, pattern] of [
      [["artifact", "nope"], /unknown subcommand/],
      [["artifact", "pack"], /wants a target/],
      [["artifact", "pack", "garden/plant"], /is not <mount>\/<route>\/<entity>/],
      [["artifact", "pack", `garden/plant/${FERN}`, "--token", "t"], /wants --connector/],
    ] as ReadonlyArray<readonly [string[], RegExp]>) {
      const { code, err } = await cli(args);
      expect(code).toBe(2);
      expect(err.join("\n")).toMatch(pattern);
    }
  });

  it("carries BOTH acknowledgement flags as booleans, and they reach the door", async () => {
    // A boolean flag missing from the parser's `booleans` set eats the next argument as its value,
    // which turns `--acknowledge-writable --connector X` into a silent refusal about a missing
    // connector. Both flags are driven here, and the door's own acknowledgement is what proves they
    // arrived: without them the narrowed-writable pack refuses.
    await gateway.publishRenderer({
      route: "narrow",
      schema: "Plant",
      consumes: ["height"],
      writable: ["height"],
      pen: "editor",
      bundle: BUNDLE,
    });
    await gateway.declareArtifact(["narrow"]);
    const refused = await cli([
      "artifact",
      "pack",
      `garden/narrow/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
    ]);
    expect(refused.code).toBe(2);
    expect(refused.err[0]).toMatch(/writes as the pen "editor"/);
    const packed = await cli([
      "artifact",
      "pack",
      `garden/narrow/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
      "--acknowledge-pen",
      "--acknowledge-writable",
    ]);
    expect(packed.err).toEqual([]);
    expect(packed.code).toBe(0);
    expect(packed.out.join("\n")).toContain("<!doctype html>");
    // …and dropping just ONE of them still refuses, so neither flag is doing the other's work.
    const half = await cli([
      "artifact",
      "pack",
      `garden/narrow/${FERN}`,
      "--url",
      base,
      "--token",
      "op-token",
      "--connector",
      "My Loam",
      "--acknowledge-pen",
    ]);
    expect(half.code).toBe(2);
    expect(half.err[0]).toMatch(/narrows writes to \[height\]/);
  });

  it("appears in the top-level help and carries its own manual", async () => {
    const top = await cli(["--help"]);
    expect(top.out.join("\n")).toContain("artifact");
    const own = await cli(["artifact", "--help"]);
    const text = own.out.join("\n");
    expect(text).toContain("loam artifact pack <mount>/<route>/<entity>");
    expect(text).toContain("--connector");
    expect(text).toMatch(/THIN CLIENT of the gateway's own pack door/);
  });
});
