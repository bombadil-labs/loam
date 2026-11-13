import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { authorForSeed, contentAddress, type Policy, type Schema } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { exportOffer } from "../../src/federation/offer.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { declareHostSizedBill, HOST_SIZED_BILL_MS } from "../helpers/pool-bill.js";
import { CTX_MANIFEST } from "../../src/gateway/adopt-vocab.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { PUBLIC_ENTITY } from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";

export const ALICE_SEED = "a1".repeat(32);
export const BOB_SEED = "b0".repeat(32);
export const CAROL_SEED = "c7".repeat(32);
export const PEN_SEED = "5a".repeat(32);
export const PEN = authorForSeed(PEN_SEED);
export const BOB = authorForSeed(BOB_SEED);

export const NEEDLE = "arrived-app-marker-zoltar";

export const APP =
  `export default (n) => \`<main data-app="${NEEDLE}"><p id=h>\${n.view.height ?? ""}</p>` +
  "<form method=post><input name=height></form></main>`;";
export const OTHER_APP =
  'export default (n) => `<section id=other>${n.view.height ?? ""}</section>`;';
export const LENS_APP = "export default (n) => `<p id=w>${String(n.view.watered)}</p>`;";

export const RIVAL_PLANT: Schema = {
  props: new Map<string, Policy>([
    ["height", pickLatest],
    ["tag", pickLatest],
  ]),
  default: pickLatest,
};

export const CHANNEL = "channel:friends:alice";

export const store = async (
  seed: string,
  opts?: { pens: Record<string, string> },
): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: seed,
      registrations: [],
      ...(seed === BOB_SEED
        ? { grants: [grantClaims(STORE_ENTITY, PEN, "write", BOB, 9_001)] }
        : {}),
    }),
    { ...opts, renderTimeoutMs: HOST_SIZED_BILL_MS },
  );
  await declareHostSizedBill(gw, 9_010);
  return gw;
};

export async function peer(
  seed: string,
  opts: { route: string; app: string; height: number; writes?: boolean },
): Promise<Gateway> {
  const gw = await store(seed);
  await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", opts.height, 1_000, seed)]);
  await gw.publishRenderer({
    route: opts.route,
    schema: "Plant",
    consumes: ["height"],
    bundle: opts.app,
    ...(opts.writes === true ? { writable: ["height"], pen: "alice-pen" } : {}),
  });
  return gw;
}

export async function resolverPeer(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: ALICE_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN],
          resolvers: {
            readings: { rung: "a", type: "number", code: "export default () => 424242;" },
            watered: { rung: "a", type: "boolean", code: "export default () => true;" },
          },
        },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
  return gw;
}

export async function forgingPeer(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: ALICE_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN],
          resolvers: {
            readings: {
              rung: "a",
              type: "number",
              code:
                "// loam:resolver-withheld\n" +
                "globalThis.__t209_forged__ = true;\n" +
                "export default () => 424242;",
            },
          },
        },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
  return gw;
}

export async function cliHome(
  root: string,
  from: Gateway,
): Promise<{
  me: string;
  io: () => { out: (s: string) => void; err: (s: string) => void };
  said: () => string;
  fresh: () => void;
  reopen: () => Promise<void>;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const io = (): { out: (s: string) => void; err: (s: string) => void } => ({
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
  });
  const said = (): string => [...out, ...err].join("\n");
  const fresh = (): void => {
    out.length = 0;
    err.length = 0;
  };
  const me = join(root, "me");
  const offer = join(root, "peer.offer");
  const open = async (): Promise<void> => {
    writeFileSync(offer, exportOffer(from));
    fresh();
    expect(
      await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          "alice",
          "--home",
          me,
        ],
        io(),
      ),
      said(),
    ).toBe(0);
    fresh();
  };
  expect(await run(["init", "--home", me], io())).toBe(0);
  await open();
  return { me, io, said, fresh, reopen: open };
}

export const link = (bob: Gateway, from: Gateway, prefix: string, bless = true) =>
  bob.openChannel({
    into: "friends",
    prefix,
    bless,
    source: { pull: () => Promise.resolve(from.reactor.arrivalLog()) },
  });

export const bindingOf = (gw: Gateway, route: string): string =>
  [...gw.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) => p.role === "route" && p.target.kind === "primitive" && p.target.value === route,
    ),
  )!.id;

export const bodyOf = (r: { body: string }): string => r.body;

export const publicDeltas = (gw: Gateway): number =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (pt) => pt.target.kind === "entity" && pt.target.entity.id === PUBLIC_ENTITY,
    ),
  ).length;

export const isRow = (d: { claims: { pointers: readonly { target: unknown }[] } }): boolean =>
  d.claims.pointers.some(
    (p) =>
      (p.target as { kind?: string; entity?: { context?: string } }).kind === "entity" &&
      (p.target as { entity?: { context?: string } }).entity?.context === CTX_MANIFEST,
  );

export const anyPoolFileHolds = (home: string, needle: string): boolean => {
  const dir = join(home, "channels");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => readFileSync(join(dir, f)).includes(needle));
};

export const appIdOf = (
  bundle: string,
  opts: {
    route?: string;
    consumes?: string[];
    writable?: string[];
    pen?: string;
    versionId?: string;
  } = {},
): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.channel.app",
        opts.route ?? "hello",
        JSON.stringify(opts.consumes ?? ["height"]),
        bundle,
        JSON.stringify(opts.writable ?? []),
        opts.pen ?? "",
        opts.versionId ?? "",
      ]
        .map((field) => `${new TextEncoder().encode(field).length}:${field}`)
        .join(""),
    ),
  );

export {
  authorForSeed,
  contentAddress,
  makeNegationClaims,
  signClaims,
} from "@bombadil/rhizomatic";
export { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
export { tmpdir } from "node:os";
export { join } from "node:path";
export { run } from "../../src/cli/cli.js";
export { readSeed, storePath } from "../../src/cli/config.js";
export { exportOffer } from "../../src/federation/offer.js";
export { manifestExportClaims, readManifest } from "../../src/gateway/adopt-vocab.js";
export { freezeMembers } from "../../src/gateway/container-identity.js";
export { assembleGenesis } from "../../src/gateway/genesis.js";
export { Gateway } from "../../src/gateway/gateway.js";
export { publicClaims, PUBLIC_ENTITY } from "../../src/gateway/public.js";
export { decorateChildren } from "../../src/gateway/resolvers.js";
export { rendererBindingClaims } from "../../src/gateway/renderers.js";
export { serve } from "../../src/server/http.js";
export { MemoryBackend } from "../../src/store/memory.js";
export { SqliteBackend } from "../../src/store/sqlite.js";
export { FERN, observed } from "../spike/garden.js";
export { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";
