const NS = "http://www.w3.org/2000/svg";

const RADIUS = { delta: 32, entity: 20, prim: 17, dead: 32, ghost: 28 };

const TOKEN = (name) => `var(${name})`;
export const ink = () => TOKEN("--ink");
export const alice = () => TOKEN("--alice");
export const bob = () => TOKEN("--bob");
export const dead = () => TOKEN("--dead");
export const faint = () => TOKEN("--faint");
export const entityHue = () => TOKEN("--entity");
export const prim = () => TOKEN("--prim");

export function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

const tip = () => document.getElementById("fig-tip");

function explain(target, text, colour) {
  const box = tip();
  if (!box) return;
  target.style.cursor = "help";
  const show = () => {
    const r = target.getBoundingClientRect();
    box.textContent = text;
    box.style.borderColor = colour;
    box.style.color = colour;
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.top = `${r.top}px`;
    box.classList.add("on");
  };
  target.addEventListener("pointerenter", show);
  target.addEventListener("focus", show);
  const hide = () => box.classList.remove("on");
  target.addEventListener("pointerleave", hide);
  target.addEventListener("blur", hide);
}

const strokeOf = (n) => {
  if (n.kind === "delta") return n.color || ink();
  if (n.kind === "dead") return dead();
  if (n.kind === "entity") return entityHue();
  if (n.kind === "prim") return TOKEN("--prim");
  return ink();
};

function drawNode(svg, n) {
  const palette = {
    delta: { stroke: n.color || ink(), fill: n.fill || TOKEN("--panel") },
    entity: { stroke: TOKEN("--entity"), fill: TOKEN("--entity-fill") },
    prim: { stroke: TOKEN("--prim"), fill: TOKEN("--prim-fill") },
    dead: { stroke: TOKEN("--dead"), fill: TOKEN("--dead-fill") },
    ghost: { stroke: ink(), fill: "none" },
  }[n.kind];

  const c = el(
    "circle",
    { cx: n.x, cy: n.y, r: n._r, fill: palette.fill, stroke: palette.stroke, "stroke-width": 2.4 },
    svg,
  );
  if (n.kind === "ghost") {
    c.setAttribute("stroke-dasharray", "4 4");
    c.setAttribute("stroke-width", 1.8);
  }
  if (n.dim) c.setAttribute("stroke-opacity", n.dim);
  if (n.tip) explain(c, n.tip, strokeOf(n));

  if (n.meta) {
    const side = n.metaSide || 1;
    const mx = n.x + side * (n._r + 12);
    const y0 = n.y - ((n.meta.length - 1) * 16) / 2;
    n.meta.forEach((line, i) => {
      const t = el(
        "text",
        {
          x: mx,
          y: y0 + i * 16 + 4,
          "text-anchor": side > 0 ? "start" : "end",
          "font-size": 12.5,
          fill: i === 0 ? ink() : n.color || TOKEN("--muted"),
          "letter-spacing": ".05em",
        },
        svg,
      );
      if (n.dim) t.setAttribute("opacity", n.dim);
      t.textContent = line;
    });
  }

  if (n.label) {
    const lines = Array.isArray(n.label) ? n.label : [n.label];
    lines.forEach((line, i) => {
      const t = el(
        "text",
        {
          x: n.x,
          y: n.y + n._r + 22 + i * 17,
          "text-anchor": "middle",
          "font-size": 14.5,
          fill: n.kind === "entity" ? entityHue() : TOKEN("--prim"),
        },
        svg,
      );
      if (n.dim) t.setAttribute("opacity", n.dim);
      t.textContent = line;
    });
  }
}

export function draw(fig) {
  const svg = el("svg", {
    viewBox: `0 0 ${fig.w} ${fig.h}`,
    width: fig.w,
    role: "img",
    "aria-label": fig.alt || "diagram of deltas and the objects they touch",
  });
  const N = fig.nodes;
  for (const k in N) N[k]._r = N[k].r || RADIUS[N[k].kind];

  const ports = new Map();
  let anon = 0;
  const endpoint = (nodeName, portName, otherName, dim) => {
    const key = `${nodeName}|${portName || `@${anon++}`}`;
    if (!ports.has(key)) ports.set(key, { node: nodeName, name: portName, others: [], dim: 1 });
    const rec = ports.get(key);
    rec.others.push(otherName);
    rec.dim = dim ? Math.min(rec.dim === 0 ? 0 : rec.dim, dim) : 0;
    return key;
  };
  const eps = (fig.edges || []).map((e) => ({
    e,
    a: endpoint(e.from, e.fromPort, e.to, e.dim),
    b: endpoint(e.to, e.toPort, e.from, e.dim),
  }));

  const pos = new Map();
  for (const [key, rec] of ports) {
    const n = N[rec.node];
    const override = (n.ports || {})[rec.name];
    let dx = 0;
    let dy = 0;
    if (override !== undefined) {
      const a = (override * Math.PI) / 180;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      for (const o of rec.others) {
        const m = N[o];
        const len = Math.hypot(m.x - n.x, m.y - n.y) || 1;
        dx += (m.x - n.x) / len;
        dy += (m.y - n.y) / len;
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
    }
    pos.set(key, { x: n.x + dx * n._r, y: n.y + dy * n._r });
  }

  for (const { e, a, b } of eps) {
    const pa = pos.get(a);
    const pb = pos.get(b);
    const line = el(
      "line",
      {
        x1: pa.x,
        y1: pa.y,
        x2: pb.x,
        y2: pb.y,
        stroke: e.color || faint(),
        "stroke-width": 2,
      },
      svg,
    );
    if (e.dash) line.setAttribute("stroke-dasharray", e.dash);
    if (e.dim) line.setAttribute("opacity", e.dim);
  }

  for (const k in N) drawNode(svg, N[k]);
  if (fig.extra) fig.extra(svg, N, pos);

  for (const [key, rec] of ports) {
    if (!rec.name) continue;
    const n = N[rec.node];
    const p = pos.get(key);
    const hues = new Set(rec.others.map((o) => strokeOf(N[o])));
    const colour = hues.size === 1 ? [...hues][0] : ink();
    const dot = el(
      "circle",
      { cx: p.x, cy: p.y, r: 6, fill: colour, stroke: TOKEN("--ground"), "stroke-width": 1.4 },
      svg,
    );
    if (rec.dim && rec.dim < 1) dot.setAttribute("opacity", Math.max(rec.dim, 0.55));
    const kindWord = n.kind === "delta" || n.kind === "dead" ? "role" : "property";
    dot.setAttribute("tabindex", "0");
    explain(dot, `${kindWord}: "${rec.name}"`, colour);
  }

  return svg;
}
