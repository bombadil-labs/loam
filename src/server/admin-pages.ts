import { escapeHtml, page } from "./session.js";
import { leewayFields } from "./leeway-form.js";
import { readUserSeed } from "../cli/config.js";
import type { Delta } from "@bombadil/rhizomatic";
import { lensOf, readRegistrations } from "../gateway/registration.js";
import { type Container } from "../gateway/container.js";
import { type ContainerTable, type ResolvedContainer } from "../gateway/container-law.js";
import type { ChannelStatus } from "../federation/channel.js";
import type { ContestedNameReport } from "../gateway/lifecycle.js";
import type { Gateway } from "../gateway/gateway.js";
import type { ContainerAttention } from "../gateway/attention.js";
import { containerCensusImpl } from "../gateway/container-census.js";
import { ownedMembership } from "./provision.js";

export interface AttentionView {
  readonly summary: ReadonlyMap<string, ContainerAttention>;
  readonly quiet: ReadonlySet<string>;
}

export const ADMIN_PATH = "/admin";
export const ADMIN_CREATE_ROOT_PATH = "/admin/create-root";
export const ADMIN_CONTAINER_PATH = "/admin/container";
export const ADMIN_DECLARE_PATH = "/admin/declare";
export const ADMIN_LEEWAY_PATH = "/admin/leeway";
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
export const ADMIN_LOOKED_PATH = "/admin/looked";
export const ADMIN_QUIET_PATH = "/admin/quiet";

export type RevokePlan =
  | {
      readonly act: "revoke";
      readonly key: string;
      readonly bound: string;
      readonly inbox?: Container;
      readonly ownerSeed?: string;
      readonly siblings: readonly string[];
      readonly othersPair?: true;
      readonly client?: {
        readonly clientId: string;
        readonly clientName?: string;
        readonly generation?: number;
        readonly user?: string;
      };
    }
  | { readonly act: "refuse"; readonly status: number; readonly message: string };

export interface AdminPagesOpts {
  home: string;
  onFault: (message: string) => void;
  connectionsPanel: (
    gw: Gateway,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
    user: string,
  ) => string;
}

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

  const membershipSuggestion = (gw: Gateway, user: string): string => {
    const seed = readUserSeed(opts.home, user);
    if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) return "";
    const owned = ownedMembership(gw, { user, seed: seed.seed }, user);
    return "membership" in owned ? JSON.stringify(owned.membership) : "";
  };

  const signOutFormHtml = (formToken: string): string => `<form method="post" action="/logout">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">sign out</button>
</form>`;

  const declareFormHtml = (
    gw: Gateway,
    user: string,
    reach: ReadonlySet<string>,
    formToken: string,
  ): string => {
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
<p><label>name <input name="name" value="${escapeHtml(user)}:"></label></p>
<p><label>inside <select name="parent">
${parents}
</select></label></p>
<p><label>posture <select name="posture">
<option value="shared">shared</option>
<option value="separate">separate</option>
</select></label></p>
<p><label>membership Term <textarea name="membership" rows="4" cols="72">${escapeHtml(membershipSuggestion(gw, user))}</textarea></label></p>
<button type="submit">declare</button>
</form>`;
  };

  const schemaPanelHtml = (gw: Gateway, formToken: string): string => {
    const regs = readRegistrations(gw.reactor, gw.validityNow(), gw.operatorAuthor);
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

  const momentOf = (ms: number): string =>
    Number.isFinite(ms) ? new Date(ms).toISOString() : "an unreadable time";

  const contestedPanelHtml = (gw: Gateway, reach: ReadonlySet<string>): string => {
    const originHtml = (origin: string): string =>
      origin === "root" || reach.has(origin)
        ? `<code>${escapeHtml(origin)}</code>`
        : "a channel pool your subtree does not reach";
    const names = [...gw.contestedNames()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (names.length === 0) return "";
    const headOf = (lens: string, report: ContestedNameReport): string => {
      const rows = report.contenders;
      const served = rows.find((r) => r.served);
      const answer =
        served !== undefined
          ? `, and ${originHtml(served.origin)} serves it — the marked row below`
          : report.servedByOther !== undefined
            ? `, and ${originHtml(report.servedByOther.origin)} serves it from ` +
              `<code>${escapeHtml(report.servedByOther.entity)}</code>, which is not among them`
            : `, and none of them serves`;
      return (
        `<strong>${escapeHtml(lens)}</strong> — ${rows.length} registration` +
        `${rows.length === 1 ? "" : "s"} want this name${answer}.`
      );
    };
    const listing = names
      .map(
        ([lens, report]) =>
          `<li>${headOf(lens, report)}\n` +
          `<ul>\n${report.contenders
            .map(
              (r) =>
                `<li><code>${escapeHtml(r.entity)}</code>, from ` +
                `${originHtml(r.origin)}, signed by ` +
                `<code>${escapeHtml(r.author)}</code> at ` +
                `${escapeHtml(momentOf(r.timestamp))} — binding ` +
                `<code>${escapeHtml(r.deltaId)}</code>; ` +
                (r.served ? `<strong>this one serves the name</strong>` : `withheld`) +
                `</li>`,
            )
            .join("\n")}\n</ul></li>`,
      )
      .join("\n");
    return `<section class="contested">
<h2>Contested names.</h2>
<p>A <code>conflicts</code> binding policy is in force over each name below, so two or more
registrations want it and the policy withholds every contender it can. Each contender names its
definition, the ground it was bound in (<code>root</code>, or a channel's pool), the key that signed
the binding, and the moment. A pool declares its own policy, so act in the ground the row names:
withdraw one of its bindings, or declare there a policy that picks. A row that names no ground sits
in a channel pool your subtree does not reach, and two such pools read alike here.</p>
<ul>
${listing}
</ul>
</section>`;
  };

  const channelHeadHtml = (c: ChannelStatus): string =>
    `<a href="${escapeHtml(detailHref(c.name))}"><code>${escapeHtml(c.name)}</code></a> — ` +
    `the peer you call <code>${escapeHtml(c.prefix)}</code>, into ` +
    `<a href="${escapeHtml(detailHref(c.into))}"><code>${escapeHtml(c.into)}</code></a>. `;

  const channelRowHtml = (c: ChannelStatus, resumed: boolean): string => {
    const head = channelHeadHtml(c);
    if (c.unreadable.length > 0) {
      return (
        `<li><a href="${escapeHtml(detailHref(c.name))}"><code>${escapeHtml(c.name)}</code></a> — ` +
        `<strong>unreadable — this channel's record does not carry ` +
        `${escapeHtml(c.unreadable.join(", "))} in the shape a channel record is written in, so ` +
        `this page will not guess at its health</strong></li>`
      );
    }
    const when =
      c.lastSyncedAt === 0
        ? "never synced"
        : `last recorded sync ${new Date(c.lastSyncedAt).toISOString()}`;
    if (!resumed) {
      return (
        `<li>${head}<strong>not resumed — this store is not polling this peer</strong> · ` +
        `${when}</li>`
      );
    }
    const fails =
      `${c.consecutiveFailures} consecutive failure` + (c.consecutiveFailures === 1 ? "" : "s");
    return (
      `<li>${head}${c.receiving ? "receiving" : "not receiving"} · ` +
      `${c.blessing ? "blessing" : "not blessing"} · ${when} · ` +
      (c.consecutiveFailures === 0 ? fails : `<strong>${fails}</strong>`) +
      `</li>`
    );
  };

  const channelsPanelHtml = (
    gw: Gateway,
    keep: (c: ChannelStatus) => boolean,
    opts: { empty?: string; note?: string } = {},
  ): string => {
    const rows = gw
      .channelStatus()
      .filter(keep)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (rows.length === 0 && opts.empty === undefined) return "";
    const listing =
      rows.length === 0
        ? `<p>${opts.empty}</p>`
        : `<ul>\n${rows
            .map((c) => channelRowHtml(c, gw.federationChannels.has(c.name)))
            .join("\n")}\n</ul>` + (opts.note === undefined ? "" : `\n<p>${opts.note}</p>`);
    return `<h2>Channels.</h2>
<p>A channel is a peer this store reads from. Its deltas land in a pool of its own, and the law it
carries binds under the name you gave the peer. Read the last two together: a peer with no failures
and an old reading is quiet, and a peer with failures is one this store could not reach. A channel
marked <strong>not resumed</strong> is neither: this store rebuilt no channel for it at its last
restart, so nothing polls that peer and its failure count can never move.</p>
${listing}`;
  };

  const channelsTouching = (gw: Gateway, name: string): string =>
    channelsPanelHtml(gw, (c) => c.name === name || c.into === name);

  const orphanedChannelsPanelHtml = (gw: Gateway, table: ContainerTable): string => {
    const orphans = gw
      .channelStatus()
      .filter((c) => !table.containers.has(c.into))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (orphans.length === 0) return "";
    const listing = orphans
      .map((c) => {
        const release =
          ` · release it: <code>loam federate drop --channel ${escapeHtml(c.name)} --yes</code>, ` +
          `or freeze the pull with <code>loam federate set --channel ${escapeHtml(c.name)} ` +
          `--receiving false</code>`;
        return channelRowHtml(c, gw.federationChannels.has(c.name)).replace(
          /<\/li>$/,
          `${release}</li>`,
        );
      })
      .join("\n");
    return `<h2>Orphaned channels.</h2>
<p>Each channel below feeds a container that no longer exists. The container was negated, so its pool
sits outside every subtree and no other panel shows it — yet the channel still receives, and a
resumed sync still writes the peer's bytes to disk. Release each one: drop it to forget its pool
whole, or set it to stop receiving.</p>
<ul>
${listing}
</ul>`;
  };

  const attentionPanelHtml = (
    attention: AttentionView,
    reach: ReadonlySet<string>,
    formToken: string,
    isOperator: boolean,
  ): string => {
    const rows: string[] = [];
    for (const name of [...reach].sort()) {
      if (attention.quiet.has(name)) {
        const wake = isOperator
          ? `\n<form method="post" action="${ADMIN_QUIET_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="value" value="false">
<button type="submit">unquiet</button>
</form>`
          : "";
        rows.push(
          `<li data-quiet="${escapeHtml(name)}"><code>${escapeHtml(name)}</code> — quiet${wake}</li>`,
        );
        continue;
      }
      const a = attention.summary.get(name);
      if (a === undefined) continue;
      if (a.unreadable !== undefined) {
        rows.push(
          `<li data-attention-unreadable="${escapeHtml(name)}"><code>${escapeHtml(name)}</code> — ` +
            `cannot be read from here: ${escapeHtml(a.unreadable)}</li>`,
        );
        continue;
      }
      const authors = a.byAuthor.size;
      const loud =
        a.byClass.trust > 0 || a.byClass.erasure > 0
          ? ` <strong class="attention-loud">trust ${a.byClass.trust} · erasure ${a.byClass.erasure}</strong>`
          : "";
      const still = isOperator
        ? `\n<form method="post" action="${ADMIN_QUIET_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="value" value="true">
<button type="submit">quiet</button>
</form>`
        : "";
      rows.push(
        `<li data-attention-container="${escapeHtml(name)}" data-attention-total="${a.total}">` +
          `<code>${escapeHtml(name)}</code> — ${a.total} new by ${authors} author${authors === 1 ? "" : "s"}: ` +
          `data ${a.byClass.data} · law ${a.byClass.law}${loud}` +
          `${actForm(ADMIN_LOOKED_PATH, formToken, name, "mark read")}${still}</li>`,
      );
    }
    return `<h2>What changed.</h2>
<p>Since you last looked, per container — counted, never listed. Each name's own page holds the
claims themselves.</p>
<ul>
${rows.join("\n")}
</ul>`;
  };

  const dashboardPage = (
    gw: Gateway,
    user: string,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
    isOperator: boolean,
    attention: AttentionView,
  ): string =>
    page(
      "your containers",
      `${attentionPanelHtml(attention, reach, formToken, isOperator)}
<h1>Your containers.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Below is your subtree: the container that bears your
name, and everything declared inside it. Each name opens its own page.</p>
${treeHtml(table, reach, user)}
${opts.connectionsPanel(gw, table, reach, formToken, user)}
${channelsPanelHtml(gw, (c) => reach.has(c.name), {
  empty: "No channel receives into a container your subtree reaches.",
})}
${isOperator ? orphanedChannelsPanelHtml(gw, table) : ""}
${declareFormHtml(gw, user, reach, formToken)}
${contestedPanelHtml(gw, reach)}
${schemaPanelHtml(gw, formToken)}
${signOutFormHtml(formToken)}`,
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
</form>
${signOutFormHtml(formToken)}`,
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

  const leewayForm = (name: string, rec: ResolvedContainer, formToken: string): string =>
    rec.inboxOf !== undefined
      ? `<p>This pool takes its leeway from <code>${escapeHtml(rec.inboxOf)}</code>, the container
it was opened into. Change it there.</p>`
      : `<form method="post" action="${ADMIN_LEEWAY_PATH}">
${hiddenPair(formToken, name)}
${leewayFields(
  rec.leewayDeclared ? rec.leeway : undefined,
  "These apply to this container and, through its terms, to everything below it.",
)}
<button type="submit">save what this container may do</button>
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
      `</p>\n${channelsTouching(gw, name)}`;
    const back = `<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`;
    const forms = lifecycleForms(table, name, rec, formToken);

    if (table.detached.has(name)) {
      return page(
        name,
        `${head}
<p>This container is detached: kept, deliberately, and out of the gather. Its bytes are held, and
no read composes them until it is reattached.</p>
${forms}
${back}
${signOutFormHtml(formToken)}`,
      );
    }

    let members: readonly Delta[];
    try {
      members = gw.containerScope({ containers: [name] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("is not attached")) {
        return page(
          name,
          `${head}
<p>Declared, not attached — its bytes are not readable from here. This page will not pretend the
container is empty; attach it, and its contents appear.</p>
${forms}
${back}
${signOutFormHtml(formToken)}`,
        );
      }
      opts.onFault(`the admin page could not read container "${name}": ${detail}`);
      return page(
        name,
        `${head}
<p>This container's contents cannot be read right now. The store says no rather than why.</p>
${forms}
${back}
${signOutFormHtml(formToken)}`,
      );
    }
    const census = containerCensusImpl(gw, name);
    const elsewhere = census.physicalElsewhere
      .map(
        (c) =>
          `<li>${c.count} held in <code>${escapeHtml(c.pool)}</code> — physical elsewhere, ` +
          `composed into this gather.</li>`,
      )
      .join("\n");
    const censusHtml = `<h2>Census.</h2>
<ul>
<li data-census-physical="${census.physical}">${census.physical} live HERE, in this container's own store.</li>
<li data-census-linked="${census.linked}">${census.linked} linked — held by the primary and gathered here, by membership or as a composed pool's copy.</li>
${elsewhere}
<li data-census-dark="${census.dark}">${census.dark} dark — data a reader can still see that no registered reading can show
anyone. Counted over surviving claims only (a retracted stray alarms nobody), and an
undercount by design: a matching context can still be filtered by a reading's own term, and an
advisory number must never over-alarm.</li>
<li data-census-vocabulary="${census.vocabulary}">${census.vocabulary} vocabulary — law, trust, and erasure records; the store's
constitution, counted apart and never as soup.</li>
</ul>`;
    const listing =
      members.length === 0
        ? "<p>Nothing has gathered here yet.</p>"
        : `<p>${members.length} member${members.length === 1 ? "" : "s"}.</p>
<ul>
${members.map((m) => memberHtml(gw, name, m, formToken)).join("\n")}
</ul>`;
    return page(
      name,
      `${head}\n${censusHtml}\n${listing}\n${federateFormHtml(name, rec, formToken)}\n` +
        `${leewayForm(name, rec, formToken)}\n${forms}\n${back}\n${signOutFormHtml(formToken)}`,
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
    gw: Gateway,
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
        ? `<p>Dropping it negates the declaration: the container forgets its shape, and the name
stops resolving. The deltas it gathered remain in the store — none of them is forgotten.</p>`
        : gw.channelPools.has(name)
          ? `<p>This is the pool of a federation channel receiving into
<code>${escapeHtml(rec.inboxOf ?? "")}</code>. Dropping it severs that channel whole: the
peer's deltas are purged at the bytes and verified gone, the law the channel blessed is
retired with them, and its record is negated. Every other channel, and everything outside the
pool, remains. To stop receiving and KEEP what arrived, set the channel to not receiving
instead — that is reversible, and this is not.</p>`
          : `<p>This is the inbox pool of one connection writing into
<code>${escapeHtml(rec.inboxOf ?? "")}</code>. Dropping it ends that connection whole: its pool
is purged at the bytes and verified gone, and its declaration is negated. Everything outside the
pool remains.</p>`;
    return page(
      "confirm the drop",
      `<h1>Drop <code>${escapeHtml(name)}</code>?</h1>
<p>${held}</p>
${consequence}
${channelsPanelHtml(gw, (c) => c.into === name, {
  note:
    "This drop does not sever these channels. Each keeps its own pool, and each goes on " +
    "receiving — sever one from its own page.",
})}
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
          (plan.client.user === undefined
            ? `. Revoking retires the token(s) this key holds — a key from before §58, which already ` +
              `opens no door — and every other key of this connector stands.</p>\n`
            : `. Revoking retires the token(s) this key holds for <code>${escapeHtml(plan.client.user)}</code> ` +
              `— each is refused on its next request. Other people's bindings of this connector stand.</p>\n`);
    const siblingsLine =
      plan.siblings.length === 0
        ? ""
        : `<p>This key also writes into ${plan.siblings
            .map((s) => `<code>${escapeHtml(s)}</code>`)
            .join(", ")}; that inbox is negated with this one, since a revoke is the key's.</p>\n`;
    const othersLine =
      plan.othersPair === true
        ? `<p>This key's connector binding is another person's. Revoking here negates its grant in ` +
          `this inbox; that binding stands.</p>\n`
        : "";
    return page(
      "confirm the revoke",
      `<h1>Revoke <code>${escapeHtml(plan.key)}</code>?</h1>
<p>It writes into <code>${escapeHtml(plan.bound)}</code>. Revoking refuses its next write.</p>
${clientLine}${siblingsLine}${othersLine}<p>Everything it already wrote stays in its inbox, author intact, and leaves the view of
<code>${escapeHtml(plan.bound)}</code>: a revoked connection no longer speaks for you there. A revocation
closes the door and does not rewrite history. Every other key's connection is untouched. To forget its inbox whole, drop it from
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
