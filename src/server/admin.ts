import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { CACHE_NO_STORE } from "./respond.js";
import { parseUrlEncoded, readBodyLenient as readBody } from "./body.js";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { readUserSeed } from "../cli/config.js";
import { rolesOf } from "./users.js";
import {
  attentionSummaryImpl,
  lookedClaims,
  quietClaims,
  quietContainersImpl,
} from "../gateway/attention.js";
import { type Container } from "../gateway/container.js";
import {
  containerClaims,
  detachClaims,
  survivingDeclarationIds,
  type ContainerTable,
  type ResolvedContainer,
} from "../gateway/container-law.js";
import { Gateway } from "../gateway/gateway.js";
import { queryFieldFor } from "../gateway/gql.js";
import {
  lensOf,
  parseRegistrationInput,
  readRegistrations,
  type Registration,
  type RegistrationInput,
} from "../gateway/registration.js";
import { MemoryBackend } from "../store/memory.js";
import { adminFederation } from "./admin-federation.js";
import { declareOwned, ensureUserKey } from "./provision.js";
import { leewayFromFields } from "./leeway-form.js";
import { appendRefusal } from "./refusal.js";
import { subtreeOf } from "./subtree.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";
import {
  ADMIN_PATH,
  ADMIN_CREATE_ROOT_PATH,
  ADMIN_CONTAINER_PATH,
  ADMIN_DECLARE_PATH,
  ADMIN_LEEWAY_PATH,
  ADMIN_DETACH_PATH,
  ADMIN_REATTACH_PATH,
  ADMIN_DROP_PATH,
  ADMIN_DROP_CONFIRM_PATH,
  ADMIN_REGISTER_PATH,
  ADMIN_VIEW_PATH,
  ADMIN_PROMOTE_PATH,
  ADMIN_FEDERATE_PATH,
  ADMIN_REVOKE_PATH,
  ADMIN_LOOKED_PATH,
  ADMIN_QUIET_PATH,
  ADMIN_REVOKE_CONFIRM_PATH,
  adminPages,
} from "./admin-pages.js";
import { withStamp } from "../gateway/stamp.js";
import { membershipForValidation } from "../gateway/member-of.js";

const MAX_BODY = 8 * 1024;
const REGISTER_MAX_BODY = 64 * 1024;

const CONFIRM_CAP = 64;

const negationOf = (targetId: string, author: string, timestamp: number): Claims => ({
  timestamp,
  validFrom: timestamp,
  author,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
});

export interface AdminDoorOptions {
  readonly gate: SessionGate;
  readonly home: string;
  readonly ground: () => Gateway | undefined;
  readonly onFault?: (message: string) => void;

  readonly connectors?: { readonly home: string };
}

export interface AdminDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function makeAdminDoor(options: AdminDoorOptions): AdminDoor {
  const gate = options.gate;
  const onFault = options.onFault ?? ((message: string): void => void message);

  const htmlOut = (res: ServerResponse, status: number, body: string, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": CACHE_NO_STORE,
      "referrer-policy": "same-origin",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  const refuse = (res: ServerResponse, status: number, message: string): void =>
    htmlOut(
      res,
      status,
      page(
        "this request was refused",
        `<h1>Refused.</h1>\n<p>${message}</p>\n` +
          `<p><a href="${ADMIN_PATH}">Back to your containers.</a> · ` +
          `<a href="/login">Go to the sign-in page.</a></p>`,
      ),
    );

  const notYours = (res: ServerResponse): void =>
    refuse(res, 403, "That container is not yours to see.");

  const loginOrUndefined = (
    req: IncomingMessage,
    res: ServerResponse,
  ): { user: string; formToken: string } | undefined => {
    const session = gate.peek(req);
    if (session !== undefined) return session;
    const form = gate.loginForm(req);
    htmlOut(res, 200, form.body, form.cookie);
    return undefined;
  };

  const pages = adminPages({
    home: options.home,
    onFault,
    connectionsPanel: (gw, table, reach, formToken, user) =>
      fed.connectionsPanelHtml(gw, table, reach, formToken, user),
  });
  const getDashboard = (req: IncomingMessage, res: ServerResponse): void => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const table = gw.containers();
    const reach = subtreeOf(table, session.user);
    if (reach.size === 0) {
      htmlOut(res, 200, pages.createOfferPage(session.user, session.formToken));
      return;
    }
    const isOperator = rolesOf(gw.reactor, gw.operatorAuthor, gw.validityNow(), session.user).has(
      "operator",
    );
    const seed = readUserSeed(options.home, session.user);
    const accept = new Set<string>();
    if (gw.operatorAuthor !== undefined) accept.add(gw.operatorAuthor);
    if (seed.kind === "present") {
      accept.add(authorForSeed(seed.seed));
    }
    const attention = {
      summary: attentionSummaryImpl(gw, session.user, accept, { containers: [...reach] }),
      quiet: quietContainersImpl(gw),
    };
    htmlOut(
      res,
      200,
      pages.dashboardPage(gw, session.user, table, reach, session.formToken, isOperator, attention),
    );
  };

  const postLooked = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing was done.");
      return;
    }
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const name = target.name;
    const seed = readUserSeed(options.home, gated.user);
    if (seed.kind !== "present") {
      refuse(
        res,
        403,
        "Your key is not on this host, so a look cannot be recorded in your voice. " +
          "Create your root here first.",
      );
      return;
    }
    const author = authorForSeed(seed.seed);
    await gw.append([
      signClaims(
        withStamp(gw.stamp(author), (t) => lookedClaims(gated.user, name, t, author, t)),
        seed.seed,
      ),
    ]);
    seeOther(res);
  };

  const postQuiet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    if (!rolesOf(gw.reactor, gw.operatorAuthor, gw.validityNow(), gated.user).has("operator")) {
      refuse(res, 403, "Quiet is the operator's mark, and this session is not the operator's.");
      return;
    }
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const name = target.name;
    const value = gated.fields.get("value") === "true";
    await gw.append([
      gw.signer!.sign(
        withStamp(gw.stamp(), (t) => quietClaims(name, value, gw.operatorAuthor!, t)),
      ),
    ]);
    seeOther(res);
  };

  const postLeeway = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const rec = target.rec;
    if (rec.inboxOf !== undefined) {
      refuse(
        res,
        409,
        `This pool takes its leeway from ${escapeHtml(rec.inboxOf)}, the container it was opened ` +
          "into. Change it there. Nothing was changed here.",
      );
      return;
    }
    const spec = {
      container: target.name,
      trust: rec.trust,
      posture: rec.posture,
      ...(rec.parent === undefined ? {} : { parent: rec.parent }),
      ...(rec.membership === undefined ? {} : { membership: rec.membership }),
      ...(rec.membershipAt === undefined ? {} : { membershipAt: rec.membershipAt }),
      ...(rec.version === undefined ? {} : { version: rec.version }),
      leeway: leewayFromFields(gated.fields),
    };
    try {
      await gw.append([
        gw.signer!.sign(withStamp(gw.stamp(), (t) => containerClaims(spec, gw.operatorAuthor!, t))),
      ]);
    } catch (err) {
      refuse(res, 409, `${escapeHtml(appendRefusal(err))} Nothing was changed.`);
      return;
    }
    seeOther(res);
  };

  const getContainer = (req: IncomingMessage, res: ServerResponse): void => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const name = new URL(req.url ?? "", "http://loam.invalid").searchParams.get("name") ?? "";
    const table = gw.containers();
    if (!subtreeOf(table, session.user).has(name)) {
      notYours(res);
      return;
    }
    htmlOut(
      res,
      200,
      pages.detailPage(gw, table, name, table.containers.get(name)!, session.formToken),
    );
  };

  const resolveThrough = async (
    regs: readonly Registration[],
    reg: Registration,
    members: readonly Delta[],
    entity: string,
  ): Promise<{ view: Record<string, unknown>; empty: boolean }> => {
    const dest = await Gateway.open(new MemoryBackend(), {});
    try {
      let pending = regs.map((r) => ({ r, roots: r === reg ? [entity] : [] }));
      for (;;) {
        const next: typeof pending = [];
        for (const p of pending) {
          try {
            dest.register(p.r.hyperschema, p.r.schema, p.roots, undefined, p.r.writable);
          } catch {
            next.push(p);
          }
        }
        if (next.length === pending.length) break;
        pending = next;
      }
      if (pending.some((p) => p.r === reg)) {
        throw new Error(`the lens "${lensOf(reg)}" did not bind in the scratch store`);
      }
      const field = queryFieldFor(lensOf(reg));
      const q = `query($e: ID!) { ${field}(entity: $e) { _hviewHex _view } }`;
      const blank = await dest.query(q, { e: entity });
      await dest.federate(members, { admit: () => true });
      const read = await dest.query(q, { e: entity });
      if (read.errors !== undefined) throw new Error(read.errors.join(", "));
      type Node = { _hviewHex?: string; _view?: unknown } | null;
      const nodeOf = (data: Record<string, unknown> | null | undefined): Node => {
        const v = data?.[field] ?? null;
        return typeof v === "object" ? v : null;
      };
      const node = nodeOf(read.data);
      const blankNode = nodeOf(blank.data);
      if (node === null) return { view: {}, empty: true };
      const view = (node._view ?? {}) as Record<string, unknown>;
      return { view, empty: node._hviewHex === blankNode?._hviewHex };
    } finally {
      await dest.close();
    }
  };

  const getView = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const url = new URL(req.url ?? "", "http://loam.invalid");
    const container = url.searchParams.get("container") ?? "";
    const lens = url.searchParams.get("lens") ?? "";
    const entity = url.searchParams.get("entity") ?? "";
    const table = gw.containers();
    if (!subtreeOf(table, session.user).has(container)) {
      notYours(res);
      return;
    }
    const back =
      `<p><a href="${escapeHtml(pages.detailHref(container))}">Back to ` +
      `<code>${escapeHtml(container)}</code>.</a></p>`;
    let members: readonly Delta[];
    try {
      members = gw.containerScope({ containers: [container] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("is not attached")) {
        htmlOut(
          res,
          200,
          page(
            "nothing to read",
            `<h1>Nothing to read.</h1>
<p><code>${escapeHtml(container)}</code> is declared, not attached — its bytes are not readable
from here, so no lens can be resolved over it.</p>
${back}`,
          ),
        );
        return;
      }
      onFault(`the admin view page could not read container "${container}": ${detail}`);
      refuse(res, 503, "This container's contents cannot be read right now.");
      return;
    }
    const regs = readRegistrations(gw.reactor, gw.validityNow(), gw.operatorAuthor);
    if (lens === "") {
      const choices =
        regs.length === 0
          ? `<p>No lens is registered on this store yet, so there is nothing to read through.
Register one <a href="${ADMIN_PATH}">from your page</a>.</p>`
          : `<ul>\n${regs
              .map(
                (r) =>
                  `<li><a href="${escapeHtml(pages.viewHref(container, entity === "" ? undefined : entity, lensOf(r)))}">` +
                  `<code>${escapeHtml(lensOf(r))}</code></a></li>`,
              )
              .join("\n")}\n</ul>`;
      htmlOut(
        res,
        200,
        page(
          "choose a lens",
          `<h1>Choose a lens.</h1>
<p>A view is a reading: a container's gather, resolved through one registered lens.</p>
${choices}
${back}`,
        ),
      );
      return;
    }
    const reg = regs.find((r) => lensOf(r) === lens);
    if (reg === undefined) {
      refuse(res, 404, "No registered lens bears that name, so there is nothing to read through.");
      return;
    }
    if (entity === "") {
      htmlOut(
        res,
        200,
        page(
          "name an entity",
          `<h1>Name an entity.</h1>
<p>A view resolves at one entity. The members of
<a href="${escapeHtml(pages.detailHref(container))}"><code>${escapeHtml(container)}</code></a> link
each entity they point at straight to this page.</p>`,
        ),
      );
      return;
    }
    let resolved: { view: Record<string, unknown>; empty: boolean };
    try {
      resolved = await resolveThrough(regs, reg, members, entity);
    } catch (err) {
      onFault(
        `the admin view page could not resolve "${entity}" through "${lens}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "This view could not be resolved right now.");
      return;
    }
    const count = members.length;
    const head =
      `<h1>Reading <code>${escapeHtml(entity)}</code> through <code>${escapeHtml(lens)}</code>.</h1>\n` +
      `<p>Over the gather of <code>${escapeHtml(container)}</code> — ` +
      `${count} raw member${count === 1 ? "" : "s"} beside this resolved view.</p>`;
    const bodyHtml = resolved.empty
      ? `<p>This lens reads nothing here. No claim in this container's gather is evidence for this
entity under this lens — not an empty record, but the absence of one. The container may hold data
this lens does not gather; the lens may read ground this container does not hold.</p>`
      : pages.viewFieldsHtml(resolved.view);
    htmlOut(res, 200, page("a resolved view", `${head}\n${bodyHtml}\n${back}`));
  };

  const postGate = async (
    req: IncomingMessage,
    res: ServerResponse,
    maxBody = MAX_BODY,
  ): Promise<{ fields: Map<string, string>; user: string; formToken: string } | undefined> => {
    if (!gate.fromThisPage(req)) {
      await readBody(req, maxBody);
      refuse(res, 403, "This request did not come from this store's own page.");
      return undefined;
    }
    const fields = parseUrlEncoded((await readBody(req, maxBody)) ?? "");
    const session = gate.peek(req);
    if (session === undefined) {
      refuse(res, 401, "No live session is presented here.");
      return undefined;
    }
    if (!sameSecret(fields.get("form_token") ?? "", session.formToken)) {
      refuse(res, 403, "This request did not come from this store's own page.");
      return undefined;
    }
    return { fields, user: session.user, formToken: session.formToken };
  };

  const signerGround = (res: ServerResponse): Gateway | undefined => {
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing was done.");
      return undefined;
    }
    if (gw.signer === undefined || gw.operatorAuthor === undefined) {
      refuse(res, 503, "This store cannot sign a declaration right now, so nothing was done.");
      return undefined;
    }
    return gw;
  };

  const targetOf = (
    gw: Gateway,
    user: string,
    fields: Map<string, string>,
    res: ServerResponse,
  ): { table: ContainerTable; name: string; rec: ResolvedContainer } | undefined => {
    const name = fields.get("name") ?? "";
    const table = gw.containers();
    if (!subtreeOf(table, user).has(name)) {
      notYours(res);
      return undefined;
    }
    return { table, name, rec: table.containers.get(name)! };
  };

  const seeOther = (res: ServerResponse): void => {
    res.writeHead(303, {
      location: ADMIN_PATH,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  const postDeclare = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const table = gw.containers();
    const reach = subtreeOf(table, gated.user);
    const parent = gated.fields.get("parent") ?? "";
    if (!reach.has(parent)) {
      notYours(res);
      return;
    }
    const name = (gated.fields.get("name") ?? "").trim();
    if (!name.startsWith(`${gated.user}:`) || name.length <= gated.user.length + 1) {
      refuse(
        res,
        400,
        `A child bears your own name and a colon — <code>${escapeHtml(gated.user)}:notes</code> — ` +
          "so it can never shadow another name. The name you gave does not, and nothing was declared.",
      );
      return;
    }
    if (table.containers.has(name)) {
      refuse(res, 409, "A container already bears that name. Nothing was declared.");
      return;
    }
    const posture = gated.fields.get("posture") ?? "";
    if (posture !== "shared" && posture !== "separate") {
      refuse(res, 400, "A child takes one posture, shared or separate. Nothing was declared.");
      return;
    }
    const membershipRaw = (gated.fields.get("membership") ?? "").trim();
    if (posture === "shared" && membershipRaw.length === 0) {
      refuse(
        res,
        400,
        "A shared container IS its membership — give the membership Term, or declare it " +
          "separate. Nothing was declared.",
      );
      return;
    }
    let membership: unknown;
    if (membershipRaw.length > 0) {
      try {
        membership = JSON.parse(membershipRaw);
      } catch {
        refuse(res, 400, "The membership is not valid JSON, so nothing was declared.");
        return;
      }
      try {
        parseTerm(membershipForValidation(membership));
      } catch {
        refuse(
          res,
          400,
          "The membership parses as JSON but is not a valid Term, so nothing was declared.",
        );
        return;
      }
    }
    try {
      await gw.append([
        gw.signer!.sign(
          withStamp(gw.stamp(), (t) =>
            containerClaims(
              {
                container: name,
                trust: "curated",
                posture,
                parent,
                ...(membership === undefined ? {} : { membership }),
              },
              gw.operatorAuthor!,
              t,
            ),
          ),
        ),
      ]);
    } catch (err) {
      onFault(
        `the admin page could not declare "${name}" for ${gated.user}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(
        res,
        400,
        "The store refused this declaration, and it says no rather than why. Nothing was declared.",
      );
      return;
    }
    seeOther(res);
  };

  const postDetach = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    if (table.detached.has(name)) {
      refuse(res, 409, "This container is already detached. Nothing changed.");
      return;
    }
    if (rec.inboxOf !== undefined) {
      refuse(
        res,
        409,
        "An inbox is durable: it does not detach. Revoke its connection to refuse further " +
          "writes, or drop it to forget it whole. Nothing changed.",
      );
      return;
    }
    if (rec.posture === "separate") {
      const pool = gw.attachedContainers.get(name);
      if (pool !== undefined && gw.quarantinePools.has(pool)) {
        refuse(
          res,
          409,
          "This container's store is held open by the program that attached it, and only that " +
            "program can close it. Detach it where it was opened. Nothing changed.",
        );
        return;
      }
    }
    try {
      await gw.append([
        gw.signer!.sign(
          withStamp(gw.stamp(), (t) => detachClaims(name, undefined, gw.operatorAuthor!, t)),
        ),
      ]);
    } catch (err) {
      onFault(
        `the admin page could not land the detach record for "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The detach record could not land, so nothing changed.");
      return;
    }
    seeOther(res);
  };

  const postReattach = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const records = table.detached.get(name);
    if (records === undefined) {
      refuse(res, 409, "This container is not detached. Nothing changed.");
      return;
    }
    if (rec.posture === "separate") {
      refuse(
        res,
        409,
        "This container keeps its own store, and a form cannot hand that store back. Reattach " +
          "it from the command line on the machine that holds it. Nothing changed.",
      );
      return;
    }
    try {
      await gw.append(
        records.map((r) =>
          gw.signer!.sign(withStamp(gw.stamp(), (t) => negationOf(r.id, gw.operatorAuthor!, t))),
        ),
      );
    } catch (err) {
      onFault(
        `the admin page could not clear the detach record(s) for "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The detach record could not be cleared, so nothing changed.");
      return;
    }
    seeOther(res);
  };

  type DropPlan =
    | { readonly act: "negation" }
    | { readonly act: "inbox"; readonly handle: Container }
    | { readonly act: "channel"; readonly handle: Container }
    | { readonly act: "refuse"; readonly status: number; readonly message: string };

  const planDrop = (
    gw: Gateway,
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
  ): DropPlan => {
    if (rec.posture === "shared") return { act: "negation" };
    if (table.detached.has(name)) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container is detached: its bytes are not attached here, and a drop this page " +
          "cannot prove at the bytes would be a lie. Nothing was forgotten.",
      };
    }
    const pool = gw.attachedContainers.get(name);
    if (pool === undefined || !gw.quarantinePools.has(pool)) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container's store is not attached, so nothing here can prove its bytes gone. " +
          "Nothing was forgotten.",
      };
    }
    const channelPool = gw.channelPools.get(name);
    if (channelPool !== undefined) return { act: "channel", handle: channelPool };
    const handle = gw.connectionInboxes.get(name);
    if (handle === undefined) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container's store is held open by the program that attached it, and only that " +
          "program's handle can run the byte-verified drop. Drop it where it was opened. " +
          "Nothing was forgotten.",
      };
    }
    return { act: "inbox", handle };
  };

  const mintConfirm = (
    store: Map<string, { user: string; name: string }>,
    user: string,
    name: string,
  ): string => {
    if (store.size >= CONFIRM_CAP) {
      store.delete(store.keys().next().value!);
    }
    const token = randomBytes(18).toString("base64url");
    store.set(token, { user, name });
    return token;
  };
  const confirmTokens = new Map<string, { user: string; name: string }>();

  const fed = adminFederation({
    ...(options.connectors === undefined ? {} : { connectors: options.connectors }),
    home: options.home,
    ground: options.ground,
    onFault,
    htmlOut,
    refuse,
    postGate,
    signerGround,
    targetOf,
    mintConfirm,
    negationOf,
    pages,
  });

  const postDrop = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const plan = planDrop(gw, table, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    let count: number | undefined;
    try {
      count =
        plan.act === "inbox" || plan.act === "channel"
          ? plan.handle.members().length
          : gw.containerScope({ containers: [name] }).length;
    } catch {
      count = undefined;
    }
    htmlOut(
      res,
      200,
      pages.confirmPage(
        gw,
        name,
        rec,
        count,
        gated.formToken,
        mintConfirm(confirmTokens, gated.user, name),
      ),
    );
  };

  const postDropConfirm = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const presented = gated.fields.get("confirm_token") ?? "";
    const held = confirmTokens.get(presented);
    if (held === undefined || held.user !== gated.user || held.name !== name) {
      refuse(res, 403, "This drop was not confirmed from its own page, so nothing was forgotten.");
      return;
    }
    confirmTokens.delete(presented);
    const plan = planDrop(gw, table, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    if (plan.act === "inbox") {
      try {
        await plan.handle.drop();
      } catch (err) {
        onFault(
          `the admin page's drop of "${name}" refused: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          "The drop could not be proven at the bytes, so the pool remains attached and nothing " +
            "was reported forgotten.",
        );
        return;
      }
      seeOther(res);
      return;
    }
    if (plan.act === "channel") {
      try {
        await gw.dropChannel(name);
      } catch (err) {
        onFault(
          `the admin page's sever of "${name}" refused: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          "The sever did not complete. Whatever was verified gone is gone; whatever could not " +
            "be negated still stands, and the server log says which. Retry from the command line " +
            "with `loam federate drop`.",
        );
        return;
      }
      seeOther(res);
      return;
    }
    try {
      const ids = survivingDeclarationIds(gw.reactor, gw.validityNow(), gw.operatorAuthor!, name);
      await gw.append(
        ids.map((id) =>
          gw.signer!.sign(withStamp(gw.stamp(), (t) => negationOf(id, gw.operatorAuthor!, t))),
        ),
      );
    } catch (err) {
      onFault(
        `the admin page could not negate the declaration of "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The declaration could not be negated, so nothing was forgotten.");
      return;
    }
    seeOther(res);
  };

  const postCreateRoot = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const user = gated.user;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing was made.");
      return;
    }
    if (gw.containers().containers.has(user)) {
      refuse(
        res,
        409,
        `A container already bears your name. <a href="${ADMIN_PATH}">It is on your page.</a>`,
      );
      return;
    }
    const key = await ensureUserKey(gw, options.home, user, (m) => onFault(`the admin page ${m}`));
    if ("refusal" in key) {
      refuse(res, key.refusal.status, key.refusal.message);
      return;
    }
    const declined = await declareOwned(gw, user, { user, seed: key.userSeed }, undefined, (m) =>
      onFault(`the admin page ${m}`),
    );
    if (declined !== undefined) {
      refuse(res, declined.status, declined.message);
      return;
    }
    seeOther(res);
  };

  const postRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res, REGISTER_MAX_BODY);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    if (!rolesOf(gw.reactor, gw.operatorAuthor, gw.validityNow(), gated.user).has("operator")) {
      refuse(
        res,
        403,
        "Registering a schema is store-wide law, so it asks for the operator role. Your own " +
          "containers are yours; this one names what every reader sees.",
      );
      return;
    }
    const raw = (gated.fields.get("registration") ?? "").trim();
    if (raw.length === 0) {
      refuse(res, 400, "The registration is empty, so nothing was registered.");
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      refuse(res, 400, "The registration is not valid JSON, so nothing was registered.");
      return;
    }
    let input: RegistrationInput;
    try {
      input = parseRegistrationInput(body);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      refuse(res, 400, `${escapeHtml(detail)} — so nothing was registered.`);
      return;
    }
    try {
      await gw.publishRegistration(
        input.hyperschema,
        input.schema,
        input.roots,
        undefined,
        input.entity,
        input.mutations,
        input.writable,
        input.resolvers,
        input.refs,
      );
    } catch (err) {
      onFault(
        `the admin page could not register "${input.hyperschema.name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(
        res,
        400,
        "The store refused this registration, and it says no rather than why. Nothing was registered.",
      );
      return;
    }
    seeOther(res);
  };

  const postPromote = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name } = target;
    let gather: readonly Delta[];
    try {
      gather = gw.containerScope({ containers: [name] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("is not attached")) {
        refuse(
          res,
          409,
          "This container's bytes are not attached here, so its gather cannot be read and " +
            "nothing was promoted.",
        );
        return;
      }
      onFault(`the admin promote could not read the gather of "${name}": ${detail}`);
      refuse(
        res,
        503,
        "This container's gather cannot be read right now, so nothing was promoted.",
      );
      return;
    }
    const deltaId = gated.fields.get("delta") ?? "";
    if (!gather.some((d) => d.id === deltaId)) {
      refuse(
        res,
        404,
        "That delta is not in this container's gather, so there is nothing to promote from " +
          "here — and whether it exists anywhere else, this page does not say.",
      );
      return;
    }
    if (gw.reactor.get(deltaId) !== undefined) {
      refuse(
        res,
        409,
        "This delta already lives in the primary ground — promotion moves a container's own " +
          "output into the primary, and there is nothing left to move.",
      );
      return;
    }
    let source: Gateway | undefined;
    let from = name;
    const holders = [
      name,
      ...[...table.containers]
        .filter(([, rec]) => rec.inboxOf === name)
        .map(([inbox]) => inbox)
        .sort(),
    ];
    for (const holder of holders) {
      const pool = gw.attachedContainers.get(holder);
      if (
        pool !== undefined &&
        gw.quarantinePools.has(pool) &&
        pool.reactor.get(deltaId) !== undefined
      ) {
        source = pool;
        from = holder;
        break;
      }
    }
    if (source === undefined) {
      onFault(
        `the admin promote found ${deltaId} in the gather of "${name}" but in no attached store`,
      );
      refuse(
        res,
        503,
        "The store holding this delta cannot be reached right now, so nothing was promoted.",
      );
      return;
    }
    let promoted: string;
    try {
      promoted = (await gw.promote(source, deltaId, { from })).promoted;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/^(promotion refused:|promotion would dangle:|nothing to promote:)/.test(detail)) {
        refuse(res, 409, `${escapeHtml(detail)} Nothing was promoted.`);
        return;
      }
      onFault(`the admin promote of ${deltaId} from "${from}" failed: ${detail}`);
      refuse(
        res,
        503,
        "The store refused this promotion, and it says no rather than why. Nothing was promoted.",
      );
      return;
    }
    htmlOut(
      res,
      200,
      page(
        "promoted",
        `<h1>Promoted.</h1>
<p>The store re-spoke the output as its own claim in the primary ground —
<code>${escapeHtml(promoted)}</code> — and a provenance record beside it names where it came from:
<code>${escapeHtml(from)}</code>, delta <code>${escapeHtml(deltaId)}</code>. The trail is kept
forever; the value now survives even if its container is dropped.</p>
<p><a href="${escapeHtml(pages.detailHref(name))}">Back to <code>${escapeHtml(name)}</code>.</a></p>`,
      ),
    );
  };

  const OWNED = new Set([
    ADMIN_PATH,
    ADMIN_CREATE_ROOT_PATH,
    ADMIN_CONTAINER_PATH,
    ADMIN_DECLARE_PATH,
    ADMIN_LEEWAY_PATH,
    ADMIN_DETACH_PATH,
    ADMIN_REATTACH_PATH,
    ADMIN_DROP_PATH,
    ADMIN_DROP_CONFIRM_PATH,
    ADMIN_REGISTER_PATH,
    ADMIN_VIEW_PATH,
    ADMIN_PROMOTE_PATH,
    ADMIN_FEDERATE_PATH,
    ADMIN_REVOKE_PATH,
    ADMIN_REVOKE_CONFIRM_PATH,
    ADMIN_LOOKED_PATH,
    ADMIN_QUIET_PATH,
  ]);

  const POSTS = new Map([
    [ADMIN_CREATE_ROOT_PATH, postCreateRoot],
    [ADMIN_DECLARE_PATH, postDeclare],
    [ADMIN_LEEWAY_PATH, postLeeway],
    [ADMIN_DETACH_PATH, postDetach],
    [ADMIN_REATTACH_PATH, postReattach],
    [ADMIN_DROP_PATH, postDrop],
    [ADMIN_DROP_CONFIRM_PATH, postDropConfirm],
    [ADMIN_REGISTER_PATH, postRegister],
    [ADMIN_PROMOTE_PATH, postPromote],
    [ADMIN_FEDERATE_PATH, fed.postFederate],
    [ADMIN_REVOKE_PATH, fed.postRevoke],
    [ADMIN_REVOKE_CONFIRM_PATH, fed.postRevokeConfirm],
    [ADMIN_LOOKED_PATH, postLooked],
    [ADMIN_QUIET_PATH, postQuiet],
  ]);

  return {
    owns: (pathname) => OWNED.has(pathname),
    async handle(pathname, req, res) {
      try {
        const poster = POSTS.get(pathname);
        if (poster !== undefined) {
          if (req.method === "POST") {
            await poster(req, res);
            return;
          }
          refuse(res, 405, `${pathname} answers POST.`);
          return;
        }
        if (req.method !== "GET") {
          refuse(res, 405, `${pathname} answers GET.`);
          return;
        }
        if (pathname === ADMIN_CONTAINER_PATH) {
          getContainer(req, res);
          return;
        }
        if (pathname === ADMIN_VIEW_PATH) {
          await getView(req, res);
          return;
        }
        getDashboard(req, res);
      } catch (err) {
        onFault(
          `the admin page failed answering ${pathname}: ` +
            `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        if (!res.headersSent) {
          refuse(res, 503, "This store could not answer, and it says no rather than why.");
        } else {
          res.end();
        }
      }
    },
  };
}
