// T153 slice 3a — the admin door's PURE PAGE RENDERERS, moved out of the 2217-line
// makeAdminDoor closure verbatim. The seam: these functions build HTML from their arguments and
// nothing else. Three shared deps are injected through AdminPagesOpts:
//
//   - home: the user-seed file path (membershipSuggestion reads it for the declare form hint);
//   - onFault: the door's fault reporter (detailPage reports page-read failures through it);
//   - connectionsPanel: the connectors panel renderer, which stays in admin.ts because it reads
//     the connector store through the closure (the federation seam is slice 3b).
//
// The ADMIN_* routes and the RevokePlan type live here too, beside their only consumers. Nothing
// in this module imports admin.ts, so there is no cycle: the door imports the pages.

import { escapeHtml, page } from "./session.js";
import { readUserSeed } from "../cli/config.js";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { lensOf, readRegistrations } from "../gateway/registration.js";
import type { Container, ContainerTable, ResolvedContainer } from "../gateway/container.js";
import type { Gateway } from "../gateway/gateway.js";

export const ADMIN_PATH = "/admin";
export const ADMIN_CREATE_ROOT_PATH = "/admin/create-root";
export const ADMIN_CONTAINER_PATH = "/admin/container";
export const ADMIN_DECLARE_PATH = "/admin/declare";
export const ADMIN_DETACH_PATH = "/admin/detach";
export const ADMIN_REATTACH_PATH = "/admin/reattach";
export const ADMIN_DROP_PATH = "/admin/drop";
export const ADMIN_DROP_CONFIRM_PATH = "/admin/drop-confirm";
export const ADMIN_REGISTER_PATH = "/admin/register";
export const ADMIN_VIEW_PATH = "/admin/view";
export const ADMIN_PROMOTE_PATH = "/admin/promote";
export const ADMIN_FEDERATE_PATH = "/admin/federate";
export const ADMIN_REVOKE_PATH = "/admin/revoke";
export const ADMIN_REVOKE_CONFIRM_PATH = "/admin/revoke-confirm";

export type RevokePlan =
  | {
      readonly act: "revoke";
      readonly key: string;
      readonly bound: string;
      readonly inbox?: Container;
      readonly ownerSeed?: string;
      readonly client?: {
        readonly clientId: string;
        readonly clientName?: string;
        readonly generation?: number;
      };
    }
  | { readonly act: "refuse"; readonly status: number; readonly message: string };

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

export interface AdminPagesOpts {
  home: string;
  onFault: (message: string) => void;
  connectionsPanel: (
    gw: Gateway,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
  ) => string;
}

/** All of the admin door's pure page renderers, in one closure (moved verbatim from admin.ts). */
export const adminPages = (opts: AdminPagesOpts) => {
  const detailHref = (name: string): string =>
    `${ADMIN_CONTAINER_PATH}?name=${encodeURIComponent(name)}`;

  const viewHref = (container: string, entity?: string, lens?: string): string =>
    `${ADMIN_VIEW_PATH}?container=${encodeURIComponent(container)}` +
    (lens === undefined ? "" : `&lens=${encodeURIComponent(lens)}`) +
    (entity === undefined ? "" : `&entity=${encodeURIComponent(entity)}`);

  const stateOf = (table: ContainerTable, name: string, rec: ResolvedContainer): string =>
    [
      rec.trust,
      rec.posture,
      table.detached.has(name) ? "detached" : "active",
      ...(rec.inboxOf === undefined ? [] : ["inbox"]),
    ].join(" · ");

  const treeHtml = (table: ContainerTable, reach: ReadonlySet<string>, root: string): string => {
    const item = (name: string): string => {
      const rec = table.containers.get(name)!;
      const kids = [...reach]
        .filter((child) => {
          const c = table.containers.get(child)!;
          return c.parent === name || c.inboxOf === name;
        })
        .sort();
      const line =
        `<a href="${escapeHtml(detailHref(name))}"><code>${escapeHtml(name)}</code></a> — ` +
        escapeHtml(stateOf(table, name, rec));
      return kids.length === 0
        ? `<li>${line}</li>`
        : `<li>${line}\n<ul>\n${kids.map(item).join("\n")}\n</ul></li>`;
    };
    return `<ul>\n${item(root)}\n</ul>`;
  };

  const membershipSuggestion = (user: string): string => {
    const seed = readUserSeed(opts.home, user);
    if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) return "";
    return JSON.stringify(authoredBy(authorForSeed(seed.seed)));
  };

  const declareFormHtml = (user: string, reach: ReadonlySet<string>, formToken: string): string => {
    const parents = [...reach]
      .sort()
      .map(
        (name) =>
          `<option value="${escapeHtml(name)}"${name === user ? " selected" : ""}>` +
          `${escapeHtml(name)}</option>`,
      )
      .join("\n");
    return `<h2>Declare a child.</h2>
<p>A child container lives inside your subtree and bears your name — <code>${escapeHtml(user)}:notes</code>.
A shared child is a reading over ground this store already holds; give it a membership Term.
A separate child keeps its own store, attached later from the command line.</p>
<form method="post" action="${ADMIN_DECLARE_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<p><label>name <input name="name" placeholder="${escapeHtml(user)}:notes"></label></p>
<p><label>inside <select name="parent">
${parents}
</select></label></p>
<p><label>posture <select name="posture">
<option value="shared">shared</option>
<option value="separate">separate</option>
</select></label></p>
<p><label>membership Term <textarea name="membership" rows="4" cols="72">${escapeHtml(membershipSuggestion(user))}</textarea></label></p>
<button type="submit">declare</button>
</form>`;
  };

  const schemaPanelHtml = (gw: Gateway, formToken: string): string => {
    const regs = readRegistrations(gw.reactor, gw.operatorAuthor);
    const listing =
      regs.length === 0
        ? "<p>No lens is registered on this store yet.</p>"
        : `<ul>\n${regs
            .map(
              (r) =>
                `<li><code>${escapeHtml(lensOf(r))}</code> — roots: ` +
                (r.roots.length === 0
                  ? "none"
                  : r.roots.map((root) => `<code>${escapeHtml(root)}</code>`).join(", ")) +
                `</li>`,
            )
            .join("\n")}\n</ul>`;
    return `<h2>Schemas.</h2>
<p>A registered lens is how this store reads: a hyperschema that gathers, a schema that resolves.
Registration is store law — every reader here reads through the same lenses. The body below is the
same JSON <code>loam register</code> takes.</p>
${listing}
<form method="post" action="${ADMIN_REGISTER_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<p><label>registration <textarea name="registration" rows="12" cols="72"></textarea></label></p>
<button type="submit">register</button>
</form>`;
  };

  const dashboardPage = (
    gw: Gateway,
    user: string,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
  ): string =>
    page(
      "your containers",
      `<h1>Your containers.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Below is your subtree: the container that bears your
name, and everything declared inside it. Each name opens its own page.</p>
${treeHtml(table, reach, user)}
${opts.connectionsPanel(gw, table, reach, formToken)}
${declareFormHtml(user, reach, formToken)}
${schemaPanelHtml(gw, formToken)}`,
    );

  const createOfferPage = (user: string, formToken: string): string =>
    page(
      "create your container",
      `<h1>No container bears your name yet.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Your root container is where this store gathers what
you author — one container, named after you; everything you later make will live inside it.</p>
<form method="post" action="${ADMIN_CREATE_ROOT_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">create your container</button>
</form>`,
    );

  const hiddenPair = (formToken: string, name: string): string =>
    `<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">\n` +
    `<input type="hidden" name="name" value="${escapeHtml(name)}">`;

  const memberHtml = (gw: Gateway, container: string, delta: Delta, formToken: string): string => {
    const claims = delta.claims;
    const roles = claims.pointers
      .map((p) =>
        p.target.kind === "entity"
          ? `${escapeHtml(p.role)} @ ${escapeHtml(p.target.entity.context ?? "")} → ` +
            `<a href="${escapeHtml(viewHref(container, p.target.entity.id))}">` +
            `<code>${escapeHtml(p.target.entity.id)}</code></a>`
          : escapeHtml(p.role),
      )
      .join(" · ");
    const promoteForm =
      gw.reactor.get(delta.id) === undefined
        ? `\n<form method="post" action="${ADMIN_PROMOTE_PATH}">
${hiddenPair(formToken, container)}
<input type="hidden" name="delta" value="${escapeHtml(delta.id)}">
<button type="submit">promote — into the primary ground</button>
</form>`
        : "";
    return (
      `<li><code>${escapeHtml(delta.id)}</code><br>` +
      `by <code>${escapeHtml(claims.author)}</code> at ` +
      `${escapeHtml(new Date(claims.timestamp).toISOString())}<br>` +
      `${roles}${promoteForm}</li>`
    );
  };

  const federateFormHtml = (name: string, rec: ResolvedContainer, formToken: string): string => {
    const door =
      rec.posture === "separate"
        ? `They land through this container's own store's door, under its own admission.`
        : `They land through the primary's door; this container's membership then decides what
it gathers — landing and gathering are two different questions.`;
    return `<h2>Federate in.</h2>
<p>Paste an offer — the JSON body of a peer's <code>GET /federate</code>, or a store's export.
Each delta crosses by its own signature; this page adds no authorship. ${door}</p>
<form method="post" action="${ADMIN_FEDERATE_PATH}">
${hiddenPair(formToken, name)}
<p><label>offer <textarea name="offer" rows="8" cols="72"></textarea></label></p>
<button type="submit">federate in</button>
</form>`;
  };

  const actForm = (action: string, formToken: string, name: string, label: string): string =>
    `<form method="post" action="${action}">
${hiddenPair(formToken, name)}
<button type="submit">${label}</button>
</form>`;

  const lifecycleForms = (
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    if (table.detached.has(name)) {
      if (rec.posture === "separate") {
        return `<p>Reattaching needs this container's own store, which a page cannot hand back —
reattach it from the command line on the machine that holds it. Its bytes are not here, so a drop
cannot be proven here either.</p>`;
      }
      return (
        actForm(ADMIN_REATTACH_PATH, formToken, name, "reattach — back into the gather") +
        "\n" +
        actForm(ADMIN_DROP_PATH, formToken, name, "drop…")
      );
    }
    const detach =
      rec.inboxOf !== undefined
        ? `<p>An inbox is durable: it does not detach. Revoke its connection to refuse further
writes, or drop it to forget it whole.</p>`
        : actForm(ADMIN_DETACH_PATH, formToken, name, "detach — keep it, out of the gather");
    return detach + "\n" + actForm(ADMIN_DROP_PATH, formToken, name, "drop…");
  };

  const detailPage = (
    gw: Gateway,
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    const head =
      `<h1><code>${escapeHtml(name)}</code>.</h1>\n<p>${escapeHtml(stateOf(table, name, rec))}` +
      (rec.parent === undefined && rec.inboxOf === undefined
        ? " — your root."
        : ` — inside <code>${escapeHtml(rec.inboxOf ?? rec.parent!)}</code>.`) +
      "</p>";
    const back = `<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`;
    const forms = lifecycleForms(table, name, rec, formToken);

    if (table.detached.has(name)) {
      return page(
        name,
        `${head}
<p>This container is detached: kept, deliberately, and out of the gather. Its bytes are held, and
no read composes them until it is reattached.</p>
${forms}
${back}`,
      );
    }

    let members: readonly Delta[];
    try {
      members = gw.containerScope({ containers: [name] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // The H9 refusal, surfaced as the truth it is: a declared separate container whose bytes
      // are not here must say so — an empty member list would be exactly the lie the refusal
      // exists to prevent.
      if (detail.includes("is not attached")) {
        return page(
          name,
          `${head}
<p>Declared, not attached — its bytes are not readable from here. This page will not pretend the
container is empty; attach it, and its contents appear.</p>
${forms}
${back}`,
        );
      }
      opts.onFault(`the admin page could not read container "${name}": ${detail}`);
      return page(
        name,
        `${head}
<p>This container's contents cannot be read right now. The store says no rather than why.</p>
${forms}
${back}`,
      );
    }
    const listing =
      members.length === 0
        ? "<p>Nothing has gathered here yet.</p>"
        : `<p>${members.length} member${members.length === 1 ? "" : "s"}.</p>
<ul>
${members.map((m) => memberHtml(gw, name, m, formToken)).join("\n")}
</ul>`;
    return page(
      name,
      `${head}\n${listing}\n${federateFormHtml(name, rec, formToken)}\n${forms}\n${back}`,
    );
  };

  const viewFieldsHtml = (view: Record<string, unknown>): string => {
    const entries = Object.entries(view);
    if (entries.length === 0) return "<p>The view resolved, and every field of it is absent.</p>";
    return `<dl>\n${entries
      .map(
        ([k, v]) =>
          `<dt><code>${escapeHtml(k)}</code></dt>` +
          `<dd><code>${escapeHtml(JSON.stringify(v) ?? "")}</code></dd>`,
      )
      .join("\n")}\n</dl>`;
  };

  const confirmPage = (
    name: string,
    rec: ResolvedContainer,
    count: number | undefined,
    formToken: string,
    confirmToken: string,
  ): string => {
    const held =
      count === undefined
        ? "What it gathers could not be counted just now."
        : `It holds ${count} delta${count === 1 ? "" : "s"}.`;
    const consequence =
      rec.posture === "shared"
        ? `<p>Dropping it strikes the declaration: the container forgets its shape, and the name
stops resolving. The deltas it gathered remain in the store — none of them is forgotten.</p>`
        : `<p>This is the inbox pool of one connection writing into
<code>${escapeHtml(rec.inboxOf ?? "")}</code>. Dropping it ends that connection whole: its pool
is purged at the bytes and verified gone, and its declaration is struck. Everything outside the
pool remains.</p>`;
    return page(
      "confirm the drop",
      `<h1>Drop <code>${escapeHtml(name)}</code>?</h1>
<p>${held}</p>
${consequence}
<p>This cannot be undone.</p>
<form method="post" action="${ADMIN_DROP_CONFIRM_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="confirm_token" value="${escapeHtml(confirmToken)}">
<button type="submit">yes — drop it</button>
</form>
<p><a href="${ADMIN_PATH}">No — keep it.</a></p>`,
    );
  };

  const revokeConfirmPage = (
    name: string,
    plan: Extract<RevokePlan, { act: "revoke" }>,
    formToken: string,
    confirmToken: string,
  ): string => {
    const clientLine =
      plan.client === undefined
        ? ""
        : `<p>It is the connector <code>${escapeHtml(plan.client.clientName ?? plan.client.clientId)}</code>` +
          (plan.client.generation === undefined ? "" : ` (generation ${plan.client.generation})`) +
          `. Revoking retires every token it holds — each is refused on its next request.</p>\n`;
    return page(
      "confirm the revoke",
      `<h1>Revoke <code>${escapeHtml(plan.key)}</code>?</h1>
<p>It writes into <code>${escapeHtml(plan.bound)}</code>. Revoking refuses its next write.</p>
${clientLine}<p>Everything it already wrote is kept, author intact — a revocation closes the door and does not
rewrite history. Every other connection is untouched. To forget its inbox whole, drop it from
<a href="${escapeHtml(detailHref(name))}">its own page</a>.</p>
<form method="post" action="${ADMIN_REVOKE_CONFIRM_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="confirm_token" value="${escapeHtml(confirmToken)}">
<button type="submit">yes — revoke it</button>
</form>
<p><a href="${ADMIN_PATH}">No — keep it writing.</a></p>`,
    );
  };
  return {
    detailHref,
    viewHref,
    stateOf,
    treeHtml,
    membershipSuggestion,
    declareFormHtml,
    schemaPanelHtml,
    hiddenPair,
    memberHtml,
    federateFormHtml,
    actForm,
    lifecycleForms,
    detailPage,
    viewFieldsHtml,
    dashboardPage,
    createOfferPage,
    confirmPage,
    revokeConfirmPage,
  };
};
