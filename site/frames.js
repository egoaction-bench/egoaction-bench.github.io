export function frameCountFor(duration, fps) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error("Frame navigation requires a positive duration and native frame rate.");
  }
  return Math.max(1, Math.round(duration * fps));
}

export function frameAtTime(time, fps, count) {
  const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
  // Tolerate floating-point noise at exact native-frame boundaries.
  return Math.max(0, Math.min(count - 1, Math.floor(seconds * fps + 1e-6)));
}

export function adjacentFrame(frame, direction, count) {
  return Math.max(0, Math.min(count - 1, frame + direction));
}

export function frameSeekTime(frame, fps) {
  // Seek just inside the frame to avoid decoding its predecessor due to rounding.
  // This offset stays below the precision of the existing seconds readout.
  return frame / fps + Math.min(0.001, 0.1 / fps);
}
