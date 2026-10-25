import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";

let server;
let url;
before(async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [fileURLToPath(new URL("../scripts/serve.mjs", import.meta.url))],
    { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => { throw new Error("Preview server exited before startup."); }),
  ]);
});
after(() => { server?.kill(); });

test("preview serves the page and module with correct MIME types", async () => {
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert((await page.text()).includes("EgoActionBench"));
  const module = await fetch(`${url}/app.js`);
  assert.match(module.headers.get("content-type"), /text\/javascript/);
  const motion = await fetch(`${url}/motion.js`);
  assert.equal(motion.status, 200);
  assert.match(motion.headers.get("content-type"), /text\/javascript/);
  const favicon = await fetch(`${url}/assets/favicon.png`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /image\/png/);
});
test("video supports byte ranges, suffix ranges, and HEAD", async () => {
  const head = await fetch(`${url}/assets/pumpkin.mp4`, { method: "HEAD" });
  assert.equal(head.status, 200);
  const size = Number(head.headers.get("content-length"));
  assert(size > 0);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const first = await fetch(`${url}/assets/pumpkin.mp4`, { headers: { Range: "bytes=0-99" } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-99/${size}`);
  assert.equal((await first.arrayBuffer()).byteLength, 100);
  const last = await fetch(`${url}/assets/pumpkin.mp4`, { headers: { Range: "bytes=-80" } });
  assert.equal(last.status, 206);
  assert.equal((await last.arrayBuffer()).byteLength, 80);
});
test("invalid ranges, missing assets, and non-GET methods fail explicitly", async () => {
  for (const range of ["bytes=999999999-", "bytes=9-3", "bytes=", "bytes=-0"]) {
    assert.equal((await fetch(`${url}/assets/pumpkin.mp4`, { headers: { Range: range } })).status, 416);
  }
  assert.equal((await fetch(`${url}/assets/missing.mp4`)).status, 404);
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
});
test("local server exposes neither repository files nor parent directories", async () => {
  for (const path of ["/README.md", "/.git/config", "/scripts/serve.mjs", "/package.json"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 403);
});
