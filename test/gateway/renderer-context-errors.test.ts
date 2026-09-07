// T287 mutation follow-up: malformed fields must fail independently of later inbox equality,
// and a bound resolution fault must not disclose the root door's diagnostic.
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
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "6c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONNECTION_SEED = "c5".repeat(32);
const REQUESTER = authorForSeed(CONNECTION_SEED);
const DESTINATION = "home:room";
const NOW = () => Date.now();

async function fixture() {
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    renderTimeoutMs: 10_000,
  });
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
  await gateway.append([
    observed(FERN, "height", 101, gateway.nextTimestamp(), OP_SEED),
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
  ]);
  const execution = (await gateway.openQuarantine()).gateway;
  await gateway.publishRenderer({
    route: "errors",
    schema: "Plant",
    consumes: ["height"],
    bundle: 'export default (node) => "<p>height=" + node.view.height + "</p>";',
  });
  await gateway.declarePublic(["Plant"]);
  const renderer = gateway.renderers().find((row) => row.route === "errors")!;
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

describe("renderer context malformed fields and read errors", () => {
  it("renders real bound and root workers before testing their refusal paths", async () => {
    for (const [context, height] of [
      [f.bound, 201],
      [f.root, 101],
      [f.publicRoot, 101],
    ] as const) {
      const response = await renderRendererInContext(f.renderer, FERN, context);
      expect(response.status).toBe(200);
      expect(response.body).toContain(`<p>height=${height}</p>`);
    }
  });

  it("rejects an invalid root gateway even with a valid door and clock", () => {
    expect(() => createRootRendererContext({} as never, "full", NOW)).toThrow();
  });

  it("rejects an invalid root door even with a real gateway and clock", () => {
    expect(() => createRootRendererContext(f.gateway, "invalid" as never, NOW)).toThrow();
  });

  it("rejects a fake execution handle even when it carries the real pool envelope", () => {
    expect(f.execution.envelope).toBeDefined();
    expect(() =>
      createBoundRendererContext({
        ...f.input,
        execution: { envelope: f.execution.envelope } as never,
      }),
    ).toThrow();
  });

  it.each([42, ""])(
    "rejects malformed destination %j even with exactly matching container and inbox",
    (destination) => {
      expect(() =>
        createBoundRendererContext({
          ...f.input,
          destination: destination as never,
          binding: {
            container: destination as never,
            inbox: `inbox:${destination}:${REQUESTER}`,
          },
        }),
      ).toThrow();
    },
  );

  it.each([42, ""])(
    "rejects malformed requester %j even when the inbox names it exactly",
    (requester) => {
      expect(() =>
        createBoundRendererContext({
          ...f.input,
          requester: requester as never,
          binding: {
            container: DESTINATION,
            inbox: `inbox:${DESTINATION}:${requester}`,
          },
        }),
      ).toThrow();
    },
  );

  it("rejects a mismatched binding container while the inbox still exactly names the destination and requester", () => {
    expect(f.input.binding.inbox).toBe(`inbox:${DESTINATION}:${REQUESTER}`);
    expect(() =>
      createBoundRendererContext({
        ...f.input,
        binding: { ...f.input.binding, container: "wrong-container" },
      }),
    ).toThrow();
  });

  it("hides a bound read fault while preserving full-root diagnostics and public-root error behavior", async () => {
    const fault = "private scoped read fault";
    const read = vi.spyOn(f.gateway, "resolvedNode").mockImplementation(() => {
      throw new Error(fault);
    });
    expect(await renderRendererInContext(f.renderer, FERN, f.bound)).toEqual({
      status: 404,
      contentType: "text/plain; charset=utf-8",
      body: "no such route",
    });
    expect(await renderRendererInContext(f.renderer, FERN, f.root)).toEqual({
      status: 400,
      contentType: "text/plain; charset=utf-8",
      body: fault,
    });
    expect(await renderRendererInContext(f.renderer, FERN, f.publicRoot)).toEqual({
      status: 400,
      contentType: "text/plain; charset=utf-8",
      body: "the route could not be rendered",
    });
    expect(read).toHaveBeenCalledTimes(3);
  });
});
