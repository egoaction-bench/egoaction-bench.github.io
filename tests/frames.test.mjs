import test from "node:test";
import assert from "node:assert/strict";
import { frameCountFor, frameAtTime, adjacentFrame, frameSeekTime } from "../site/frames.js";

const fps = 50;
const count = frameCountFor(10.14, fps);

test("the 50 fps example has 507 zero-based frame indices, with no extra frame at the endpoint", () => {
  assert.equal(count, 507);
  assert.equal(frameAtTime(0, fps, count), 0);
  assert.equal(frameAtTime(4.5, fps, count), 225);
  assert.equal(frameAtTime(10.12, fps, count), 506);
  assert.equal(frameAtTime(10.14, fps, count), 506);
});

test("stepping through the short action preserves both native-frame boundaries", () => {
  assert.equal(frameAtTime(5.98, fps, count), 299);
  assert.equal(frameAtTime(6.26, fps, count), 313);
  let frame = 298;
  const visited = [];
  for (let step = 0; step < 14; step++) {
    frame = adjacentFrame(frame, 1, count);
    visited.push(frameAtTime(frameSeekTime(frame, fps), fps, count));
  }
  assert.deepEqual(visited, Array.from({ length: 14 }, (_, index) => 299 + index));
  assert.equal(adjacentFrame(frame, 1, count), 313);
  assert.equal(adjacentFrame(299, -1, count), 298);
});

test("previous and next frame clamp at the first and final frame", () => {
  assert.equal(adjacentFrame(0, -1, count), 0);
  assert.equal(adjacentFrame(506, 1, count), 506);
  assert(frameSeekTime(506, fps) < 10.14);
});

test("frame-boundary rounding does not select a preceding frame", () => {
  assert.equal(frameAtTime(4.52 - 1e-10, fps, count), 226);
  assert.equal(frameAtTime(4.519, fps, count), 225);
  for (const index of [0, 1, 224, 225, 226, 299, 312, 313, 505, 506]) {
    assert.equal(frameAtTime(frameSeekTime(index, fps), fps, count), index);
  }
});

test("frame navigation requires a real source frame rate", () => {
  for (const invalid of [0, -1, NaN, undefined, Infinity]) assert.throws(() => frameCountFor(10.14, invalid));
  assert.equal(frameCountFor(1, 30), 30);
  assert.equal(frameCountFor(1, 20), 20);
});
