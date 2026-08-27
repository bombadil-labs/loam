// §54 — the guided init (T249), driven end to end through `run()`. One command carries a newcomer
// from `npm i -g` to a living store: operator, first user (operator role), the stock shelf, and
// the printed next step — while the flagless piped init every existing rail calls stays
// byte-for-byte today's bare init.
//
// TWO LEVELS, as P3 requires. Object level: what the CLI prints, and what the HTTP door serves
// (the introspected surface, the virgin-store refusal). Delta level: the store reopened cold —
// which lenses bind, which roles the ground resolves, what the credential file holds.
//
// NAMED GAPS. The TTY-true side of the trigger is pinned at the exported pure predicate, and
// promptLine's terminal half against a fake stdin (prompt.test.ts's idiom) — no real pty runs
// here, and test/cli/prompt.test.ts owns promptSecret's own terminal contract. The staleness
// warning under a concurrently running server is the user-create machinery's own, asserted in
// its own rails, not re-asserted here.

import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGuidedInit, run } from "../../src/cli/cli.js";
import { promptLine } from "../../src/cli/prompt.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf, readRegistrations } from "../../src/gateway/registration.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import {
  entryFor,
  readCredentials,
  verifyPassword,
  type ScryptParams,
} from "../../src/server/credentials.js";
import { rolesOf } from "../../src/server/users.js";

// Serve boots real HTTP servers and user create pays a real (cheapened) scrypt — the same
// hang-guard the sibling CLI rails carry.
vi.setConfig({ testTimeout: 20_000 });

let home: string;
let aux: string; // password files live OUTSIDE the home, so (b)'s two-file assertion stays exact
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-guided-init-"));
  aux = mkdtempSync(join(tmpdir(), "loam-guided-aux-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(aux, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const operatorOf = (h: string): string =>
  (JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { operator: string }).operator;

// A short-lived Gateway over the same store the CLI just wrote — never held open across `run()`.
async function ground(h: string): Promise<{
  reactor: Gateway["reactor"];
  operator: string;
  close: () => Promise<void>;
}> {
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(h)),
    assembleGenesis({ operatorSeed: readSeed(h) }),
  );
  return { reactor: gateway.reactor, operator: gateway.operator!, close: () => gateway.close() };
}

async function boundLenses(h: string): Promise<string[]> {
  const g = await ground(h);
  try {
    return readRegistrations(g.reactor, g.operator)
      .map((r) => lensOf(r) as string)
      .sort();
  } finally {
    await g.close();
  }
}

async function detached(h: string): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(["serve", "--http", "--home", h, "--port", "0", "--token", "t"], io(), {
    detach: true,
  });
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

interface GqlBody {
  data?: Record<string, unknown>;
  errors?: unknown[];
}

async function gql(url: string, query: string): Promise<GqlBody> {
  const res = await fetch(`${url}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ query }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as GqlBody;
}

const passwordFile = (content: string): string => {
  const path = join(aux, "pw");
  writeFileSync(path, content);
  return path;
};

const ALL_LENSES = ["Event", "Note", "Org", "Person", "Post", "ShallowPerson"];

// ---------------------------------------------------------------------------------------------
// The trigger — the pure predicate, both sides (criteria b and c pin the behavior; this pins the
// decision itself, including the TTY-true side no piped test can reach).

describe("§54 the trigger (isGuidedInit)", () => {
  const parsed = (
    flags: ReadonlyArray<readonly [string, string]> = [],
    booleans: string[] = [],
  ) => ({
    flags: new Map(flags.map(([k, v]) => [k, v])),
    booleans: new Set(booleans),
  });

  it("flagless with no TTY stays bare — and --home/--seed are not guided flags", () => {
    expect(isGuidedInit(parsed(), false)).toBe(false);
    expect(
      isGuidedInit(
        parsed([
          ["home", "h"],
          ["seed", "11".repeat(32)],
        ]),
        false,
      ),
    ).toBe(false);
  });

  it("a terminal alone enters the guided flow", () => {
    expect(isGuidedInit(parsed(), true)).toBe(true);
  });

  it("each guided flag enters the guided flow without a terminal", () => {
    expect(isGuidedInit(parsed([["user", "ada"]]), false)).toBe(true);
    expect(isGuidedInit(parsed([["password-file", "f"]]), false)).toBe(true);
    expect(isGuidedInit(parsed([["stock", "all"]]), false)).toBe(true);
    expect(isGuidedInit(parsed([], ["no-user"]), false)).toBe(true);
    expect(isGuidedInit(parsed([], ["no-stock"]), false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The shelf listing in --help: the column is sized to the longest name, so no name concatenates
// with its summary (help-columns' defect, found live here — `shallow-persona person read …`).

describe("§54 the shelf listing in --help", () => {
  it("no shelf name concatenates with its summary — init and register alike", async () => {
    for (const command of ["init", "register"]) {
      out.length = 0;
      err.length = 0;
      const code = await run([command, "--help"], io());
      expect(code, command).toBe(0);
      const printed = [...out, ...err].join("\n");
      expect(printed, command).not.toContain("shallow-persona");
      expect(printed, command).toMatch(/shallow-person\s{2,}a person read shallow/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (b) BARE COMPAT — the literal pre-§54 strings, the exact two files, no prompts, exit 0.

describe("§54(b) the bare init survives byte-for-byte", () => {
  it("flagless piped init: today's two files, today's output lines, nothing on stderr", async () => {
    const code = await run(["init", "--home", home], io());
    expect(code).toBe(0);
    const operator = operatorOf(home);
    expect(out).toEqual([`loam: initialized ${home}\n  operator ${operator}`]);
    expect(err).toEqual([]);
    expect(readdirSync(home).sort()).toEqual(["config.json", "operator.seed"]);

    out.length = 0;
    const again = await run(["init", "--home", home], io());
    expect(again).toBe(0);
    expect(out).toEqual([`loam: ${home} already initialized\n  operator ${operator}`]);
    expect(err).toEqual([]);
    expect(readdirSync(home).sort()).toEqual(["config.json", "operator.seed"]);
  });
});

// ---------------------------------------------------------------------------------------------
// (a) GUIDED, non-interactive — the whole story in one piped command.

describe("§54(a) --user + --password-file on a fresh home", () => {
  it("mints operator + config, creates the user with the operator role, stocks the full shelf, prints the serve command", async () => {
    const code = await run(
      ["init", "--home", home, "--user", "ada", "--password-file", passwordFile("s3cret\n")],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(0);

    // bytes: the identity pair, and a credential for ada alone
    expect(existsSync(join(home, "operator.seed"))).toBe(true);
    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(entryFor(readCredentials(home), "ada")).toBeDefined();

    // ground: ada holds the operator role, and all six shelf lenses bind
    const g = await ground(home);
    try {
      expect(rolesOf(g.reactor, g.operator, "ada").has("operator")).toBe(true);
    } finally {
      await g.close();
    }
    expect(await boundLenses(home)).toEqual(ALL_LENSES);

    // the report: shallow-person arrives via deps, exactly once, nothing skipped on a fresh home
    const printed = out.join("\n");
    expect(printed.match(/stocked shallow-person/g)).toHaveLength(1);
    expect(printed).not.toContain("already bound");

    // the next step: the serve command for THIS home, and the login path
    expect(printed).toContain(`loam serve --http --home ${home}`);
    expect(printed).toContain("/login");
    expect(printed).toContain("ada");
  });
});

// ---------------------------------------------------------------------------------------------
// (c) RULE 1 — the name is never invented.

describe("§54(c) a guided flag with no way to a name", () => {
  it("--stock all alone in a pipe refuses, exit 2, naming both exits, writing nothing", async () => {
    const code = await run(["init", "--home", home, "--stock", "all"], io());
    expect(code).toBe(2);
    const printed = err.join("\n");
    expect(printed).toMatch(/--user <name>/);
    expect(printed).toMatch(/--no-user/);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(existsSync(join(home, "operator.seed"))).toBe(false);
  });

  it("the same command plus --no-user succeeds and stocks the shelf with no user", async () => {
    const code = await run(["init", "--home", home, "--stock", "all", "--no-user"], io());
    expect(code).toBe(0);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
    expect(await boundLenses(home)).toEqual(ALL_LENSES);
  });
});

// ---------------------------------------------------------------------------------------------
// (d) EXPLICIT SKIPS — each skip says what it costs; contradictions refuse.

describe("§54(d) explicit skips", () => {
  it("--no-user --no-stock: both notes print, no credential lands, and the virgin door still answers GraphQL", async () => {
    const code = await run(["init", "--home", home, "--no-user", "--no-stock"], io());
    expect(code).toBe(0);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
    const printed = out.join("\n");
    expect(printed).toMatch(/\/login stays dark until .*loam user create/);
    expect(printed).toMatch(/surface is empty until .*loam register/);

    // door: the empty surface is the honest refusal, served as GraphQL, not a dead socket
    const handle = await detached(home);
    try {
      const body = await gql(handle.url, "{ __typename }");
      expect(JSON.stringify(body.errors)).toMatch(/nothing is registered/);
    } finally {
      await handle.close();
    }
  });

  it("contradictory pairs refuse, exit 2, writing nothing", async () => {
    for (const args of [
      ["--user", "ada", "--no-user"],
      ["--stock", "note", "--no-stock"],
      ["--password-file", "somewhere", "--no-user"],
    ]) {
      out.length = 0;
      err.length = 0;
      const code = await run(["init", "--home", home, ...args], io());
      expect(code, args.join(" ")).toBe(2);
      expect(err.join("\n"), args.join(" ")).toMatch(/contradict/);
      expect(existsSync(join(home, "config.json")), args.join(" ")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (e) TTY PROMPTS — through the injected seam, which is the same seam the terminal path uses.

describe("§54(e) the prompt seams", () => {
  it("asks the name once and the password twice, and creates the user", async () => {
    const nameAsks: string[] = [];
    const secretAsks: string[] = [];
    const code = await run(["init", "--home", home, "--no-stock"], io(), {
      readInput: (prompt) => {
        nameAsks.push(prompt);
        return Promise.resolve("ada");
      },
      readSecret: (prompt) => {
        secretAsks.push(prompt);
        return Promise.resolve("s3cret");
      },
      scrypt: CHEAP_SCRYPT,
    });
    expect(code).toBe(0);
    expect(nameAsks).toHaveLength(1);
    expect(nameAsks[0]).toMatch(/name/);
    expect(secretAsks).toHaveLength(2);
    expect(entryFor(readCredentials(home), "ada")).toBeDefined();
    expect(out.join("\n")).toContain("created ada with the operator role");
  });

  it("refuses an empty name, exit 2, and writes no credential", async () => {
    const code = await run(["init", "--home", home, "--no-stock"], io(), {
      readInput: () => Promise.resolve(""),
      readSecret: () => Promise.resolve("s3cret"),
      scrypt: CHEAP_SCRYPT,
    });
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/a user name is required/);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  });

  it("refuses mismatched passwords by the user-create machinery's own message", async () => {
    const answers = ["one", "two"];
    const code = await run(["init", "--home", home, "--no-stock"], io(), {
      readInput: () => Promise.resolve("ada"),
      readSecret: () => Promise.resolve(answers.shift() ?? ""),
      scrypt: CHEAP_SCRYPT,
    });
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/did not match/);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// (f) SELECTION — exactly the named entries plus their deps, and nothing else.

describe("§54(f) --stock person,event", () => {
  it("binds person, event, and shallow-person via deps; the door serves them and refuses note", async () => {
    const code = await run(["init", "--home", home, "--stock", "person,event", "--no-user"], io());
    expect(code).toBe(0);

    // delta level: exactly the selection plus its closure, nothing else
    expect(await boundLenses(home)).toEqual(["Event", "Person", "ShallowPerson"]);

    // door level: the surface serves the three and refuses the absent shape
    const handle = await detached(home);
    try {
      const shape = await gql(handle.url, "{ __schema { queryType { fields { name } } } }");
      const fields = (
        (shape.data?.["__schema"] as { queryType: { fields: Array<{ name: string }> } }).queryType
          .fields ?? []
      ).map((f) => f.name);
      expect(fields).toEqual(expect.arrayContaining(["person", "event", "shallowPerson"]));
      expect(fields).not.toContain("note");

      const refused = await gql(handle.url, '{ note(entity: "note:n") { title } }');
      expect(refused.errors).toBeDefined();
      expect(JSON.stringify(refused.errors)).toContain("note");
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// (g) IDEMPOTENCE — a second guided run keeps the identity, refuses the duplicate, skips the shelf.

describe("§54(g) a second guided run on the same home", () => {
  it("keeps the operator, refuses the duplicate user in user-create's own voice, and skips bound stock", async () => {
    const args = [
      "init",
      "--home",
      home,
      "--user",
      "ada",
      "--password-file",
      passwordFile("s3cret\n"),
      "--stock",
      "note",
    ];
    expect(await run(args, io(), { scrypt: CHEAP_SCRYPT })).toBe(0);
    const seed = readFileSync(join(home, "operator.seed"), "utf8");
    expect(out.join("\n")).toContain("stocked note");

    out.length = 0;
    err.length = 0;
    const again = await run(args, io(), { scrypt: CHEAP_SCRYPT });
    expect(again).toBe(2);
    // the identity survives
    expect(readFileSync(join(home, "operator.seed"), "utf8")).toBe(seed);
    // the duplicate is the user-create machinery's own refusal
    expect(err.join("\n")).toMatch(/ada already has a credential/);
    // and the shelf pass still runs, as the ordinary skip-if-bound install
    const printed = out.join("\n");
    expect(printed).toContain("note already bound — skipped");
    expect(printed).not.toContain("stocked note");
  });
});

// ---------------------------------------------------------------------------------------------
// (h) PASSWORD hygiene — the file is the password, minus its trailing newline; absence refuses;
// the secret never reaches the captured io.

describe("§54(h) --password-file", () => {
  it("uses the content with the trailing newline stripped, and never prints the password", async () => {
    const code = await run(
      [
        "init",
        "--home",
        home,
        "--user",
        "ada",
        "--password-file",
        passwordFile("s3cret\n"),
        "--no-stock",
      ],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(0);
    const entry = entryFor(readCredentials(home), "ada");
    expect(await verifyPassword(entry, "s3cret")).toBe(true);
    expect(await verifyPassword(entry, "s3cret\n")).toBe(false);
    const captured = [...out, ...err].join("\n");
    expect(captured).not.toContain("s3cret");
  });

  it("refuses an absent file with the path named, before anything lands", async () => {
    const missing = join(aux, "no-such-file");
    const code = await run(
      ["init", "--home", home, "--user", "ada", "--password-file", missing, "--no-stock"],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(missing);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// (e)'s terminal half — promptLine, the seam's default. Driven against a fake stdin, the same
// idiom prompt.test.ts uses for promptSecret: every other test here injects `readInput`, so
// without these the terminal path would ship with zero coverage of its own two sides.

class FakeInput extends EventEmitter {
  isTTY = true;
  resume(): void {}
  pause(): void {}
  setEncoding(): void {}
}

describe("§54(e) promptLine — the terminal name prompt", () => {
  const originalStdin = process.stdin;
  let originalWrite: typeof process.stdout.write;
  beforeEach(() => {
    originalWrite = process.stdout.write.bind(process.stdout);
  });
  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    process.stdout.write = originalWrite;
  });

  it("without a terminal it refuses and names the readInput option", async () => {
    await expect(promptLine("a name: ")).rejects.toThrow(/wants a terminal.*readInput/s);
  });

  it("at a terminal it asks in the open and returns the trimmed answer", async () => {
    const fake = new FakeInput();
    Object.defineProperty(process, "stdin", { value: fake, configurable: true });
    const written: string[] = [];
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    };
    const answer = promptLine("a name for the store's first user: ");
    fake.emit("data", "  ada \n");
    await expect(answer).resolves.toBe("ada");
    expect(written.join("")).toContain("a name for the store's first user: ");
  });
});
