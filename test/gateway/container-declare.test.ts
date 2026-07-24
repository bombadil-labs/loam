// T32 — declarations resolve live, and the two §28.4 knobs are immutable (criteria 3 and 12).
// A knob change is a delta, never a restart — for the MUTABLE knobs (membership, version, parent):
// re-declaring updates the RUNNING gateway's table with no reopen, and a reopened store resolves
// the same table from the ground alone. Trust and posture are NOT flags (§28.4 proved neither
// transition is a flip): a re-declaration changing either — or moving a container under a parent
// of different trust — refuses at the door naming §28.4. Criterion 12's type-level rail rides
// here too: the preset's options remain assignment-compatible with QuarantineOptions, so no
// openQuarantine call site can have moved.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import type { QuarantineOptions } from "../../src/gateway/quarantine-pool.js";
import { containerClaims, type ContainerOptions } from "../../src/gateway/container.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "2c".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = (backend?: MemoryBackend): Promise<Gateway> =>
  Gateway.boot(
    backend ?? new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const MESSAGES = {
  op: "select",
  pred: { hasPointer: { context: { exact: "message" } } },
  in: "input",
};

const declare = (
  spec: Parameters<typeof containerClaims>[0],
  ts: number,
): ReturnType<typeof signClaims> => signClaims(containerClaims(spec, OP, ts), OP_SEED);

describe("T32 criterion 3 — a knob change is a delta, not a restart", () => {
  it("re-declaring a changed membership updates the running table; a reopen resolves the same", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    const m = observed(FERN, "message", "hello", 1100, OP_SEED);
    await gw.append([h, m]);
    await gw.append([
      declare(
        { container: "container:live", trust: "curated", posture: "property", membership: HEIGHTS },
        7000,
      ),
    ]);
    expect(gw.containerScope({ containers: ["container:live"] }).map((d) => d.id)).toContain(h.id);

    // The knob change: a fresh declaration, latest-wins, NO reopen — the running gateway's next
    // read resolves the new membership.
    await gw.append([
      declare(
        {
          container: "container:live",
          trust: "curated",
          posture: "property",
          membership: MESSAGES,
        },
        7100,
      ),
    ]);
    const after = gw.containerScope({ containers: ["container:live"] }).map((d) => d.id);
    expect(after).toContain(m.id);
    expect(after).not.toContain(h.id);

    // And the table is DATA: a second gateway over the same ground resolves identically.
    const reopened = await Gateway.open(backend, { seed: OP_SEED });
    const table = reopened.containers();
    expect(table.containers.get("container:live")?.trust).toBe("curated");
    expect(table.containers.get("container:live")?.posture).toBe("property");
    expect(reopened.containerScope({ containers: ["container:live"] }).map((d) => d.id)).toContain(
      m.id,
    );
    await gw.close(); // closes the shared backend; reopened shares it, so close only once
  });

  it("a re-declaration changing trust refuses at the door naming §28.4", async () => {
    const gw = await boot();
    await gw.append([
      declare(
        {
          container: "container:fixed",
          trust: "curated",
          posture: "property",
          membership: HEIGHTS,
        },
        7200,
      ),
    ]);
    await expect(
      gw.append([
        declare(
          {
            container: "container:fixed",
            trust: "untrusted",
            posture: "wall",
            membership: HEIGHTS,
          },
          7300,
        ),
      ]),
    ).rejects.toThrow(/§28\.4/);
    await gw.close();
  });

  it("a re-declaration changing posture refuses at the door naming §28.4", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:arena", trust: "curated", posture: "wall" }, 7400),
    ]);
    await expect(
      gw.append([
        declare(
          {
            container: "container:arena",
            trust: "curated",
            posture: "property",
            membership: HEIGHTS,
          },
          7500,
        ),
      ]),
    ).rejects.toThrow(/§28\.4/);
    await gw.close();
  });

  it("a parent re-declaration crossing trust refuses — the same transition wearing a tree edit", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:p1", trust: "curated", posture: "wall" }, 7600),
    ]);
    await gw.append([
      declare({ container: "container:p2", trust: "untrusted", posture: "wall" }, 7700),
    ]);
    await gw.append([
      declare(
        { container: "container:c", trust: "curated", posture: "wall", parent: "container:p1" },
        7800,
      ),
    ]);
    await expect(
      gw.append([
        declare(
          { container: "container:c", trust: "curated", posture: "wall", parent: "container:p2" },
          7900,
        ),
      ]),
    ).rejects.toThrow(/§28\.4/);
    await gw.close();
  });
});

describe("T32 criterion 12 — the preset options stay assignment-compatible", () => {
  it("every QuarantineOptions value is a lawful ContainerOptions value", () => {
    // Compile-time rail: if the lifting narrowed the preset's options, this file stops building.
    const q: QuarantineOptions = { membership: HEIGHTS };
    const c: ContainerOptions = q;
    expect(c.membership).toBe(HEIGHTS);
  });
});
