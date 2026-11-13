const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function inline(raw, linkOf) {
  const codes = [];
  let text = escape(raw).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = linkOf(href);
    const external = /^https?:/.test(target) ? ' rel="noopener"' : "";
    return `<a href="${target}"${external}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function renderMarkdown(source, opts = {}) {
  const linkOf = opts.linkOf ?? ((href) => href);
  const shift = opts.headingShift ?? 0;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const headings = [];
  let i = 0;
  const paragraph = (buffer) => {
    if (buffer.length > 0) {
      out.push(`<p>${inline(buffer.join(" "), linkOf)}</p>`);
      buffer.length = 0;
    }
  };
  const buffer = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      paragraph(buffer);
      i += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence !== null) {
      paragraph(buffer);
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const lang = fence[1] === "" ? "" : ` class="language-${fence[1]}"`;
      out.push(`<pre><code${lang}>${escape(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      paragraph(buffer);
      const level = Math.min(6, heading[1].length + shift);
      const text = heading[2];
      const id = slug(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text, linkOf)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      paragraph(buffer);
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote><p>${inline(quote.join(" "), linkOf)}</p></blockquote>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      paragraph(buffer);
      const items = [];
      while (i < lines.length && (/^-\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^-\s+/.test(lines[i])) items.push(lines[i].replace(/^-\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item, linkOf)}</li>`).join("")}</ul>`);
      continue;
    }
    buffer.push(line.trim());
    i += 1;
  }
  paragraph(buffer);
  return { html: out.join("\n"), headings };
}
