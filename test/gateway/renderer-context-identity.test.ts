// T287: the issued context's own nested binding cannot be retargeted to another live scope.
// Scope is asserted through actual worker first paint and gestures, not a freeze flag alone.
import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { createBoundRendererContext } from "../../src/gateway/renderer-context.js";
import { prepareRendererInContext, renderRendererInContext } from "../../src/gateway/renderers.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "6c".repeat(32);
const OP = authorForSeed(OP_SEED);
const OTHER = "plant:moss";

async function fixture(gateway: Gateway) {
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN, OTHER]);
  await gateway.append([
    signClaims(
      envelopeClaims(ENVELOPE_ANY, { renderTimeoutMs: 10_000 }, OP, gateway.nextTimestamp()),
      OP_SEED,
    ),
  ]);
  const execution = (await gateway.openQuarantine()).gateway;
  const contexts = [];
  for (const [container, seed, height] of [
    ["home:first", "c5".repeat(32), 201],
    ["home:second", "d6".repeat(32), 301],
  ] as const) {
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container,
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
    ]);
    const requester = authorForSeed(seed);
    const inbox = await gateway.bindConnection({
      container,
      connectionKey: requester,
      ownerSeed: "b4".repeat(32),
    });
    const pool = inbox.gateway!;
    await pool.append([
      observed(FERN, "height", height, pool.nextTimestamp(), seed),
      observed(OTHER, "height", height + 1, pool.nextTimestamp(), seed),
    ]);
    contexts.push(
      createBoundRendererContext({
        authority: gateway,
        destination: container,
        binding: { container, inbox: inbox.entity! },
        requester,
        execution,
        now: () => Date.now(),
      }),
    );
  }
  await gateway.publishRenderer({
    route: "identity",
    schema: "Plant",
    consumes: ["height"],
    bundle: `export default (node) => "<p>first=" + node.view.height + "|gesture=" + node.reads["Plant@plant:moss"].view.height + "</p>";`,
  });
  return {
    first: contexts[0]!,
    second: contexts[1]!,
    renderer: gateway.renderers().find((row) => row.route === "identity")!,
  };
}

describe("issued renderer binding identity", () => {
  it("keeps preparation, first paint and gestures in the original scope after attempted nested retargeting", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), {
      seed: OP_SEED,
      renderTimeoutMs: 10_000,
    });
    try {
      const { first, second, renderer } = await fixture(gateway);
      if (first.kind !== "bound" || second.kind !== "bound")
        throw new Error("fixture requires bound contexts");
      const options = { gesture: { reads: [{ lens: "Plant", entity: OTHER }], state: {} } };
      // The alternate identity is genuinely live: retargeting cannot fail accidentally because
      // its container, inbox, registration, or data are missing.
      await prepareRendererInContext(renderer, second);
      const sibling = await renderRendererInContext(renderer, FERN, second, options);
      expect(sibling.status).toBe(200);
      expect(sibling.body).toContain("first=301|gesture=302");

      // Mutate the ISSUED nested record, not the input object the factory copied. Reflect.set
      // permits a refused write without making the exception's class/text part of the contract.
      Reflect.set(first.binding, "container", second.binding.container);
      Reflect.set(first.binding, "inbox", second.binding.inbox);
      await prepareRendererInContext(renderer, first);
      const original = await renderRendererInContext(renderer, FERN, first, options);
      expect(original.status).toBe(200);
      expect(original.body).toContain("first=201|gesture=202");
      expect(original.body).not.toContain("first=301");
      expect(original.body).not.toContain("gesture=302");
    } finally {
      await gateway.close();
    }
  });
});
