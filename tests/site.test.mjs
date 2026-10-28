import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HANDS, METRICS, activeActions, clampTime, actionGeometry, formatTime, validateSample } from "../site/logic.js";

const root = fileURLToPath(new URL("../site/", import.meta.url));
const sample = JSON.parse(await readFile(join(root, "data/sample.json")));
const paper = JSON.parse(await readFile(join(root, "data/paper.json")));
const html = await readFile(join(root, "index.html"), "utf8");

test("source annotations are valid, uniquely identified, and represented on all three tracks", () => {
  validateSample(sample);
  assert.equal(sample.actions.length, 11);
  assert.equal(sample.duration, 10.14);
  assert.deepEqual([...new Set(sample.actions.map(a => a.hand))], HANDS);
});
test("0.28-second action uses exact, half-open source boundaries", () => {
  const action = sample.actions.find(a => a.id === "l_3");
  assert.equal(action.start, 5.98);
  assert.equal(action.end, 6.26);
  assert.equal(Number((action.end-action.start).toFixed(2)), .28);
  assert(activeActions(sample.actions, 5.98).includes(action));
  assert(activeActions(sample.actions, 6.1).includes(action));
  assert(!activeActions(sample.actions, 6.26).includes(action));
  assert.equal(activeActions(sample.actions, 10.14).length, 0);
});
test("presets select the intended actions and gaps never borrow neighboring annotations", () => {
  assert.deepEqual(activeActions(sample.actions, 2.5).map(a => a.id), ["l_1", "r_2"]);
  assert.deepEqual(activeActions(sample.actions, 4.5).map(a => a.id), ["l_2", "r_2", "bh_1"]);
  assert.deepEqual(activeActions(sample.actions, 6.1).map(a => a.id), ["l_3", "r_3"]);
  assert(!activeActions(sample.actions, 3.8).some(a => a.hand === "left"));
});
test("time and timeline geometry remain inside clip bounds", () => {
  assert.equal(clampTime(NaN, 10.14), 0);
  assert.equal(clampTime(-5, 10.14), 0);
  assert.equal(clampTime(20, 10.14), 10.14);
  assert.equal(formatTime(4.5), "04.50");
  for (const action of sample.actions) {
    const geometry = actionGeometry(action, sample.duration);
    assert(geometry.left >= 0 && geometry.width > 0);
    assert(geometry.left + geometry.width <= 100 + 1e-8);
  }
});
test("duration results contain all 120 original score cells", () => {
  assert.equal(paper.duration.length, 24);
  for (const metric of METRICS) assert.equal(paper.duration.filter(r => r.metric === metric).length, 6);
  for (const row of paper.duration) {
    assert.equal(row.values.length, 5);
    row.values.forEach(score => assert(score >= 0 && score <= 100));
  }
  assert.deepEqual(paper.duration.find(r => r.model === "Qwen3-VL-4B" && r.metric === "Temporal").values, [6.4, 13.5, 20.6, 30.0, 49.4]);
});
test("overall rows retain model labels, SFT pairs, and human reference", () => {
  assert.equal(paper.overall.length, 22);
  assert.equal(paper.overall.filter(r => r.sft).length, 2);
  assert.equal(paper.overall.filter(r => r.reference).length, 1);
  assert.equal(paper.overall.find(r => r.model === "EgoAction (Qwen3-VL-4B)").displayName, "Qwen3-VL-4B");
  assert.equal(paper.overall.find(r => r.model === "EgoAction (LLaVA-OV2-8B)").score, 56.7);
  for (const row of paper.overall) {
    for (const metric of ["score", "semantic", "temporal", "hand"]) assert(Number.isFinite(row[metric]));
  }
});
test("HTML has unique IDs, valid local anchors, no fake hrefs, and source abstract", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert(ids.includes(anchor), anchor);
  assert(!html.includes('href="javascript:'));
  assert(html.includes("Learning from human data offers a scalable path"));
});
test("site is self-contained and contains no manuscript source or reference papers", async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  for (const file of files) {
    assert(!/\.(tex|pdf|pptx|env)$/.test(file), file);
    assert(!file.includes("ref_papers"));
  }
  for (const [, resource] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:/.test(resource)) continue;
    assert((await stat(join(root, resource))).isFile(), resource);
  }
  const css = await readFile(join(root, "styles.css"), "utf8");
  assert(css.includes("prefers-reduced-motion"));
  assert(css.includes("focus-visible"));
  assert((await stat(join(root, "assets/pumpkin.mp4"))).size < 10_000_000);
});

test("homepage uses the official wordmark and omits decorative section slogans", () => {
  assert.equal([...html.matchAll(/src="assets\/egoactionbench-logo\.webp"/g)].length, 3);
  assert.match(html, /href="assets\/favicon\.png"/);
  assert(!/\beyebrow\b|A CLOSER LOOK AT HUMAN ACTION|A REAL MOMENT, ANNOTATED/.test(html));
  const heroVideo = html.match(/<video id="hero-video"[^>]*>/)?.[0];
  assert(heroVideo);
  assert(!heroVideo.includes("autoplay")); // Motion preference is checked in JS first.
  assert(heroVideo.includes("muted") && heroVideo.includes("playsinline"));
  assert(heroVideo.includes('src="assets/pumpkin-captioned.mp4"'));
  assert(heroVideo.includes('poster="assets/pumpkin-captioned-poster.webp"'));
  assert(!/data-hero-hand|id="hero-time"|id="hero-progress"/.test(html));
  assert.match(html, /id="hero-motion-toggle"/);
});

test("hero highlights only action, hand, and moment in the existing violet", async () => {
  const statement = html.match(/<p class="hero-statement">(.*?)<\/p>/s)?.[1];
  assert.equal(statement, 'Every <span class="hero-keyword">action</span>.<br>Every <span class="hero-keyword">hand</span>.<br>Every <span class="hero-keyword">moment</span>.');
  const css = await readFile(join(root, "styles.css"), "utf8");
  assert.match(css, /\.hero-statement\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.hero-keyword\s*\{[^}]*color:\s*var\(--both\)/);
  assert(!/\.hero-statement (?:br|> span)/.test(css));
});

test("analytical viewer retains verbatim source captions in light cards without source or prediction badges", async () => {
  assert(!/EPIC-KITCHENS|Human.refined ground truth|(?:Not|Our) model predictions/i.test(html));
  for (const hand of HANDS) {
    const expected = activeActions(sample.actions, 4.5).find(a => a.hand === hand).caption;
    const viewer = html.match(new RegExp(`id="current-${hand}"[^>]*><span[^>]*>[^<]+</span><p>([^<]+)</p>`));
    assert.equal(viewer?.[1], expected);
  }
  const presetCaptions = [...html.matchAll(/data-caption-id="([^"]+)">([^<]+)</g)];
  assert.equal(presetCaptions.length, 4);
  for (const [, id, caption] of presetCaptions) {
    assert.equal(caption, sample.actions.find(a => a.id === id)?.caption, id);
  }
  for (const module of ["app.js", "motion.js"]) {
    const source = await readFile(join(root, module), "utf8");
    assert(!source.includes(".shortLabel"), module);
  }
  const css = await readFile(join(root, "styles.css"), "utf8");
  for (const selector of [".hero-film", ".video-panel", ".action-panel"]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0];
    assert.match(rule, /background: #fff;/);
  }
  for (const selector of [".current-action"]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0];
    assert.match(rule, /border: 1px solid var\(--caption-border\)/);
    assert(!rule.includes("border-left"));
  }
});

test("standalone benchmark statistics are omitted without changing the abstract", () => {
  assert(!html.includes('class="stats"'));
  assert(!html.includes("<span>Video episodes</span>"));
  assert(!html.includes("<span>Evaluated VLMs</span>"));
  const abstract = html.match(/<!-- ABSTRACT_START -->(.*?)<!-- ABSTRACT_END -->/s)?.[1];
  assert.equal(abstract, paper.abstract);
});

test("media allowlist and hashes match the reproducible local assets", async () => {
  const manifest = JSON.parse(await readFile(new URL("../media-manifest.json", import.meta.url)));
  const assets = (await readdir(join(root, "assets"))).sort();
  assert.deepEqual(assets, ["egoactionbench-logo.webp", "favicon.png", "pumpkin-captioned-poster.webp", "pumpkin-captioned.mp4", "pumpkin-poster.webp", "pumpkin.mp4", "teaser.webp"]);
  assert.deepEqual(Object.keys(manifest.outputs).sort(), assets);
  for (const name of assets) {
    const buffer = await readFile(join(root, "assets", name));
    assert.equal(buffer.length, manifest.outputs[name].bytes, name);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), manifest.outputs[name].sha256, name);
  }
});
