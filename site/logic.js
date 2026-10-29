export const HANDS = ["left", "right", "both"];
export const OVERALL_METRICS = ["EgoActionScore", "m_tIoU", "F1", "Temporal", "Hand", "Verb", "Objects", "Tools", "Motion", "Semantic"];
export const DURATION_METRICS = ["m_tIoU", "Content", "Semantic", "Hand"];

export function clampTime(time, duration) {
  return Math.max(0, Math.min(Number.isFinite(time) ? time : 0, duration));
}

// All source action intervals are half-open: [start, end).
export function activeActions(actions, time) {
  return actions.filter((action) => action.start <= time && time < action.end);
}

export function actionGeometry(action, duration) {
  const start = clampTime(action.start, duration);
  const end = clampTime(action.end, duration);
  return { left: start / duration * 100, width: (end - start) / duration * 100 };
}

export function formatTime(time) {
  return Math.max(0, time).toFixed(2).padStart(5, "0");
}

export function validateSample(sample) {
  if (!Number.isFinite(sample.duration) || sample.duration <= 0 || !sample.actions?.length) {
    throw new Error("Invalid example duration or missing actions.");
  }
  const ids = new Set();
  for (const a of sample.actions) {
    if (ids.has(a.id) || !HANDS.includes(a.hand) || !a.caption ||
        !Number.isFinite(a.start) || !Number.isFinite(a.end) ||
        a.start < 0 || a.end <= a.start || a.end > sample.duration) {
      throw new Error(`Invalid action: ${a.id}`);
    }
    ids.add(a.id);
  }
  return sample;
}
