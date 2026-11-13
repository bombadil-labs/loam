import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  LISTING_MAX_LIMIT,
  listingContainerName,
  listingPageImpl,
} from "../../src/gateway/listing.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

async function ground(deltas: number, entities: number): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const batch = [];
  for (let i = 0; i < deltas; i += 1) {
    const entity = `plant:${String(i % entities).padStart(5, "0")}`;
    batch.push(observed(entity, i % 2 === 0 ? "height" : "tag", i, 1000 + i, GARDENER_SEED));
  }
  await gw.append(batch);
  return gw;
}

const report = (line: string): void => {
  process.stderr.write(line);
  if (process.env.LOAM_BENCH_OUT) appendFileSync(process.env.LOAM_BENCH_OUT, line);
};

const ms = (t0: number): string => `${(performance.now() - t0).toFixed(0)}ms`;

describe.skipIf(process.env.LOAM_BENCH !== "1")("listing cost by ground size", () => {
  for (const [deltas, entities] of [
    [2_000, 200],
    [10_000, 500],
  ] as const) {
    it(`${deltas} deltas / ${entities} entities`, async () => {
      const gw = await ground(deltas, entities);
      let t0 = performance.now();
      await gw.list("Plant", { limit: 1 });
      const first = ms(t0);
      t0 = performance.now();
      await gw.list("Plant", { limit: 1 });
      const repeat1 = ms(t0);
      t0 = performance.now();
      const page = await gw.list("Plant", { limit: LISTING_MAX_LIMIT });
      const page25 = ms(t0);
      t0 = performance.now();
      await gw.list("Plant", { limit: LISTING_MAX_LIMIT });
      const page25Again = ms(t0);
      t0 = performance.now();
      let after: string | undefined = page[page.length - 1]!.entity;
      let pages = 1;
      while (after !== undefined) {
        const next = await gw.list("Plant", { limit: LISTING_MAX_LIMIT, after });
        pages += 1;
        after = next.length === LISTING_MAX_LIMIT ? next[next.length - 1]!.entity : undefined;
      }
      const walk = ms(t0);
      await gw.append([observed("plant:zzzzz", "height", 1, 999_999, GARDENER_SEED)]);
      t0 = performance.now();
      await gw.list("Plant", { limit: 1 });
      const afterAppend = ms(t0);
      t0 = performance.now();
      await listingPageImpl(gw, "Plant", { limit: LISTING_MAX_LIMIT });
      const idsWarm = ms(t0);
      await gw.append([observed("plant:zzzzy", "tag", "x", 999_998, GARDENER_SEED)]);
      t0 = performance.now();
      await listingPageImpl(gw, "Plant", { limit: LISTING_MAX_LIMIT });
      const idsPostAppend = ms(t0);
      t0 = performance.now();
      let cursor: string | undefined;
      let idPages = 0;
      for (;;) {
        const next = await listingPageImpl(gw, "Plant", {
          limit: LISTING_MAX_LIMIT,
          after: cursor,
        });
        if (next.length === 0) break;
        idPages += 1;
        cursor = next[next.length - 1]!;
      }
      const idsWalk = ms(t0);
      t0 = performance.now();
      const scope = gw.containerScope({ containers: [listingContainerName("Plant")] });
      const membership = ms(t0);
      t0 = performance.now();
      gw.resolvedNode("Plant", page[0]!.entity);
      const resolve = ms(t0);
      report(
        `\n[bench] ${deltas} deltas / ${entities} entities (memory backend)\n` +
          `  first list(limit 1)      ${first}\n` +
          `  repeat list(limit 1)     ${repeat1}\n` +
          `  list(limit 25)           ${page25}\n` +
          `  list(limit 25) again     ${page25Again}\n` +
          `  cursor walk, ${pages} pages   ${walk}\n` +
          `  list(limit 1) post-append ${afterAppend}\n` +
          `  ids only: warm page     ${idsWarm}\n` +
          `  ids only: post-append   ${idsPostAppend}\n` +
          `  ids only: walk ${idPages} pages ${idsWalk}\n` +
          `  containerScope (${scope.length} members)  ${membership}\n` +
          `  resolvedNode, one entity ${resolve}\n`,
      );
      await gw.close();
    }, 600_000);
  }
});
