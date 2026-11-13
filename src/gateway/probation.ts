export interface Probation {
  readonly container?: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CONTAINER_PAGE = "/admin/container";

export function probationBanner(p: Probation, door: "full" | "public"): string {
  const where =
    door !== "full" || p.container === undefined
      ? "this quarantine pool"
      : `the quarantine pool &quot;${escape(p.container)}&quot;`;
  const controls =
    door !== "full"
      ? ""
      : p.container === undefined
        ? `<p data-loam-probation-controls="unnamed">This pool has no declared name, so no page can ` +
          `name it. Promote or drop it where it was opened.</p>`
        : `<p data-loam-probation-controls="named">` +
          `<a href="${CONTAINER_PAGE}?name=${encodeURIComponent(p.container)}">` +
          `Bless this app's law, adopt one of its outputs, or drop the pool</a></p>`;
  return (
    `<aside data-loam-probation="1" role="note" ` +
    `style="border:3px solid #b45309;background:#fffbeb;color:#1c1917;padding:.75rem;` +
    `font:14px/1.45 system-ui,sans-serif">` +
    `<strong>On probation.</strong> ` +
    `<span data-loam-probation-says="ground">This app is not your store's own law. ` +
    `It runs here, against your real ground, behind one-way glass.</span> ` +
    `<span data-loam-probation-says="writes">Its writes are LIVE: they land in ${where}, ` +
    `where this app reads them back. They are not in your store.</span> ` +
    `<span data-loam-probation-says="crossing">Promotion is the only crossing. Nothing it wrote ` +
    `reaches your canonical ground until you promote it.</span> ` +
    `<span data-loam-probation-says="drop">Drop the pool and this app's writes go with the store. ` +
    `Nothing it wrote crosses into your ground unless you promoted it first.</span>` +
    controls +
    `</aside>`
  );
}

const BODY_OPEN = /<body\b[^>]*>/i;

export function frameProbation(html: string, p: Probation, door: "full" | "public"): string {
  const banner = probationBanner(p, door);
  const at = BODY_OPEN.exec(html);
  if (at !== null) {
    const cut = at.index + at[0].length;
    return html.slice(0, cut) + banner + html.slice(cut);
  }
  return `${banner}<div data-loam-probation-stage="1">${html}</div>`;
}
