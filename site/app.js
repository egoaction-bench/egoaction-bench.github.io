import { HANDS, OVERALL_METRICS, activeActions, actionGeometry, clampTime, formatTime, validateSample } from "./logic.js?v=20261030-results-v2";
import { setupHeroMotion, setupScrollMotion } from "./motion.js";
import { bindTimelineScrubbing } from "./timeline.js";
import { frameCountFor, frameAtTime, adjacentFrame, frameSeekTime } from "./frames.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const handNames = { left: "Left hand", right: "Right hand", both: "Both hands" };
const playIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h3v12H5zm7 0h3v12h-3z"/></svg>';

async function readData(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

const samplePromise = readData("data/sample.json").then(validateSample);

async function setupViewer() {
  const video = $("#demo-video");
  const presets = $$(".moment");
  presets.forEach((button) => { button.disabled = true; });
  const sample = await samplePromise;
  const slider = $("#seek");
  const detail = $("#action-detail");
  const play = $("#play-toggle");
  const previousFrame = $("#previous-frame");
  const nextFrame = $("#next-frame");
  const frameReadout = $("#current-frame");
  const fps = sample.sourceFps;
  const frameCount = frameCountFor(sample.duration, fps);
  const hasVideoFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let displayTime = 4.5;
  let currentFrame = frameAtTime(displayTime, fps, frameCount);
  let pendingStep = null;
  let presentedFrameRequest = null;
  let metadataReady = false;
  let selected = null;
  let frameRequest = null;
  let renderedIds = "";
  let initialized = false;
  const bars = [];
  const heads = [];
  const finishScrubs = [];
  const picker = $("#action-picker-select");
  const defaultDetail = "Select an action on the timeline to inspect its caption and time interval.";
  for (const time of [0, 2, 4, 6, 8, sample.duration]) {
    const tick = document.createElement("span");
    tick.textContent = `${time} s`;
    tick.style.left = `${time / sample.duration * 100}%`;
    $("#timeline-axis").append(tick);
  }

  function showAction(action) {
    selected = action?.id ?? null;
    picker.value = selected ?? "";
    if (!action) { detail.textContent = defaultDetail; return; }
    detail.replaceChildren();
    const lead = document.createElement("strong");
    lead.textContent = `${handNames[action.hand]} · ${action.caption} `;
    detail.append(lead, `${action.start.toFixed(2)}–${action.end.toFixed(2)} s · ${(action.end - action.start).toFixed(2)} s duration`);
  }

  function selectAction(action) {
    showAction(action);
    seekTo(action.start);
  }

  for (const hand of HANDS) {
    const row = document.createElement("div");
    row.className = `timeline-row ${hand}`;
    const label = document.createElement("span");
    label.className = "track-label";
    label.textContent = hand === "both" ? "Both" : hand === "left" ? "Left" : "Right";
    const track = document.createElement("div");
    track.className = "track";
    for (const action of sample.actions.filter((a) => a.hand === hand)) {
      const bar = document.createElement("button");
      bar.type = "button";
      bar.className = "action-bar";
      bar.dataset.actionId = action.id;
      const geometry = actionGeometry(action, sample.duration);
      bar.style.left = `${geometry.left}%`;
      bar.style.width = `${geometry.width}%`;
      const description = `${handNames[hand]}: ${action.caption} ${action.start.toFixed(2)} to ${action.end.toFixed(2)} seconds; duration ${(action.end - action.start).toFixed(2)} seconds.`;
      bar.setAttribute("aria-label", description);
      bar.title = description;
      bar.textContent = action.caption;
      // Keep truthful durations; don't artificially widen short actions to fit text.
      if (geometry.width < 6) bar.classList.add("compact-action");
      // Pointer gestures are handled by the track. Keyboard activation retains
      // the action-start shortcut, without snapping a completed drag backwards.
      bar.addEventListener("click", (event) => {
        if (event.detail === 0) selectAction(action);
      });
      const option = document.createElement("option");
      option.value = action.id;
      option.textContent = `${handNames[hand]} · ${action.start.toFixed(2)} s · ${action.caption}`;
      picker.append(option);
      track.append(bar);
      bars.push({ bar, action });
    }
    const head = document.createElement("div");
    head.className = "playhead";
    head.setAttribute("aria-hidden", "true");
    track.append(head);
    heads.push(head);
    finishScrubs.push(bindTimelineScrubbing(track, {
      duration: sample.duration,
      onStart() {
        const wasPlaying = !video.paused;
        video.pause();
        return wasPlaying;
      },
      onSeek(time) {
        showAction(activeActions(sample.actions, time).find((action) => action.hand === hand));
        seekTo(time);
      },
      onEnd(wasPlaying) {
        if (!wasPlaying || document.hidden || video.error || play.disabled || displayTime >= sample.duration) return;
        video.play().catch((error) => {
          if (error.name === "AbortError") return;
          $("#media-error").hidden = false;
          $("#media-error").textContent = "Playback could not resume. Press Play to try again.";
        });
      },
    }));
    row.append(label, track);
    $("#timeline-rows").append(row);
  }
  picker.addEventListener("change", () => {
    const action = sample.actions.find((a) => a.id === picker.value);
    if (action) selectAction(action);
  });

  function updateFrame(index, presentedTime) {
    currentFrame = Math.max(0, Math.min(frameCount - 1, index));
    frameReadout.value = `Frame ${currentFrame}`;
    if (presentedTime !== undefined) frameReadout.dataset.presentedTime = String(presentedTime);
    previousFrame.disabled = !metadataReady || currentFrame === 0;
    nextFrame.disabled = !metadataReady || currentFrame === frameCount - 1;
  }

  function watchPresentedFrames() {
    if (!hasVideoFrameCallback || presentedFrameRequest !== null || video.error) return;
    presentedFrameRequest = video.requestVideoFrameCallback((_, metadata) => {
      presentedFrameRequest = null;
      const index = frameAtTime(metadata.mediaTime, fps, frameCount);
      // Ignore an older decoded frame while a newer seek is still in flight.
      const nearPausedPosition = !video.paused || Math.abs(video.currentTime - metadata.mediaTime) <= 1 / fps + 0.001;
      if (nearPausedPosition && (pendingStep === null || pendingStep === index)) {
        pendingStep = null;
        updateFrame(index, metadata.mediaTime);
      }
      watchPresentedFrames();
    });
  }

  function update(time) {
    displayTime = clampTime(time, sample.duration);
    const active = activeActions(sample.actions, displayTime);
    const ids = active.map((a) => a.id);
    slider.value = displayTime;
    slider.setAttribute("aria-valuetext", `${displayTime.toFixed(2)} of ${sample.duration.toFixed(2)} seconds`);
    $("#current-time").value = `${formatTime(displayTime)} s`;
    $("#playback-time").value = `${formatTime(displayTime)} / ${formatTime(sample.duration)}`;
    if (!hasVideoFrameCallback) updateFrame(frameAtTime(displayTime, fps, frameCount));
    heads.forEach((head) => { head.style.left = `${Math.min(99.9, displayTime / sample.duration * 100)}%`; });
    bars.forEach(({ bar, action }) => {
      bar.classList.toggle("is-active", ids.includes(action.id));
      bar.classList.toggle("is-selected", selected === action.id);
      bar.setAttribute("aria-pressed", String(selected === action.id));
    });
    if (ids.join(",") !== renderedIds || !initialized) {
      renderedIds = ids.join(",");
      initialized = true;
      for (const hand of HANDS) {
        const panel = $(`#current-${hand}`);
        const actions = active.filter((a) => a.hand === hand);
        panel.classList.toggle("is-empty", actions.length === 0);
        panel.querySelector("p").textContent = actions.length ? actions.map((a) => a.caption).join(" ") : "No annotated action at this moment.";
        panel.querySelector(".action-time").textContent = actions.map((a) => `${a.start.toFixed(2)}–${a.end.toFixed(2)} s`).join(" · ");
      }
    }
  }

  function stopFrames() {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
  }

  function tick() {
    update(video.currentTime);
    if (!video.paused && !video.ended) frameRequest = requestAnimationFrame(tick);
  }

  function setPlaying(playing) {
    play.innerHTML = `${playing ? pauseIcon : playIcon}<span>${playing ? "Pause" : "Play"}</span>`;
    play.setAttribute("aria-label", playing ? "Pause video" : "Play video");
  }

  function markPreset(time) {
    presets.forEach((button) => {
      const active = Math.abs(Number(button.dataset.moment) - time) < 0.02;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function seekTo(time, { stepFrame = null } = {}) {
    video.pause();
    pendingStep = stepFrame;
    displayTime = clampTime(time, sample.duration);
    delete frameReadout.dataset.presentedTime;
    updateFrame(stepFrame ?? frameAtTime(displayTime, fps, frameCount));
    if (video.readyState >= 1) video.currentTime = stepFrame === null ? displayTime : frameSeekTime(stepFrame, fps);
    markPreset(displayTime);
    update(displayTime);
  }

  function stepFrame(direction) {
    if (!metadataReady || video.error) return;
    const target = adjacentFrame(pendingStep ?? currentFrame, direction, frameCount);
    showAction(null);
    seekTo(target / fps, { stepFrame: target });
  }
  previousFrame.addEventListener("click", () => stepFrame(-1));
  nextFrame.addEventListener("click", () => stepFrame(1));

  function onMetadata() {
    // Video is encoded without changing frame rate or playback speed.
    if (Math.abs(video.duration - sample.duration) > 0.06) {
      $("#media-error").hidden = false;
      $("#media-error").textContent = "The video and annotation durations do not match. Playback is disabled until the media is corrected.";
      play.disabled = true;
      metadataReady = false;
      updateFrame(currentFrame);
      return;
    }
    metadataReady = true;
    video.currentTime = displayTime;
    updateFrame(frameAtTime(displayTime, fps, frameCount));
    watchPresentedFrames();
    update(displayTime);
  }

  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("timeupdate", () => update(video.currentTime));
  video.addEventListener("seeked", () => update(video.currentTime));
  video.addEventListener("play", () => { pendingStep = null; stopFrames(); setPlaying(true); tick(); });
  video.addEventListener("pause", () => { stopFrames(); setPlaying(false); });
  video.addEventListener("ended", () => { pendingStep = null; stopFrames(); setPlaying(false); update(sample.duration); updateFrame(frameCount - 1); });
  video.addEventListener("error", () => {
    play.disabled = true;
    metadataReady = false;
    updateFrame(currentFrame);
    if (presentedFrameRequest !== null) video.cancelVideoFrameCallback(presentedFrameRequest);
    presentedFrameRequest = null;
    $("#media-error").hidden = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      finishScrubs.forEach((finish) => finish());
      video.pause();
    }
  });
  play.addEventListener("click", async () => {
    if (!video.paused) { video.pause(); return; }
    if (displayTime >= sample.duration - 0.01) seekTo(0);
    selected = null;
    picker.value = "";
    detail.textContent = defaultDetail;
    $("#media-error").hidden = true;
    markPreset(-1);
    try {
      await video.play();
    } catch {
      $("#media-error").hidden = false;
      $("#media-error").textContent = "Playback could not start. Try again, or inspect the annotations using the timeline.";
    }
  });
  slider.max = sample.duration;
  slider.addEventListener("input", () => {
    selected = null;
    picker.value = "";
    detail.textContent = defaultDetail;
    seekTo(Number(slider.value));
  });
  $("#speed").addEventListener("change", (event) => { video.playbackRate = Number(event.target.value); });
  for (const button of presets) {
    button.disabled = false;
    button.addEventListener("click", () => {
      selected = null;
      picker.value = "";
      seekTo(Number(button.dataset.moment));
      detail.textContent = Number(button.dataset.moment) === 6.1
        ? "Left hand · Move the cut pumpkin piece. 5.98–6.26 s · 0.28 s duration."
        : "Select an action on the timeline to inspect its caption and time interval.";
    });
  }
  video.controls = false;
  $("#interactive-controls").hidden = false;
  updateFrame(currentFrame);
  update(displayTime);
  if (video.readyState >= 1) onMetadata();
  if (video.error) {
    play.disabled = true;
    metadataReady = false;
    updateFrame(currentFrame);
    $("#media-error").hidden = false;
  }
}

function appendRow(body, row, values, duration = false) {
  const tr = document.createElement("tr");
  tr.dataset.model = row.model;
  if (row.ours) tr.className = "ours-row";
  if (row.reference) tr.className = "reference-row";
  const th = document.createElement("th");
  th.scope = "row";
  th.className = "result-model";
  th.textContent = row.displayName || row.model;
  tr.append(th);
  values.forEach((value, index) => {
    const td = document.createElement("td");
    td.textContent = value.toFixed(1);
    if (duration && index < 2) td.className = "short-action";
    if (!duration && [0, 3, 9].includes(index)) td.classList.add("score-cell");
    if (!duration && [1, 4].includes(index)) td.classList.add("metric-group-start");
    tr.append(td);
  });
  body.append(tr);
}

async function setupResults() {
  const data = await readData("data/paper.json?v=20261030-results-v2");
  function renderOverall() {
    const table = $("#overall-table");
    table.querySelectorAll("tbody").forEach((body) => body.remove());
    let group = null;
    let body = null;
    for (const row of data.overall) {
      if (row.group !== group) {
        group = row.group;
        body = document.createElement("tbody");
        body.setAttribute("aria-label", group);
        const heading = document.createElement("tr");
        heading.className = "result-group";
        const cell = document.createElement("th");
        cell.colSpan = OVERALL_METRICS.length + 1;
        cell.scope = "rowgroup";
        cell.textContent = group;
        heading.append(cell);
        body.append(heading);
        table.append(body);
      }
      appendRow(body, row, OVERALL_METRICS.map((metric) => row.scores[metric]));
    }
  }
  function renderDuration() {
    const metric = $("#duration-metric").value;
    const body = $("#duration-table tbody");
    body.replaceChildren();
    data.duration.filter((row) => row.metric === metric).forEach((row) => appendRow(body, row, row.values, true));
    const metricName = metric === "m_tIoU" ? "m-tIoU" : metric;
    $("#duration-table caption").textContent = `${metricName} by ground-truth action duration. Scores 0–100, higher is better. First two columns highlight sub-second actions.`;
  }
  $("#duration-metric").addEventListener("change", renderDuration);
  const tabs = $$('[role="tab"]');
  function activateTab(target, focus = false) {
    tabs.forEach((tab) => {
      const active = target === tab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(`#${tab.getAttribute("aria-controls")}`).hidden = !active;
    });
    if (focus) target.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activateTab(tabs[next], true);
    });
  });
  renderOverall();
  renderDuration();
}

$("#copy-bibtex").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#bibtex").textContent.trim());
    $("#copy-status").textContent = "BibTeX copied.";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($("#bibtex"));
    selection.removeAllRanges();
    selection.addRange(range);
    $("#copy-status").textContent = "Text selected. Press Ctrl+C / ⌘C to copy.";
  }
});

setupScrollMotion();
setupHeroMotion(samplePromise).catch((error) => {
  console.error("Homepage preview:", error);
  $("#hero-media-error").hidden = false;
});
setupViewer().catch((error) => {
  console.error("Viewer:", error);
  $("#demo-video").controls = true;
  $("#media-error").hidden = false;
  $("#media-error").textContent = "The annotation viewer could not load. You can still use the native video controls.";
});
setupResults().catch((error) => {
  console.error("Results:", error);
  $("#results-error").hidden = false;
});
