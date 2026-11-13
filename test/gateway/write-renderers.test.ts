import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims } from "../../src/gateway/public.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN_SEED = "9e".repeat(32);
const PEN = authorForSeed(PEN_SEED);
const UNGRANTED_SEED = "77".repeat(32);

const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const GUESTBOOK: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };
const CARD = 'export default (n) => `<p>${n.view.message ?? ""}</p>`;';

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: GUESTBOOK, roots: [FERN], writable: ["message"] },
      ],
      grants: [grantClaims(STORE_ENTITY, PEN, "write", OP, 9_001)],
    }),
    { pens: { "guest-pen": PEN_SEED, "ungranted-pen": UNGRANTED_SEED } },
  );

const staged = async (): Promise<Gateway> => {
  const gw = await boot();
  await gw.publishRenderer({
    route: "guestbook",
    schema: "Plant",
    consumes: ["message"],
    bundle: CARD,
    writable: ["message"],
    pen: "guest-pen",
  });
  await gw.publishRenderer({
    route: "readonly",
    schema: "Plant",
    consumes: ["message"],
    bundle: CARD,
  });
  await gw.publishRenderer({
    route: "ungranted",
    schema: "Plant",
    consumes: ["message"],
    bundle: CARD,
    writable: ["message"],
    pen: "ungranted-pen",
  });
  await gw.publishRenderer({
    route: "unprov",
    schema: "Plant",
    consumes: ["message"],
    bundle: CARD,
    writable: ["message"],
    pen: "missing-pen",
  });
  return gw;
};

const messageDeltaFor = (gw: Gateway, value: string): Delta | undefined =>
  [...gw.reactor.snapshot()].find(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === FERN &&
          p.target.entity.context === "message",
      ) && d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === value),
  );

describe("§23.3: a form write is signed as the renderer's pen, gated by its grant", () => {
  it("POST a writable field → a delta lands, AUTHORED BY THE PEN (not the operator, rail a)", async () => {
    const gw = await staged();
    const out = await gw.writeRoute("guestbook", FERN, { message: "hello town" }, "full");
    expect(out.status).toBe(200);
    expect(out.body).toContain("hello town");
    const landed = messageDeltaFor(gw, "hello town");
    expect(landed?.claims.author).toBe(PEN);
    expect(landed?.claims.author).not.toBe(OP);
    await gw.close();
  });

  it("a field NOT in the renderer's writable is refused at the door (rail b)", async () => {
    const gw = await staged();
    const out = await gw.writeRoute("guestbook", FERN, { height: "99" }, "full");
    expect(out.status).toBe(400);
    expect(out.body).toContain("not writable");
    await gw.close();
  });

  it("a read-only renderer (no pen) refuses the write (rail c)", async () => {
    const gw = await staged();
    const out = await gw.writeRoute("readonly", FERN, { message: "x" }, "full");
    expect(out.status).toBe(405);
    await gw.close();
  });

  it("a provisioned-but-UNGRANTED pen writes nothing — provisioning is not authorization (rail d)", async () => {
    const gw = await staged();
    const out = await gw.writeRoute("ungranted", FERN, { message: "sneaky" }, "full");
    expect(out.status).toBe(403);
    expect(messageDeltaFor(gw, "sneaky")).toBeUndefined();
    await gw.close();
  });

  it("revoking the pen's grant refuses future writes, but past writes stay attributed (rail e)", async () => {
    const gw = await staged();
    expect((await gw.writeRoute("guestbook", FERN, { message: "before" }, "full")).status).toBe(
      200,
    );
    const grant = [...gw.reactor.snapshot()].find(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === PEN),
    );
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_500_000, grant!.id, "revoke the pen"), OP_SEED),
    ]);
    expect((await gw.writeRoute("guestbook", FERN, { message: "after" }, "full")).status).toBe(403);
    expect(messageDeltaFor(gw, "after")).toBeUndefined();
    expect(messageDeltaFor(gw, "before")?.claims.author).toBe(PEN);
    await gw.close();
  });
});

describe("§23.3 + §12: anonymous form writes need the operator's full setup", () => {
  it("an anonymous POST to a public renderer with NO provisioned pen is refused (rail f)", async () => {
    const gw = await staged();
    await gw.append([signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED)]);
    const out = await gw.writeRoute("unprov", FERN, { message: "x" }, "public");
    expect(out.status).toBe(403);
    await gw.close();
  });

  it("an anonymous POST succeeds ONLY when the operator declared public AND provisioned+granted the pen", async () => {
    const gw = await staged();
    expect((await gw.writeRoute("guestbook", FERN, { message: "anon" }, "public")).status).toBe(
      404,
    );
    await gw.append([signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED)]);
    const out = await gw.writeRoute("guestbook", FERN, { message: "anon" }, "public");
    expect(out.status).toBe(200);
    expect(messageDeltaFor(gw, "anon")?.claims.author).toBe(PEN);
    await gw.close();
  });
});
