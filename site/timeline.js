// Pointer positions always refer to the full track, including when it is scrolled.
export function bindTimelineScrubbing(track, { duration, onSeek, onStart, onEnd }) {
  let gesture = null;
  const touchThreshold = 6;

  function seek(clientX) {
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    onSeek(fraction * duration);
  }

  function begin() {
    if (gesture.started) return;
    gesture.started = true;
    gesture.playbackState = onStart();
    track.classList.add("is-scrubbing");
  }

  function finish() {
    if (!gesture) return;
    const ended = gesture;
    gesture = null;
    track.classList.remove("is-scrubbing");
    if (track.hasPointerCapture(ended.pointerId)) track.releasePointerCapture(ended.pointerId);
    if (ended.started) onEnd(ended.playbackState);
  }

  track.addEventListener("pointerdown", (event) => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    gesture = {
      pointerId: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY, started: false,
    };
    track.setPointerCapture(event.pointerId);
    if (event.pointerType !== "touch") {
      begin();
      seek(event.clientX);
    }
  });

  track.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.started) {
      const dx = Math.abs(event.clientX - gesture.x);
      const dy = Math.abs(event.clientY - gesture.y);
      // Let a vertical touch gesture scroll the page without seeking first.
      if (dx < touchThreshold || dx < dy) return;
      begin();
    }
    seek(event.clientX);
  });

  track.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.started) {
      const distance = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
      if (distance > touchThreshold) { finish(); return; }
      begin();
    }
    seek(event.clientX);
    finish();
  });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    track.addEventListener(type, (event) => {
      if (gesture?.pointerId === event.pointerId) finish();
    });
  }
  return finish;
}
