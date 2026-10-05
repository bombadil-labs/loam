import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  COMMAND_PREFIX,
  writeCommandDescription,
  signClaims,
  publishHyperSchemaClaims,
  publishSchemaClaims,
  termHash,
  schemaHash,
  makeNegationClaims,
  makeManifestClaims,
  serializeCommandDelta,
  verifyDelta,
  type Delta,
  type HyperSchema,
  type Schema,
  type Target,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import { openOperatorCommands, type OperatorCommand } from "../../src/gateway/operator-command.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { observed } from "../spike/garden.js";
import { OP, OP_SEED, standSlate } from "./slating.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { budgetClaims } from "../../src/gateway/budget.js";
import { run } from "../../src/cli/cli.js";
import { initHome } from "../../src/cli/config.js";
const FOREIGN = "7b".repeat(32),
  OTHER = "7c".repeat(32);
const ROOT = "trial:subject";
const entity = (id: string): readonly Target[] => [{ kind: "entity", entity: { id } }];
const text = (value: string | number): readonly Target[] => [{ kind: "primitive", value }];
const ref = (id: string): readonly Target[] => [{ kind: "delta", deltaRef: { delta: id } }];
const declarations = (["retain", "evaluate"] as const).map((kind) =>
  writeCommandDescription(OP_SEED, 0, "operation/1", {
    name: entity(COMMAND_PREFIX + kind),
    interpreter: text(COMMAND_PREFIX + kind + "/1"),
    "input-contract": text(COMMAND_PREFIX + kind + "/1"),
    "output-contract": text(COMMAND_PREFIX + "outcome/1"),
    effect: text(kind === "retain" ? "admission" : "none"),
    replay: text("re-evaluate/1"),
    dependencies: text("explicit-support/1"),
  }),
);
const installation = {
  configuration: writeCommandDescription(OP_SEED, 0, "endpoint/1", {
    receiver: entity(OP),
    caller: text(OP),
    installed: declarations.flatMap((d) => ref(d.id)),
    quota: text(1000),
    "max-deltas": text(128),
    "max-bytes": text(1_000_000),
  }),
  declarations,
};
const hyper: HyperSchema = { name: "OriginalHeight", alg: 1, body: entityGatherBody() };
const reading: Schema = {
  name: "OriginalReading",
  alg: 1,
  props: new Map(),
  default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
};
const hyperAct = signClaims(
  publishHyperSchemaClaims(hyper, "foreign:program", authorForSeed(FOREIGN), 0),
  FOREIGN,
);
const readingAct = signClaims(
  publishSchemaClaims(reading, "foreign:reading", authorForSeed(FOREIGN), 0),
  FOREIGN,
);
const evaluation = (head: string): Extract<OperatorCommand, { kind: "evaluate" }> => ({
  kind: "evaluate",
  expectedHead: head,
  at: 100_000,
  root: ROOT,
  hyperschema: hyperAct,
  schema: readingAct,
  hyperschemaPin: termHash(hyper.body),
  schemaPin: schemaHash(reading),
  definitions: [],
  bindings: {},
});
async function fixture(body: (gw: Gateway, path: string, home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "loam-command-")),
    path = join(home, "store.sqlite");
  const gw = await Gateway.boot(
    new SqliteBackend(path),
    assembleGenesis({ operatorSeed: OP_SEED }),
  );
  gw.now = () => 100_000;
  try {
    await body(gw, path, home);
  } finally {
    await gw.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
describe("operator-local portable commands use Loam's real peer", () => {
  it("retains facts then evaluates original foreign definitions and survives reopening", async () =>
    fixture(async (gw, path) => {
      const commands = await openOperatorCommands(gw, installation),
        fact = observed(ROOT, "height", 42, 0, OP_SEED);
      const retained = await commands.run({
        kind: "retain",
        expectedHead: await commands.head(),
        payload: [fact],
      });
      expect(retained.result.status).toBe("completed");
      expect(verifyDelta(retained.outcome)).toBe("verified");
      expect(retained.outcome.claims.author).toBe(OP);
      expect(gw.reactor.get(fact.id)).toEqual(fact);
      const value = await commands.run(evaluation(await commands.head()));
      expect(value.result.view).toEqual({ height: 42 });
      expect(value.result.status).toBe("completed");
      expect(verifyDelta(value.outcome)).toBe("verified");
      expect(hyperAct.claims.author).not.toBe(OP);
      expect(await gw.backend.holds(hyperAct.id)).toBe(false);
      expect(await gw.backend.holds(readingAct.id)).toBe(false);
      await gw.close();
      const reopened = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
      reopened.now = () => 100_000;
      try {
        const fresh = await openOperatorCommands(reopened, installation);
        expect((await fresh.run(evaluation(await fresh.head()))).result.view).toEqual({
          height: 42,
        });
        expect(reopened.reactor.get(fact.id)).toEqual(fact);
      } finally {
        await reopened.close();
      }
    }));
  it("refuses wrong pins and incomplete named definition closure without admitting support", async () =>
    fixture(async (gw) => {
      const commands = await openOperatorCommands(gw, installation);
      await commands.run({
        kind: "retain",
        expectedHead: await commands.head(),
        payload: [observed(ROOT, "height", 42, 0, OP_SEED)],
      });
      const wrong = await commands.run({
        ...evaluation(await commands.head()),
        hyperschemaPin: "1e20" + "00".repeat(32),
      });
      expect(wrong.result.status).toBe("refused");
      expect(wrong.result.body.get("code")).toMatchObject({ v: "pin-mismatch" });
      const indirect: HyperSchema = {
        ...hyper,
        body: { kind: "fix", entity: ROOT, schema: { kind: "name", name: "MissingChild" } },
      };
      const act = signClaims(
        publishHyperSchemaClaims(indirect, "foreign:indirect", authorForSeed(FOREIGN), 0),
        FOREIGN,
      );
      const missing = await commands.run({
        ...evaluation(await commands.head()),
        hyperschema: act,
        hyperschemaPin: termHash(indirect.body),
      });
      expect(missing.result.status).toBe("refused");
      expect(missing.result.body.get("code")).toMatchObject({ v: "definition-closure" });
      expect(await gw.backend.holds(act.id)).toBe(false);
    }));
  it("returns signed head-conflict when an independent SQLite writer advances the peer", async () =>
    fixture(async (gw, path) => {
      const commands = await openOperatorCommands(gw, installation),
        head = await commands.head();
      const other = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
      try {
        await other.append([observed(ROOT, "tag", "bystander", 0, OP_SEED)]);
      } finally {
        await other.close();
      }
      const fact = observed(ROOT, "height", 42, 0, OP_SEED);
      const result = await commands.run({ kind: "retain", expectedHead: head, payload: [fact] });
      expect(result.result.status).toBe("refused");
      expect(result.result.body.get("code")).toMatchObject({ v: "precondition-failed" });
      expect(await gw.backend.holds(fact.id)).toBe(false);
    }));
  it("refuses a real writer collision at the journal CAS without retrying", async () =>
    fixture(async (gw, path) => {
      const commands = await openOperatorCommands(gw, installation);
      const other = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
      const store = gw.peer!.store;
      const original = store.compareAndAppend.bind(store);
      let writes = 0;
      store.compareAndAppend = async (...args) => {
        writes++;
        await other.append([observed(ROOT, "tag", "independent", 0, OP_SEED)]);
        return original(...args);
      };
      const fact = observed(ROOT, "height", 42, 0, OP_SEED);
      try {
        const result = await commands.run({
          kind: "retain",
          expectedHead: await commands.head(),
          payload: [fact],
        });
        expect(result.result.status).toBe("refused");
        expect(result.result.body.get("code")).toMatchObject({ v: "write-conflict" });
        expect(writes).toBe(1);
        expect(await gw.backend.holds(fact.id)).toBe(false);
        expect(
          (await gw.backend.deltasSince(new Set())).some((d) =>
            d.claims.pointers.some(
              (p) => p.target.kind === "primitive" && p.target.value === "independent",
            ),
          ),
        ).toBe(true);
      } finally {
        store.compareAndAppend = original;
        await other.close();
      }
    }));
  it("refuses stale authority after a failed reseat has already adopted the current head", async () =>
    fixture(async (gw, path) => {
      const grant = signClaims(
        grantClaims(STORE_ENTITY, authorForSeed(FOREIGN), "write", OP, 0),
        OP_SEED,
      );
      const bystander = observed(ROOT, "tag", "keep", 1, OP_SEED);
      await gw.append([grant, bystander]);
      const commands = await openOperatorCommands(gw, installation);
      const other = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
      const store = gw.peer!.store;
      const read = store.readJournal.bind(store);
      try {
        await other.erase(grant.id);
        let reads = 0;
        store.readJournal = (id) =>
          ++reads === 2 ? Promise.reject(new Error("temporary journal failure")) : read(id);
        await expect(gw.reseat()).rejects.toThrow("temporary journal failure");
        store.readJournal = read;
        expect(gw.peer!.journal.currentHead()).toBe(await commands.head());
        expect(gw.reactor.get(grant.id)).toBeDefined();
        const fact = observed(ROOT, "height", 42, 0, FOREIGN);
        await expect(
          commands.run({ kind: "retain", expectedHead: await commands.head(), payload: [fact] }),
        ).rejects.toThrow(/stale|refresh/);
        expect(await gw.backend.holds(fact.id)).toBe(false);
        expect(await gw.backend.holds(bystander.id)).toBe(true);
        await gw.refresh();
        expect(gw.reactor.get(grant.id)).toBeUndefined();
      } finally {
        store.readJournal = read;
        await other.close();
      }
    }));
  it("a native write after head observation produces a signed conflict instead of a false stale-gateway fault", async () =>
    fixture(async (gw) => {
      const commands = await openOperatorCommands(gw, installation),
        before = await commands.head();
      const store = gw.peer!.store,
        read = store.readHead.bind(store);
      let race = true;
      const competitor = observed(ROOT, "tag", "native bystander", 0, OP_SEED),
        fact = observed(ROOT, "height", 92, 0, OP_SEED);
      store.readHead = async (peer) => {
        const observed = await read(peer);
        if (race) {
          race = false;
          gw.reactor.ingest(competitor);
          await gw.flush();
        }
        return observed;
      };
      let result: Awaited<ReturnType<typeof commands.run>> | undefined, error: unknown;
      try {
        result = await commands.run({ kind: "retain", expectedHead: before, payload: [fact] });
      } catch (e) {
        error = e;
      }
      expect(await gw.backend.holds(competitor.id)).toBe(true);
      expect(await gw.backend.holds(fact.id)).toBe(false);
      expect(gw.needsJournalRefresh).toBe(false);
      expect(gw.peer!.journal.currentHead()).toBe(await commands.head());
      expect(error).toBeUndefined();
      expect(result!.result.status).toBe("refused");
      expect(verifyDelta(result!.outcome)).toBe("verified");
      expect(result!.result.body.get("code")).toMatchObject({ v: "precondition-failed" });
    }));
  it("refuses an unavailable initial head without bypassing reserved-law guards", async () =>
    fixture(async (gw) => {
      const bystander = observed(ROOT, "tag", "keep", 1, OP_SEED);
      await gw.append([bystander]);
      const commands = await openOperatorCommands(gw, installation),
        chosen = await commands.head(),
        store = gw.peer!.store,
        readHead = store.readHead.bind(store);
      let observations = 0;
      store.readHead = async (id) => (++observations === 1 ? { status: "missing" } : readHead(id));
      const grant = signClaims(
        grantClaims(STORE_ENTITY, authorForSeed(OTHER), "write", OP, 0),
        OP_SEED,
      );
      try {
        await expect(
          commands.run({ kind: "retain", expectedHead: chosen, payload: [grant] }),
        ).rejects.toThrow(/head unavailable/);
        expect(await gw.backend.holds(grant.id)).toBe(false);
        expect(await gw.backend.holds(bystander.id)).toBe(true);
        expect(await readHead(OP)).toEqual({ status: "head", head: chosen });
      } finally {
        store.readHead = readHead;
      }
    }));
  it("refuses an unavailable head reread while reconciliation remains pending", async () =>
    fixture(async (gw, path) => {
      const grant = signClaims(
          grantClaims(STORE_ENTITY, authorForSeed(OTHER), "write", OP, 0),
          OP_SEED,
        ),
        bystander = observed(ROOT, "tag", "keep", 1, OP_SEED);
      await gw.append([grant, bystander]);
      const commands = await openOperatorCommands(gw, installation);
      const other = await Gateway.open(new SqliteBackend(path), { seed: OP_SEED });
      other.now = () => 100_000;
      try {
        await other.erase(grant.id);
      } finally {
        await other.close();
      }
      const store = gw.peer!.store,
        readJournal = store.readJournal.bind(store);
      let reads = 0;
      store.readJournal = async (id) => {
        if (++reads === 2) throw new Error("temporary journal failure");
        return readJournal(id);
      };
      try {
        await expect(gw.reseat()).rejects.toThrow("temporary journal failure");
      } finally {
        store.readJournal = readJournal;
      }
      expect(gw.needsJournalRefresh).toBe(true);
      expect(gw.reactor.get(grant.id)).toBeDefined();
      const chosen = await commands.head(),
        readHead = store.readHead.bind(store);
      let observations = 0;
      store.readHead = async (id) => (++observations === 2 ? { status: "missing" } : readHead(id));
      const fact = observed(ROOT, "height", 97, 0, OTHER);
      try {
        await expect(
          commands.run({ kind: "retain", expectedHead: chosen, payload: [fact] }),
        ).rejects.toThrow(/head unavailable/);
        expect(await gw.backend.holds(fact.id)).toBe(false);
        expect(await gw.backend.holds(grant.id)).toBe(false);
        expect(await gw.backend.holds(bystander.id)).toBe(true);
        expect(await readHead(OP)).toEqual({ status: "head", head: chosen });
      } finally {
        store.readHead = readHead;
      }
      await gw.refresh();
      expect(gw.reactor.get(grant.id)).toBeUndefined();
      expect(gw.reactor.get(bystander.id)).toEqual(bystander);
    }));
  it("keeps erased IDs refused without affecting a named bystander", async () =>
    fixture(async (gw) => {
      const fact = observed(ROOT, "height", 42, 0, OP_SEED),
        bystander = observed(ROOT, "tag", "keep", 1, OP_SEED);
      await gw.append([fact, bystander]);
      await gw.erase(fact.id);
      const commands = await openOperatorCommands(gw, installation);
      await expect(
        commands.run({ kind: "retain", expectedHead: await commands.head(), payload: [fact] }),
      ).rejects.toThrow(/was erased/);
      expect(await gw.backend.holds(fact.id)).toBe(false);
      expect(gw.reactor.get(bystander.id)).toEqual(bystander);
    }));
  it("reuses write standing and volume quota instead of operator-request bypass", async () =>
    fixture(async (gw) => {
      const commands = await openOperatorCommands(gw, installation),
        fact = observed(ROOT, "height", 42, 0, OTHER);
      const retain = async () =>
        commands.run({ kind: "retain", expectedHead: await commands.head(), payload: [fact] });
      await expect(retain()).rejects.toThrow(/write standing/);
      await gw.append([
        signClaims(grantClaims(STORE_ENTITY, authorForSeed(OTHER), "write", OP, 0), OP_SEED),
        signClaims(budgetClaims(authorForSeed(OTHER), 0, OP, 0), OP_SEED),
      ]);
      await expect(retain()).rejects.toThrow(/budget|quota/i);
      expect(await gw.backend.holds(fact.id)).toBe(false);
    }));
  it("honors cite slates and conservatively refuses read-closed admitted evaluation", async () =>
    fixture(async (gw) => {
      const fact = observed(ROOT, "height", 42, 0, OP_SEED),
        bystander = observed(ROOT, "tag", "keep", 1, OP_SEED);
      await gw.append([fact, bystander]);
      await standSlate(gw, { members: [fact], closes: ["cite", "read"] });
      const commands = await openOperatorCommands(gw, installation);
      const citation = signClaims(
        {
          author: OP,
          timestamp: 0,
          validFrom: 0,
          pointers: [{ role: "cites", target: { kind: "delta", deltaRef: { delta: fact.id } } }],
        },
        OP_SEED,
      );
      await expect(
        commands.run({ kind: "retain", expectedHead: await commands.head(), payload: [citation] }),
      ).rejects.toThrow(/SLATED/);
      await expect(commands.run(evaluation(await commands.head()))).rejects.toThrow(
        /read closures/,
      );
      expect(gw.reactor.get(bystander.id)).toEqual(bystander);
    }));
  it("rejects reserved law, definitions, law-target negations and manifest roles", async () =>
    fixture(async (gw) => {
      const commands = await openOperatorCommands(gw, installation);
      const grant = signClaims(
        grantClaims(STORE_ENTITY, authorForSeed(OTHER), "write", OP, 0),
        OP_SEED,
      );
      await gw.append([grant]);
      const controls: Delta[] = [
        grant,
        hyperAct,
        signClaims(makeNegationClaims(OP, 0, grant.id), OP_SEED),
        signClaims(makeManifestClaims(OP, 0, [grant.id]), OP_SEED),
      ];
      for (const delta of controls)
        await expect(
          commands.run({ kind: "retain", expectedHead: await commands.head(), payload: [delta] }),
        ).rejects.toThrow(/fact import refuses/);
      expect(gw.reactor.get(grant.id)).toEqual(grant);
    }));
  it("CLI uses the real home and refuses remote/bound modes", async () =>
    fixture(async (gw, path, home) => {
      initHome(home, OP_SEED);
      const commands = await openOperatorCommands(gw, installation),
        catalogPath = join(home, "commands.json"),
        jobPath = join(home, "request.json");
      writeFileSync(
        catalogPath,
        JSON.stringify({
          configuration: serializeCommandDelta(installation.configuration),
          declarations: installation.declarations.map(serializeCommandDelta),
        }),
      );
      writeFileSync(
        jobPath,
        JSON.stringify({
          kind: "retain",
          expectedHead: await commands.head(),
          payload: [serializeCommandDelta(observed(ROOT, "height", 42, 0, OP_SEED))],
        }),
      );
      const out: string[] = [],
        err: string[] = [],
        io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
      const args = [
        "command",
        "--home",
        home,
        "--store",
        path,
        "--installation",
        catalogPath,
        "--request",
        jobPath,
      ];
      expect(await run([...args, "--url", "https://example.invalid"], io)).toBe(2);
      expect(await run([...args, "--binding", "some-user"], io)).toBe(2);
      expect(await run(args, io)).toBe(0);
      const receipt = JSON.parse(out.at(-1)!) as {
        status: string;
        outcome: { claims: { author: string } };
      };
      expect(receipt.status).toBe("completed");
      expect(receipt.outcome.claims.author).toBe(OP);
      expect(out.join("\n")).not.toContain(OP_SEED);
    }));
});
