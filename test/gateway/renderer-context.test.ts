// T287: an explicitly selected renderer executes against one live law/data context.
// These are trusted library contexts, not activation records or newly mounted HTTP routes.
//
// RAILS-RED on origin/main, the four renderer-context suites copied in: none LOADS there. Each
// imports src/gateway/renderer-context.js, which this slice adds, so vitest reports four failed
// suites and no cases. The revert probes below are the instrument for the cases.
//
// REVERT PROBES, MEASURED across the four suites together (26 cases), one guard deleted per probe:
//   every field check at issuance (gateway, door, clock, destination, requester,
//     container === destination, inbox === inboxName, envelope present)     → 1 red each
//   the outer freeze / the nested binding freeze                             → 1 red / 2 red
//   the issued-set check (a field-perfect copy of a context)                 → 1 red
//   connectionStands read live at entry / after admission / after the worker → 3, 1, 1 red
//   contextAllows standing                                                   → 5 red
//   bound pen, writable, versionId, asOf refusals                            → 1 red each
//   prepare: finite clock / servable lens / post-admit recheck               → 1 red each
//   bound catch → uniform 404; gesture refused → 404; gesture bound catch    → 1 red each
//   reads.ts child resolvers from the bound fold                             → 1 red
//   render reads root ground instead of the bound one                        → 13 red
// Two render-side guards are MIRRORS of prepare-side ones and are not reached on their own: the
// finite-clock check and the bound-surface lens check in renderRendererInContext. Deleting either
// leaves every case green, because the resolve fault they pre-empt is folded to the same 404 by
// the bound catch. They stay as the cheaper refusal; the catch is the rail that protects them.
//
// NOT ASSERTED HERE: an `authority` gateway that is real but foreign to the binding (a second root
// that declared the same container and inbox names) would pass connectionStands against its own
// table. The factory does not tie authority to the binding; the activation slice that mints
// contexts from a door owns that rail. Nor is the RendererBinding tied to the context: a host
// caller may pass any bundle under the execution envelope, which the ticket names as the next slice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { revocationClaims } from "../../src/gateway/accounts.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import {
  createBoundRendererContext,
  createRootRendererContext,
} from "../../src/gateway/renderer-context.js";
import {
  prepareRendererInContext,
  renderRendererInContext,
  readKey,
  type RendererBinding,
} from "../../src/gateway/renderers.js";
import * as worker from "../../src/gateway/render-worker.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";
import { OP_SEED, OP, BEFORE_DEADLINE, AFTER_DEADLINE, standSlate } from "./slating.js";

const OWNER_SEED = "b4".repeat(32);
const CONN_SEEDS = ["c5".repeat(32), "d6".repeat(32)];
const OTHER = "plant:moss";
const NOW = () => Date.now();
const FLOOR = `export default function (node) {
  return "<p>first=" + node.view.height + "|reads=" + Object.keys(node.reads).sort().map(function (key) {
    var answer = node.reads[key];
    return key + "=" + (answer.error ? answer.error.code : answer.view.height);
  }).join(",") + "</p>";
}`;
const gateways: Gateway[] = [];
let serial = 0;

afterEach(async () => {
  vi.restoreAllMocks();
  while (gateways.length > 0) await gateways.pop()!.close();
});

async function declare(gateway: Gateway, container: string, parent?: string) {
  const delta = signClaims(
    containerClaims(
      {
        container,
        trust: "curated",
        posture: "shared",
        // Ground arrives only through this container's inboxes; primary values are a leak control.
        membership: {
          op: "select",
          pred: { match: { field: "author", cmp: "eq", const: "none" } },
          in: "input",
        },
        ...(parent === undefined ? {} : { parent }),
      },
      OP,
      gateway.nextTimestamp(),
    ),
    OP_SEED,
  );
  await gateway.append([delta]);
  return delta;
}

async function envelope(gateway: Gateway, slots = 2, timeout = 10_000) {
  await gateway.append([
    signClaims(
      envelopeClaims(
        ENVELOPE_ANY,
        {
          maxConcurrentRenders: slots,
          renderTimeoutMs: timeout,
          maxMemoryMb: 128,
        },
        OP,
        gateway.nextTimestamp(),
      ),
      OP_SEED,
    ),
  ]);
}

async function fixture() {
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    renderTimeoutMs: 10_000,
  });
  gateways.push(gateway);
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN, OTHER]);
  await gateway.append([
    observed(FERN, "height", 101, gateway.nextTimestamp(), OP_SEED),
    observed(OTHER, "height", 102, gateway.nextTimestamp(), OP_SEED),
  ]);
  const ancestor = await declare(gateway, "home");
  const connections = [];
  for (const [index, seed] of CONN_SEEDS.entries()) {
    const container = index === 0 ? "home:room" : "sibling";
    await declare(gateway, container, index === 0 ? "home" : undefined);
    const requester = authorForSeed(seed);
    const inbox = await gateway.bindConnection({
      container,
      connectionKey: requester,
      ownerSeed: OWNER_SEED,
    });
    const pool = inbox.gateway!;
    await pool.append([
      observed(FERN, "height", index === 0 ? 201 : 301, pool.nextTimestamp(), seed),
      observed(OTHER, "height", index === 0 ? 202 : 302, pool.nextTimestamp(), seed),
    ]);
    const binding: ConnectionBinding = { container, inbox: inbox.entity! };
    connections.push({ inbox, pool, binding, requester, seed });
  }
  await envelope(gateway);
  // A separate real quarantine supplies the explicit execution envelope. A curated inbox has
  // no envelope by default, and may not silently borrow the primary host's unmetered policy.
  const execution = (await gateway.openQuarantine()).gateway;
  const bundle = `${FLOOR}\n// fixture ${serial++}`;
  await gateway.publishRenderer({
    route: "context",
    schema: "Plant",
    consumes: ["height"],
    bundle,
  });
  const renderer = gateway.renderers().find((row) => row.route === "context")!;
  const [first, second] = [connections[0]!, connections[1]!];
  const args = (connection: typeof first) => ({
    authority: gateway,
    destination: connection.binding.container,
    binding: connection.binding,
    requester: connection.requester,
    execution,
    now: NOW,
  });
  return { gateway, execution, renderer, ancestor, first, second, args };
}

function refused(response: { status: number; contentType: string; body: string }) {
  expect(response).toEqual({
    status: 404,
    contentType: "text/plain; charset=utf-8",
    body: "no such route",
  });
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("explicit renderer execution context", () => {
  it("uses destination ground on first paint and every gesture, with real root and sibling controls", async () => {
    const f = await fixture();
    const root = createRootRendererContext(f.gateway, "full", NOW);
    const bound = createBoundRendererContext(f.args(f.first));
    const sibling = createBoundRendererContext(f.args(f.second));
    const gesture = { reads: [{ lens: "Plant", entity: OTHER }], state: {} };
    for (const [context, first, other] of [
      [root, 101, 102],
      [bound, 201, 202],
      [sibling, 301, 302],
    ] as const) {
      await prepareRendererInContext(f.renderer, context);
      const response = await renderRendererInContext(f.renderer, FERN, context, { gesture });
      expect(response.status).toBe(200);
      expect(response.body.includes("On probation")).toBe(context !== root);
      expect(response.body).toContain(`first=${first}|reads=${readKey("Plant", OTHER)}=${other}`);
    }
    expect((await f.gateway.serveRoute("context", FERN, "full")).body).toContain("first=101");
    const scope = f.gateway.connectionScope({ bound: f.first.binding.container });
    expect(scope.some((delta) => delta.claims.author === f.second.requester)).toBe(false);
  });

  it("serves a container-only lens and expands children through that fold's resolver", async () => {
    const f = await fixture();
    const child = "home:room:Child";
    const feed = "home:room:Feed";
    const rootOnly = "RootOnly";
    const siblingOnly = "SiblingOnly";
    const local = f.first.pool;
    await f.gateway.publishRegistration(
      { ...PLANT, name: rootOnly },
      { ...PLANT_POLICY, name: rootOnly },
      [FERN],
    );
    await f.second.pool.publishRegistration(
      { ...PLANT, name: siblingOnly },
      { ...PLANT_POLICY, name: siblingOnly },
      [FERN],
    );
    await local.publishRegistration(
      { ...PLANT, name: child },
      { ...PLANT_POLICY, name: child },
      [FERN],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        height: {
          rung: "a",
          type: "number",
          code: "export default (bucket) => Number(bucket[0].value) + 400;",
        },
      },
    );
    const gather = {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    };
    await local.publishRegistration(
      {
        name: feed,
        alg: 1,
        body: parseTerm({
          op: "expand",
          role: { exact: "child" },
          schema: child,
          reading: child,
          in: gather,
        }),
      },
      { name: feed, alg: 1, props: new Map([["child", pickLatest]]), default: pickLatest },
      ["feed:one"],
    );
    await local.append([
      signClaims(
        {
          author: f.first.requester,
          timestamp: local.nextTimestamp(),
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "feed:one", context: "child" } },
            },
            { role: "child", target: { kind: "entity", entity: { id: FERN, context: "in" } } },
          ],
        },
        f.first.seed,
      ),
    ]);
    await local.publishRenderer({
      route: "local",
      schema: feed,
      consumes: ["child"],
      bundle: `export default (node) => "<p>child=" + node.view.child.height + "|reads=" + JSON.stringify(node.reads) + "</p>";`,
    });
    const renderer = local.renderers().find((row) => row.route === "local")!;
    expect(f.gateway.registered.some((row) => row.schema.name === child)).toBe(false);
    const context = createBoundRendererContext(f.args(f.first));
    await prepareRendererInContext(renderer, context);
    const response = await renderRendererInContext(renderer, "feed:one", context, {
      gesture: {
        reads: [
          { lens: child, entity: FERN },
          { lens: siblingOnly, entity: FERN },
          { lens: rootOnly, entity: FERN },
        ],
        state: {},
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toContain("child=601");
    expect(response.body).toContain('"height":601');
    expect(response.body).toContain('"code":"not_served"');
    expect(response.body).not.toContain('"height":101');
    expect(response.body).not.toContain('"height":301');
    const root = createRootRendererContext(f.gateway, "full", NOW);
    await expect(prepareRendererInContext(renderer, root)).rejects.toThrow(
      "renderer context refuses this request",
    );
    refused(await renderRendererInContext(renderer, "feed:one", root));
  });

  it("rejects incomplete factories, mismatched requester/destination, and an execution gateway without an envelope", async () => {
    const f = await fixture();
    const args = f.args(f.first);
    expect(() => createRootRendererContext(f.gateway, "full", undefined as never)).toThrow();
    for (const key of Object.keys(args)) {
      const missing = { ...args } as Record<string, unknown>;
      delete missing[key];
      expect(() => createBoundRendererContext(missing as never), `missing ${key}`).toThrow();
    }
    expect(() =>
      createBoundRendererContext({ ...args, destination: f.second.binding.container }),
    ).toThrow();
    expect(() => createBoundRendererContext({ ...args, requester: f.second.requester })).toThrow();
    expect(f.first.pool.envelope).toBeUndefined();
    expect(() => createBoundRendererContext({ ...args, execution: f.first.pool })).toThrow();
    expect(() => createBoundRendererContext({ ...args, execution: f.gateway })).toThrow();
    refused(await renderRendererInContext(f.renderer, FERN, undefined as never));
    refused(await renderRendererInContext(f.renderer, FERN, {} as never));
    const valid = createBoundRendererContext(args);
    const poisonous = {
      get bundle(): string {
        throw new Error("bundle was accessed before context validation");
      },
    } as RendererBinding;
    for (const forged of [
      undefined,
      {},
      { kind: "root", gateway: f.gateway, door: "full", now: NOW },
      { ...valid },
    ]) {
      await expect(prepareRendererInContext(poisonous, forged as never)).rejects.toThrow(
        "renderer context refuses this request",
      );
      refused(await renderRendererInContext(poisonous, FERN, forged as never));
    }
  });

  it("refuses bound pens, writable fields, version pins and asOf instead of rendering latest/root", async () => {
    const f = await fixture();
    const context = createBoundRendererContext(f.args(f.first));
    await prepareRendererInContext(f.renderer, context);
    expect((await renderRendererInContext(f.renderer, FERN, context)).status).toBe(200);
    for (const renderer of [
      { ...f.renderer, pen: f.first.requester, writable: ["height"] },
      { ...f.renderer, writable: ["height"] },
      { ...f.renderer, writable: [] },
      { ...f.renderer, pen: f.first.requester },
      { ...f.renderer, versionId: f.gateway.registrationVersions()[0]!.deltaId },
    ] satisfies RendererBinding[]) {
      await expect(prepareRendererInContext(renderer, context)).rejects.toThrow(
        "renderer context refuses this request",
      );
      refused(await renderRendererInContext(renderer, FERN, context));
    }
    for (const asOf of [0, NOW()])
      refused(await renderRendererInContext(f.renderer, FERN, context, { asOf }));
  });

  it("passes the same live moment to first paint and gestures when a real slate deadline lapses", async () => {
    const f = await fixture();
    const bystander = "plant:oak";
    await f.first.pool.append([
      observed(bystander, "height", 203, f.first.pool.nextTimestamp(), f.first.seed),
    ]);
    const condemned = [...f.first.pool.reactor.snapshot()].filter(
      (delta) =>
        delta.claims.author === f.first.requester &&
        delta.claims.pointers.some(
          (pointer) =>
            pointer.target.kind === "primitive" &&
            (pointer.target.value === 201 || pointer.target.value === 202),
        ),
    );
    expect(condemned).toHaveLength(2);
    // Use the same signed frozen-membership/slate fixture as the existing read-door rails.
    // Its members name the real inbox delta IDs; no clock, authority, or read callback is mocked.
    const slate = await standSlate(f.gateway, {
      members: condemned,
      closes: ["cite"],
      ts: f.gateway.nextTimestamp(),
    });
    expect(
      f.gateway.slates(BEFORE_DEADLINE).find((row) => row.record === slate.record)?.members,
    ).toEqual(condemned.map((delta) => delta.id).sort());
    expect(
      f.gateway.slates(BEFORE_DEADLINE).find((row) => row.record === slate.record)?.enforced,
    ).toEqual(["cite"]);
    expect(
      f.gateway.slates(AFTER_DEADLINE).find((row) => row.record === slate.record)?.enforced,
    ).toContain("read");
    const histories = [f.gateway, f.first.pool, f.second.pool].map((gateway) => [
      ...gateway.reactor.snapshot(),
    ]);
    let moment = BEFORE_DEADLINE;
    const context = createBoundRendererContext({ ...f.args(f.first), now: () => moment });
    await prepareRendererInContext(f.renderer, context);
    const gesture = {
      reads: [
        { lens: "Plant", entity: OTHER },
        { lens: "Plant", entity: bystander },
      ],
      state: {},
    };
    const before = await renderRendererInContext(f.renderer, FERN, context, { gesture });
    expect(before.status).toBe(200);
    expect(before.body).toContain("first=201");
    expect(before.body).toContain(`${readKey("Plant", OTHER)}=202`);
    expect(before.body).toContain(`${readKey("Plant", bystander)}=203`);
    moment = AFTER_DEADLINE;
    const after = await renderRendererInContext(f.renderer, FERN, context, { gesture });
    expect(after.status).toBe(200);
    expect(after.body).toContain("first=undefined");
    expect(after.body).toContain(`${readKey("Plant", OTHER)}=undefined`);
    expect(after.body).toContain(`${readKey("Plant", bystander)}=203`);
    expect(after.body).not.toContain("first=201");
    expect(after.body).not.toContain(`${readKey("Plant", OTHER)}=202`);
    // Deadline enforcement changes the reading, not the retained bytes or independent inbox.
    expect(
      [f.gateway, f.first.pool, f.second.pool].map((gateway) => [...gateway.reactor.snapshot()]),
    ).toEqual(histories);
  });

  it("snapshots caller identity and refuses a lost envelope or nonfinite live clock on context reuse", async () => {
    const f = await fixture();
    const binding = { ...f.first.binding };
    const clock = vi.fn(NOW);
    const context = createBoundRendererContext({ ...f.args(f.first), binding, now: clock });
    expect(Object.isFrozen(context)).toBe(true);
    binding.container = f.second.binding.container;
    binding.inbox = f.second.binding.inbox;
    await prepareRendererInContext(f.renderer, context);
    clock.mockClear();
    expect((await renderRendererInContext(f.renderer, FERN, context)).body).toContain("first=201");
    expect(clock).toHaveBeenCalled();
    const calls = clock.mock.calls.length;
    expect((await renderRendererInContext(f.renderer, FERN, context)).body).toContain("first=201");
    expect(clock.mock.calls.length).toBeGreaterThan(calls);
    const realEnvelope = f.execution.envelope!;
    f.execution.envelope = undefined;
    await expect(prepareRendererInContext(f.renderer, context)).rejects.toThrow(
      "renderer context refuses this request",
    );
    refused(await renderRendererInContext(f.renderer, FERN, context));
    f.execution.envelope = realEnvelope;
    clock.mockReturnValue(Number.NaN);
    const renders = vi.spyOn(worker, "renderInWorker");
    await expect(prepareRendererInContext(f.renderer, context)).rejects.toThrow(
      "renderer context refuses this request",
    );
    refused(await renderRendererInContext(f.renderer, FERN, context));
    expect(renders).not.toHaveBeenCalled();
    clock.mockImplementation(NOW);
    expect((await renderRendererInContext(f.renderer, FERN, context)).body).toContain("first=201");
  });

  it("reused contexts lose a revoked grant or ancestor without darkening an independent connection", async () => {
    const f = await fixture();
    const first = createBoundRendererContext(f.args(f.first));
    const second = createBoundRendererContext(f.args(f.second));
    await prepareRendererInContext(f.renderer, first);
    await prepareRendererInContext(f.renderer, second);
    expect((await renderRendererInContext(f.renderer, FERN, first)).body).toContain("first=201");
    await f.gateway.append([
      signClaims(revocationClaims(f.ancestor.id, OP, f.gateway.nextTimestamp()), OP_SEED),
    ]);
    expect(
      readContainerTable(f.gateway.reactor, OP).containers.has(f.first.binding.container),
    ).toBe(true);
    refused(await renderRendererInContext(f.renderer, FERN, first));
    expect((await renderRendererInContext(f.renderer, FERN, second)).body).toContain("first=301");
    // Restore the explicitly dropped ancestor with an operator declaration, then revoke ONLY the
    // first inbox's write grant. Context reuse must reread each independent authority dimension.
    await declare(f.gateway, "home");
    expect((await renderRendererInContext(f.renderer, FERN, first)).body).toContain("first=201");
    await f.gateway.revokeConnection({
      inbox: f.first.inbox,
      connectionKey: f.first.requester,
      ownerSeed: OWNER_SEED,
    });
    refused(await renderRendererInContext(f.renderer, FERN, first));
    expect((await renderRendererInContext(f.renderer, FERN, second)).body).toContain("first=301");
    expect(
      [...f.first.pool.reactor.snapshot()].some(
        (delta) => delta.claims.author === f.first.requester,
      ),
    ).toBe(true);
  });

  it("does not release real worker HTML when the connection is revoked during worker completion", async () => {
    const f = await fixture();
    const context = createBoundRendererContext(f.args(f.first));
    await prepareRendererInContext(f.renderer, context);
    const completed = latch();
    const resume = latch();
    const realRender = worker.renderInWorker;
    const spy = vi.spyOn(worker, "renderInWorker").mockImplementationOnce(async (...args) => {
      const response = await realRender(...args);
      expect(response.status).toBe(200);
      expect(response.body).toContain("first=201");
      completed.release();
      await resume.promise;
      return response;
    });
    const pending = renderRendererInContext(f.renderer, FERN, context);
    try {
      await completed.promise;
      await f.gateway.revokeConnection({
        inbox: f.first.inbox,
        connectionKey: f.first.requester,
        ownerSeed: OWNER_SEED,
      });
    } finally {
      resume.release();
    }
    refused(await pending);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(f.execution.envelope!.inFlight).toBe(0);
  });

  it("rechecks standing after admission awaits before any subsequent render can release HTML", async () => {
    const f = await fixture();
    const context = createBoundRendererContext(f.args(f.first));
    const admitted = latch();
    const resume = latch();
    const realAdmit = worker.admitInWorker;
    const spy = vi.spyOn(worker, "admitInWorker").mockImplementationOnce(async (...args) => {
      const result = await realAdmit(...args);
      expect(result.ok).toBe(true);
      admitted.release();
      await resume.promise;
      return result;
    });
    // Capture rejection immediately so the paused admission cannot create an unhandled rejection.
    const pending = prepareRendererInContext(f.renderer, context).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await admitted.promise;
      await f.gateway.revokeConnection({
        inbox: f.first.inbox,
        connectionKey: f.first.requester,
        ownerSeed: OWNER_SEED,
      });
    } finally {
      resume.release();
    }
    expect(await pending).toEqual(new Error("renderer context refuses this request"));
    refused(await renderRendererInContext(f.renderer, FERN, context));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("uses changed live admission budgets and shares the execution pool's current slots across contexts", async () => {
    const f = await fixture();
    const first = createBoundRendererContext(f.args(f.first));
    const second = createBoundRendererContext(f.args(f.second));
    const admissions = vi.spyOn(worker, "admitInWorker");
    await prepareRendererInContext(f.renderer, first);
    expect(admissions.mock.calls.at(-1)?.[1]).toBe(10_000);
    expect((await renderRendererInContext(f.renderer, FERN, first)).status).toBe(200);
    await envelope(f.gateway, 1, 9000);
    await prepareRendererInContext(f.renderer, first);
    expect(admissions.mock.calls.at(-1)?.[1]).toBe(9000);
    expect(admissions).toHaveBeenCalledTimes(2);
    const completed = latch();
    const resume = latch();
    const realRender = worker.renderInWorker;
    const renders = vi.spyOn(worker, "renderInWorker").mockImplementationOnce(async (...args) => {
      const response = await realRender(...args);
      expect(response.status).toBe(200);
      completed.release();
      await resume.promise;
      return response;
    });
    const pending = renderRendererInContext(f.renderer, FERN, first);
    try {
      await completed.promise;
      const busy = await renderRendererInContext(f.renderer, FERN, second);
      expect(busy.status).toBe(503);
      expect(busy.contentType).not.toMatch(/^text\/html/);
      expect(f.execution.envelope!.refusedForSlots).toBe(1);
      // Widening the live slot limit admits the other context while the first still holds one.
      await envelope(f.gateway, 2, 9000);
      const other = await renderRendererInContext(f.renderer, FERN, second);
      expect(other.status).toBe(200);
      expect(other.body).toContain("first=301");
      expect(renders.mock.calls.at(-1)?.[2]).toBe(9000);
    } finally {
      resume.release();
    }
    expect((await pending).status).toBe(200);
    expect(f.execution.envelope!.inFlight).toBe(0);
  });
});
