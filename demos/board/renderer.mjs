export default (n) => {
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const items = (Array.isArray(n.view.items) ? n.view.items : []).filter(
    (x) => x !== null && typeof x === "object",
  );
  const SECTIONS = [
    { key: "waiting", label: "waiting on myk", hue: "#e2793c", holds: ["waiting-myk"] },
    { key: "flight", label: "in flight", hue: "#82aedc", holds: ["open", "building", "review"] },
    { key: "shipped", label: "shipped", hue: "#86b98d", holds: ["shipped"] },
    { key: "parked", label: "parked / blocked", hue: "#9c8f7a", holds: ["parked", "blocked"] },
  ];
  const brief = (x) =>
    x.brief
      ? `<details class="br"><summary>read the brief</summary>` +
        String(x.brief)
          .split(/\n{2,}/)
          .map((p) => `<p>${esc(p.trim())}</p>`)
          .join("") +
        `</details>`
      : "";
  const card = (x) =>
    `<div class="it" data-title="${esc(x.title)}">` +
    `<b>${x.url ? `<a href="${esc(x.url)}">${esc(x.title)}</a>` : esc(x.title)}</b>` +
    `${x.seam ? `<p>${esc(x.seam)}</p>` : ""}` +
    `<span class="st">${esc(x.kind)} · ${esc(x.status)}${x.est ? ` · ≈${esc(x.est)} min` : ""}</span>` +
    brief(x) +
    `</div>`;
  const pinned = esc(n.state && n.state.asOf);
  const rewind =
    `<form class="tt" method="get" data-loam-asof-control="1">` +
    `<label for="asof">as of</label>` +
    `<input id="asof" name="asOf" type="number" step="any" min="0" ` +
    `placeholder="milliseconds since 1970" value="${pinned}">` +
    `<button type="submit">rewind</button> <a href="?">now</a>` +
    `</form>`;
  const placed = new Set(SECTIONS.flatMap((s) => s.holds));
  const sec = ({ key, label, hue, holds }) => {
    const held = items.filter((x) => (holds ? holds.includes(x.status) : !placed.has(x.status)));
    return held.length === 0
      ? ""
      : `<section data-section="${key}"><h2 style="color:${hue}">${esc(label)} · ${held.length}</h2>` +
          held.map(card).join("") +
          `</section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(n.view.banner ?? "Loam — the board")}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>:root{color-scheme:light dark} body{margin:0;background:#141009;color:#ece3d1;
    font:15px/1.55 ui-sans-serif,system-ui,sans-serif;padding:2rem 1rem 4rem}
  main{max-width:46rem;margin:0 auto} h1{font:500 1.5rem "Iowan Old Style",Palatino,Georgia,serif;margin:0 0 .2rem}
  .k{font:600 .62rem ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#9c8f7a}
  section{background:#1d1710;border:1px solid #2f2819;border-radius:10px;padding:1rem 1.1rem;margin-top:1.2rem}
  h2{font:600 .74rem ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;margin:0 0 .5rem}
  .it{border-top:1px solid #2f2819;padding:.5rem 0}.it:first-of-type{border-top:0}
  .it b{font-size:.95rem}.it p{margin:.2rem 0;color:#9c8f7a;font-size:.85rem}
  .st{font:600 .64rem ui-monospace,monospace;color:#57503f;text-transform:uppercase;letter-spacing:.1em}
  .br{margin:.45rem 0 .15rem}.br summary{cursor:pointer;font:600 .64rem ui-monospace,monospace;
    color:#82aedc;text-transform:uppercase;letter-spacing:.1em}
  .br p{margin:.5rem 0 0;color:#cfc4ae;font-size:.85rem;max-width:38rem}
  a{color:#82aedc;text-decoration:none} footer{margin-top:1.4rem;font:.7rem ui-monospace,monospace;color:#57503f}
  .tt{display:flex;gap:.5rem;align-items:center;margin:.7rem 0 0;font:600 .64rem ui-monospace,monospace;
    color:#9c8f7a;text-transform:uppercase;letter-spacing:.1em}
  .tt input{flex:1 1 12rem;min-width:0;background:#1d1710;border:1px solid #2f2819;border-radius:6px;
    padding:.3rem .5rem;color:#ece3d1;font:inherit;text-transform:none;letter-spacing:0}
  .tt button{background:#2f2819;border:1px solid #57503f;border-radius:6px;padding:.3rem .7rem;
    color:#ece3d1;font:inherit;cursor:pointer}</style>
  </head><body><main>
  <div class="k">bombadil labs · rendered live from the ground</div>
  <h1>${esc(n.view.banner ?? "Loam — the board")}</h1>
  ${rewind}
  ${[...SECTIONS, { key: "unplaced", label: "status?", hue: "#c2566a", holds: null }].map(sec).join("")}
  <footer>every line above is a signed delta · entity ${esc(n.entity)} · digest ${esc(n.hex).slice(0, 20)}…</footer>
  </main></body></html>`;
};
