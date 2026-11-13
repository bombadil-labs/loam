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
    res.writeHead(400).end("malformed path");
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
