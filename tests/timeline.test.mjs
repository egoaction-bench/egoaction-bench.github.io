import test from "node:test";
import assert from "node:assert/strict";
import { bindTimelineScrubbing } from "../site/timeline.js";

class Track extends EventTarget {
  bounds = { left: 100, width: 1014 };
  captures = new Set();
  classes = new Set();
  classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) };
  getBoundingClientRect() { return this.bounds; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    this.captures.delete(id);
    this.pointer("lostpointercapture", 0, { pointerId: id });
  }
  pointer(type, clientX, options = {}) {
    const event = new Event(type);
    Object.assign(event, { clientX, clientY: 50, button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse", ...options });
    this.dispatchEvent(event);
  }
}

function viewer(playing = false) {
  const track = new Track();
  const state = { playing, seeks: [], starts: 0, ends: 0 };
  bindTimelineScrubbing(track, {
    duration: 10.14,
    onStart() {
      state.starts++;
      const previous = state.playing;
      state.playing = false;
      return previous;
    },
    onSeek(time) { state.seeks.push(time); },
    onEnd(previous) { state.ends++; state.playing = previous; },
  });
  return { track, state };
}

function near(actual, expected) { assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test("track clicks seek inside captions, inside a gap, and inside the 0.28-second action", () => {
  const { track, state } = viewer();
  for (const time of [2.8, 3.8, 6.1]) {
    const x = 100 + time * 100;
    track.pointer("pointerdown", x);
    track.pointer("pointerup", x);
    near(state.seeks.at(-1), time);
  }
  assert.equal(state.playing, false);
  assert.equal(state.starts, 3);
  assert.equal(state.ends, 3);
});

test("dragging updates continuously, pauses during the gesture, and resumes once on release", () => {
  const { track, state } = viewer(true);
  track.pointer("pointerdown", 380);
  assert.equal(state.playing, false);
  assert(track.hasPointerCapture(1));
  track.pointer("pointermove", 480);
  near(state.seeks.at(-1), 3.8);
  track.pointer("pointermove", 710);
  near(state.seeks.at(-1), 6.1);
  track.pointer("pointerup", 710);
  near(state.seeks.at(-1), 6.1);
  assert.equal(state.playing, true);
  assert.equal(state.starts, 1);
  assert.equal(state.ends, 1); // Releasing capture must not finish twice.
  assert(!track.hasPointerCapture(1));
  assert(!track.classes.has("is-scrubbing"));
});

test("a paused drag stays paused and clamps outside-track positions to video endpoints", () => {
  const { track, state } = viewer();
  track.pointer("pointerdown", 380);
  track.pointer("pointermove", -10);
  near(state.seeks.at(-1), 0);
  track.pointer("pointerup", 1300);
  near(state.seeks.at(-1), 10.14);
  assert.equal(state.playing, false);
});

test("a horizontally scrolled mobile track uses its full width and viewport-relative origin", () => {
  const { track, state } = viewer();
  track.bounds = { left: -180, width: 650 };
  track.pointer("pointerdown", -180 + 6.1 / 10.14 * 650);
  track.pointer("pointerup", -180 + 6.1 / 10.14 * 650);
  near(state.seeks.at(-1), 6.1);
});

test("touch taps seek on release and horizontal drags start after direction is established", () => {
  const { track, state } = viewer(true);
  const touch = { pointerType: "touch" };
  track.pointer("pointerdown", 480, touch);
  assert.equal(state.seeks.length, 0);
  assert.equal(state.playing, true);
  track.pointer("pointerup", 480, touch);
  near(state.seeks.at(-1), 3.8);
  assert.equal(state.playing, true);
  track.pointer("pointerdown", 380, touch);
  track.pointer("pointermove", 383, touch);
  assert.equal(state.playing, true);
  track.pointer("pointermove", 430, touch);
  assert.equal(state.playing, false);
  near(state.seeks.at(-1), 3.3);
  track.pointer("pointerup", 710, touch);
  near(state.seeks.at(-1), 6.1);
  assert.equal(state.playing, true);
});

test("vertical touch scrolling never pauses or seeks the video", () => {
  const { track, state } = viewer(true);
  track.pointer("pointerdown", 380, { pointerType: "touch" });
  track.pointer("pointermove", 382, { pointerType: "touch", clientY: 90 });
  track.pointer("pointercancel", 382, { pointerType: "touch", clientY: 90 });
  assert.deepEqual(state.seeks, []);
  assert.equal(state.starts, 0);
  assert.equal(state.ends, 0);
  assert.equal(state.playing, true);
  assert(!track.hasPointerCapture(1));
});

test("secondary pointers and right clicks cannot hijack a scrub", () => {
  const { track, state } = viewer();
  track.pointer("pointerdown", 380, { button: 2 });
  track.pointer("pointerdown", 380, { isPrimary: false, pointerId: 2 });
  assert.equal(state.starts, 0);
  track.pointer("pointerdown", 380);
  track.pointer("pointermove", 1100, { pointerId: 2, isPrimary: false });
  near(state.seeks.at(-1), 2.8);
  track.pointer("pointercancel", 380);
  assert.equal(state.ends, 1);
  assert.equal(state.playing, false);
});
