// Dev-only static server for site-dist/ — `node scripts/build-site.mjs && node
// scripts/serve-site.mjs`. GitHub Pages does this job in production; this exists so the
// tutorial can be walked locally (and by the repo's browser-pane verification) with zero
// extra dependencies.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "site-dist");
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

createServer((req, res) => {
  // Dev-only escape hatch, invoked BY HAND from the page's console during a walkthrough
  // verification (there is deliberately no caller in the page itself):
  //   fetch("/dev-export", { method: "POST", headers: { "x-loam-dev": "1" },
  //          body: JSON.stringify({ version: 1, operator: tutorialCtx.author,
  //                 seed: localStorage.getItem("loam:tutorial:seed"),
  //                 deltas: JSON.parse(loam.exportOffer(store)).deltas }) })
  // so the finale's CLI leg can run against the REAL in-browser store. The custom header
  // forces a CORS preflight this server never answers, so a foreign page cannot POST here.
  // GitHub Pages has no such endpoint — the shipped page only downloads to the learner's disk.
  if (req.method === "POST" && req.url === "/dev-export") {
    if (req.headers["x-loam-dev"] !== "1") {
      res.writeHead(403).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(root, "dev-export.json"), body);
      res.writeHead(204).end();
    });
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end("malformed path"); // a bad %-escape must not crash the server
    return;
  }
  const path = normalize(decoded).replace(/^([/\\])+/, "");
  const file = join(root, path === "" ? "index.html" : path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  readFile(file)
    .then((body) => {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    })
    .catch(() => res.writeHead(404).end("not here"));
}).listen(port, "127.0.0.1", () => {
  console.log(`tutorial at http://127.0.0.1:${port}/`);
});
