// Local-only static preview, with byte-range support for reliable video seeking.
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../site/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".bib": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const path = resolve(root, "." + (requested === "/" ? "/index.html" : requested));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const headers = { "Content-Type": types[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return;
      }
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), end);
      }
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`EgoActionBench preview: http://127.0.0.1:${port}`));
