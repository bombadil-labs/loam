// T287: bound operational read faults share the initial read's uniform refusal boundary.
// Missing lenses stay scoped not_served answers. Success/absence controls run real workers;
// only operational fault seams are injected.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import {
  createBoundRendererContext,
  createRootRendererContext,
} from "../../src/gateway/renderer-context.js";
import { prepareRendererInContext, renderRendererInContext } from "../../src/gateway/renderers.js";
import * as worker from "../../src/gateway/render-worker.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "6c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONNECTION_SEED = "c5".repeat(32);
const REQUESTER = authorForSeed(CONNECTION_SEED);
const DESTINATION = "home:room";
const NOW = () => Date.now();
const OTHER = "plant:moss";
const EMPTY = "plant:missing";
const DIAGNOSTIC = "private gesture diagnostic";

async function fixture() {
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    renderTimeoutMs: 10_000,
  });
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN, OTHER]);
  await gateway.append([
    observed(FERN, "height", 101, gateway.nextTimestamp(), OP_SEED),
    observed(OTHER, "height", 102, gateway.nextTimestamp(), OP_SEED),
    signClaims(
      containerClaims(
        {
          container: DESTINATION,
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: "none" } },
            in: "input",
          },
        },
        OP,
        gateway.nextTimestamp(),
      ),
      OP_SEED,
    ),
    signClaims(
      envelopeClaims(ENVELOPE_ANY, { renderTimeoutMs: 10_000 }, OP, gateway.nextTimestamp()),
      OP_SEED,
    ),
  ]);
  const inbox = await gateway.bindConnection({
    container: DESTINATION,
    connectionKey: REQUESTER,
    ownerSeed: "b4".repeat(32),
  });
  await inbox.gateway!.append([
    observed(FERN, "height", 201, inbox.gateway!.nextTimestamp(), CONNECTION_SEED),
    observed(OTHER, "height", 202, inbox.gateway!.nextTimestamp(), CONNECTION_SEED),
  ]);
  const execution = (await gateway.openQuarantine()).gateway;
  await gateway.publishRenderer({
    route: "gesture-errors",
    schema: "Plant",
    consumes: ["height"],
    bundle: `export default (node) => "<p>first=" + node.view.height + "|reads=" + Object.keys(node.reads).sort().map((key) => {
      const answer = node.reads[key];
      return key + "=" + (answer.error ? answer.error.code + ":" + answer.error.message : answer.view.height);
    }).join("|") + "</p>";`,
  });
  await gateway.declarePublic(["Plant"]);
  const renderer = gateway.renderers().find((row) => row.route === "gesture-errors")!;
  const input = {
    authority: gateway,
    destination: DESTINATION,
    binding: { container: DESTINATION, inbox: inbox.entity! },
    requester: REQUESTER,
    execution,
    now: NOW,
  };
  const bound = createBoundRendererContext(input);
  const root = createRootRendererContext(gateway, "full", NOW);
  const publicRoot = createRootRendererContext(gateway, "public", NOW);
  await prepareRendererInContext(renderer, bound);
  await prepareRendererInContext(renderer, root);
  return { gateway, execution, renderer, input, bound, root, publicRoot };
}

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await f.gateway.close();
});

const gesture = (lens: string, entity: string) => ({ reads: [{ lens, entity }], state: {} });
const gone = { status: 404, contentType: "text/plain; charset=utf-8", body: "no such route" };

describe("bound renderer gesture failure boundary", () => {
  it("runs real workers for normal and empty bound gestures without falling back to root data", async () => {
    for (const [entity, height] of [
      [OTHER, 202],
      [EMPTY, undefined],
    ] as const) {
      const response = await renderRendererInContext(f.renderer, FERN, f.bound, {
        gesture: gesture("Plant", entity),
      });
      expect(response.status).toBe(200);
      expect(response.body).toContain(`first=201|reads=Plant@${entity}=${height}`);
      expect(response.body).not.toContain("first=101");
      expect(response.body).not.toContain("=102");
    }
  });

  it("returns uniform404 for a gesture-only resolution fault after a successful first paint", async () => {
    const resolve = f.gateway.resolvedNode.bind(f.gateway);
    const read = vi.spyOn(f.gateway, "resolvedNode").mockImplementation((...args) => {
      if (args[1] === OTHER) throw new Error(DIAGNOSTIC);
      const node = resolve(...args);
      expect(node.view.height).toBe(201);
      return node;
    });
    const renders = vi.spyOn(worker, "renderInWorker");
    const response = await renderRendererInContext(f.renderer, FERN, f.bound, {
      gesture: gesture("Plant", OTHER),
    });
    expect(response).toEqual(gone);
    expect(read.mock.calls.map((args) => args[1])).toEqual([FERN, OTHER]);
    expect(renders).not.toHaveBeenCalled(); // neither the raw error nor HTML crosses into a worker
  });

  it("renders an unavailable bound lens as an ordinary scoped not_served answer", async () => {
    const response = await renderRendererInContext(f.renderer, FERN, f.bound, {
      gesture: gesture("MissingLens", OTHER),
    });
    expect(response.status).toBe(200);
    expect(response.body).toContain(
      'first=201|reads=MissingLens@plant:moss=not_served:this store does not serve the lens "MissingLens"',
    );
    expect(response.body).not.toContain(DIAGNOSTIC);
  });

  it("returns uniform404 for a bound surface fault reached only by the gesture", async () => {
    let firstPaintResolved = false;
    const resolve = f.gateway.resolvedNode.bind(f.gateway);
    vi.spyOn(f.gateway, "resolvedNode").mockImplementation((...args) => {
      const node = resolve(...args);
      expect(args[1]).toBe(FERN);
      expect(node.view.height).toBe(201);
      firstPaintResolved = true;
      return node;
    });
    const surface = f.gateway.boundSurface.bind(f.gateway);
    vi.spyOn(f.gateway, "boundSurface").mockImplementation((...args) => {
      if (firstPaintResolved) throw new Error(DIAGNOSTIC);
      return surface(...args);
    });
    const renders = vi.spyOn(worker, "renderInWorker");
    const response = await renderRendererInContext(f.renderer, FERN, f.bound, {
      gesture: gesture("Plant", OTHER),
    });
    expect(firstPaintResolved).toBe(true);
    expect(response).toEqual(gone);
    expect(renders).not.toHaveBeenCalled();
  });

  it("preserves root full-door gesture diagnostics and public-door gesture omission", async () => {
    const resolve = f.gateway.resolvedNode.bind(f.gateway);
    vi.spyOn(f.gateway, "resolvedNode").mockImplementation((...args) => {
      if (args[1] === OTHER) throw new Error(DIAGNOSTIC);
      return resolve(...args);
    });
    const failed = await renderRendererInContext(f.renderer, FERN, f.root, {
      gesture: gesture("Plant", OTHER),
    });
    expect(failed.status).toBe(200);
    expect(failed.body).toContain(`first=101|reads=Plant@${OTHER}=refused:${DIAGNOSTIC}`);
    const missing = await renderRendererInContext(f.renderer, FERN, f.root, {
      gesture: gesture("MissingLens", OTHER),
    });
    expect(missing.status).toBe(200);
    expect(missing.body).toContain(`MissingLens@${OTHER}=not_served:`);
    const publicResponse = await renderRendererInContext(f.renderer, FERN, f.publicRoot, {
      gesture: gesture("Plant", OTHER),
    });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body).toContain("first=101|reads=</p>");
    expect(publicResponse.body).not.toContain(DIAGNOSTIC);
  });
});
