import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

vi.setConfig({ testTimeout: 20_000 });

let home: string;
let aux: string;
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
    return readRegistrations(g.reactor, Date.now(), g.operator)
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

const bespoke = (program: string, lens: string): string =>
  JSON.stringify({
    hyperschema: {
      name: program,
      alg: 1,
      body: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "annotate", in: "input" },
        },
      },
    },
    schema: {
      name: lens,
      alg: 1,
      props: { name: { pick: { order: { byTimestamp: "desc" } } } },
      default: { pick: { order: { byTimestamp: "desc" } } },
    },
    roots: [],
    writable: ["name"],
  });

const STALENESS = /waits for a restart/;
const servingRecord = (pid: number): void => {
  writeFileSync(
    join(home, "serving.json"),
    `${JSON.stringify({ pid, url: "http://127.0.0.1:0", store: resolve(storePath(home, undefined)), startedAt: Date.now() })}\n`,
  );
};
const deadPid = (): number => {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid ?? 999999;
};

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

  it("injected seams alone cannot trigger the flow — flagless piped init stays bare", async () => {
    let asked = 0;
    const code = await run(["init", "--home", home], io(), {
      readInput: () => {
        asked += 1;
        return Promise.resolve("ada");
      },
      readSecret: () => {
        asked += 1;
        return Promise.resolve("s3cret");
      },
    });
    expect(code).toBe(0);
    expect(asked).toBe(0);
    expect(out).toEqual([`loam: initialized ${home}\n  operator ${operatorOf(home)}`]);
    expect(readdirSync(home).sort()).toEqual(["config.json", "operator.seed"]);
  });
});

describe("§54(a) --user + --password-file on a fresh home", () => {
  it("mints operator + config, creates the user with the operator role, stocks the full shelf, prints the serve command", async () => {
    const code = await run(
      ["init", "--home", home, "--user", "ada", "--password-file", passwordFile("s3cret\n")],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(0);

    expect(existsSync(join(home, "operator.seed"))).toBe(true);
    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(entryFor(readCredentials(home), "ada")).toBeDefined();

    const g = await ground(home);
    try {
      expect(rolesOf(g.reactor, g.operator, Date.now(), "ada").has("operator")).toBe(true);
    } finally {
      await g.close();
    }
    expect(await boundLenses(home)).toEqual(ALL_LENSES);

    const printed = out.join("\n");
    expect(printed.match(/stocked shallow-person/g)).toHaveLength(1);
    expect(printed).not.toContain("already bound");

    expect(printed).toContain(`loam serve --http --home ${home}`);
    expect(printed).toContain("/login");
    expect(printed).toContain("ada");
  });
});

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

  it("--user alone in a pipe refuses, exit 2, naming --password-file, writing nothing", async () => {
    const code = await run(["init", "--home", home, "--user", "ada"], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/--password-file/);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(existsSync(join(home, "operator.seed"))).toBe(false);
  });
});

describe("§54(d) explicit skips", () => {
  it("--no-user --no-stock: both notes print, no credential lands, and the virgin door still answers GraphQL", async () => {
    const code = await run(["init", "--home", home, "--no-user", "--no-stock"], io());
    expect(code).toBe(0);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
    const printed = out.join("\n");
    expect(printed).toMatch(/\/login stays dark until .*loam user create/);
    expect(printed).toMatch(/surface is empty until .*loam register/);

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

  it("a cancelled name prompt is exit 1 with the mint already disclosed, not a silent 0", async () => {
    const code = await run(["init", "--home", home, "--no-stock"], io(), {
      readInput: () => Promise.reject(new Error("cancelled")),
      readSecret: () => Promise.resolve("s3cret"),
      scrypt: CHEAP_SCRYPT,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/cancelled/);
    expect(out.join("\n")).toContain(`loam: initialized ${home}`);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  });
});

describe("§54(f) --stock person,event", () => {
  it("binds person, event, and shallow-person via deps; the door serves them and refuses note", async () => {
    const code = await run(["init", "--home", home, "--stock", "person,event", "--no-user"], io());
    expect(code).toBe(0);

    expect(await boundLenses(home)).toEqual(["Event", "Person", "ShallowPerson"]);

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
    expect(readFileSync(join(home, "operator.seed"), "utf8")).toBe(seed);
    expect(err.join("\n")).toMatch(/ada already has a credential/);
    const printed = out.join("\n");
    expect(printed).toContain("note already bound — skipped");
    expect(printed).not.toContain("stocked note");
    expect(printed).not.toContain("the next step");
  });
});

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

  it("refuses an absent file with the path named, in init's own sentence, before anything lands", async () => {
    const missing = join(aux, "no-such-file");
    const code = await run(
      ["init", "--home", home, "--user", "ada", "--password-file", missing, "--no-stock"],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(1);
    const printed = err.join("\n");
    expect(printed).toContain(missing);
    expect(printed).toMatch(/cannot read --password-file/);
    expect(printed).toMatch(/Nothing was done/);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  it("a lone trailing \\r is stripped too — a \\r no login form can type never enters the hash", async () => {
    const code = await run(
      [
        "init",
        "--home",
        home,
        "--user",
        "ada",
        "--password-file",
        passwordFile("pw\r"),
        "--no-stock",
      ],
      io(),
      { scrypt: CHEAP_SCRYPT },
    );
    expect(code).toBe(0);
    const entry = entryFor(readCredentials(home), "ada");
    expect(await verifyPassword(entry, "pw")).toBe(true);
    expect(await verifyPassword(entry, "pw\r")).toBe(false);
  });

  it("an empty or whitespace-only file refuses, naming the file, before anything lands", async () => {
    for (const content of ["", "   \n", "\r\n"]) {
      out.length = 0;
      err.length = 0;
      const code = await run(
        [
          "init",
          "--home",
          home,
          "--user",
          "ada",
          "--password-file",
          passwordFile(content),
          "--no-stock",
        ],
        io(),
        { scrypt: CHEAP_SCRYPT },
      );
      expect(code, JSON.stringify(content)).toBe(2);
      expect(err.join("\n"), JSON.stringify(content)).toContain(join(aux, "pw"));
      expect(existsSync(join(home, "config.json")), JSON.stringify(content)).toBe(false);
    }
  });
});

describe("§54(f) the selection's own refusals", () => {
  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ["note,,person", /empty entry/],
    ["all,person", /whole shelf/],
    ["nope", /no stock schema named "nope"/],
  ];
  for (const [value, message] of cases) {
    it(`--stock ${value} refuses, exit 2, writing nothing`, async () => {
      const code = await run(["init", "--home", home, "--stock", value, "--no-user"], io());
      expect(code).toBe(2);
      expect(err.join("\n")).toMatch(message);
      expect(existsSync(join(home, "config.json"))).toBe(false);
      expect(existsSync(join(home, "operator.seed"))).toBe(false);
    });
  }
});

describe("§54 the shelf pass meets a bespoke reading", () => {
  it("a stock lens under a foreign program refuses whole — nothing from this run lands", async () => {
    await run(["init", "--home", home], io());
    const rival = join(aux, "my-shallow.json");
    writeFileSync(rival, bespoke("MyShallow", "ShallowPerson"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["init", "--home", home, "--stock", "org", "--no-user"], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/would evict your reading, so nothing was installed/);
    expect(await boundLenses(home)).toEqual(["ShallowPerson"]);
  });

  it("a same-program divergent reading is skipped and warned about, by body", async () => {
    await run(["init", "--home", home], io());
    const rival = join(aux, "their-shallow.json");
    writeFileSync(rival, bespoke("ShallowPerson", "ShallowPerson"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(
      ["init", "--home", home, "--stock", "shallow-person", "--no-user"],
      io(),
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("shallow-person already bound — skipped");
    const warned = err.join("\n");
    expect(warned).toMatch(/shallow-person is bound to a reading that is not stock ShallowPerson@/);
    expect(warned).toMatch(/differs: body/);
  });
});

describe("§54 the shelf pass under a live server", () => {
  it("warns beside a live-pid serving record; a fresh home and a dead pid stay silent", async () => {
    expect(await run(["init", "--home", home, "--stock", "note", "--no-user"], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(STALENESS);

    servingRecord(process.pid);
    out.length = 0;
    err.length = 0;
    expect(await run(["init", "--home", home, "--stock", "note", "--no-user"], io())).toBe(0);
    expect(out.join("\n")).toContain("note already bound — skipped");
    expect(err.join("\n")).toMatch(STALENESS);

    servingRecord(deadPid());
    out.length = 0;
    err.length = 0;
    expect(await run(["init", "--home", home, "--stock", "note", "--no-user"], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(STALENESS);
  });
});

describe("§54 a rival program body under the shelf pass", () => {
  it("the substrate's refusal surfaces as exit 1, and no ready line is crowned", async () => {
    await run(["init", "--home", home], io());
    const rival = join(aux, "rival-note.json");
    writeFileSync(rival, bespoke("Note", "MyNote"));
    expect(await run(["register", rival, "--home", home], io())).toBe(0);

    out.length = 0;
    err.length = 0;
    const code = await run(["init", "--home", home, "--stock", "note", "--no-user"], io());
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/two bindings carry DIFFERENT bodies/);
    const printed = out.join("\n");
    expect(printed).not.toContain("the store is ready");
    expect(printed).not.toContain("the next step:");
  });
});

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

  it("a closed stream (the Ctrl-D shape) rejects 'cancelled' rather than never settling", async () => {
    const fake = new FakeInput();
    Object.defineProperty(process, "stdin", { value: fake, configurable: true });
    process.stdout.write = (): boolean => true;
    const answer = promptLine("a name: ");
    fake.emit("end");
    await expect(answer).rejects.toThrow(/cancelled/);
  });
});
