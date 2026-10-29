import { HANDS, activeActions, actionGeometry, clampTime, formatTime, validateSample } from "./logic.js";
import { setupHeroMotion, setupScrollMotion } from "./motion.js";
import { bindTimelineScrubbing } from "./timeline.js";

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
  let displayTime = 4.5;
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

  function update(time) {
    displayTime = clampTime(time, sample.duration);
    const active = activeActions(sample.actions, displayTime);
    const ids = active.map((a) => a.id);
    slider.value = displayTime;
    slider.setAttribute("aria-valuetext", `${displayTime.toFixed(2)} of ${sample.duration.toFixed(2)} seconds`);
    $("#current-time").value = `${formatTime(displayTime)} s`;
    $("#playback-time").value = `${formatTime(displayTime)} / ${formatTime(sample.duration)}`;
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

  function seekTo(time) {
    video.pause();
    displayTime = clampTime(time, sample.duration);
    if (video.readyState >= 1) video.currentTime = displayTime;
    markPreset(displayTime);
    update(displayTime);
  }

  function onMetadata() {
    // Video is encoded without changing frame rate or playback speed.
    if (Math.abs(video.duration - sample.duration) > 0.06) {
      $("#media-error").hidden = false;
      $("#media-error").textContent = "The video and annotation durations do not match. Playback is disabled until the media is corrected.";
      play.disabled = true;
      return;
    }
    video.currentTime = displayTime;
    update(displayTime);
  }

  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("timeupdate", () => update(video.currentTime));
  video.addEventListener("seeked", () => update(video.currentTime));
  video.addEventListener("play", () => { stopFrames(); setPlaying(true); tick(); });
  video.addEventListener("pause", () => { stopFrames(); setPlaying(false); });
  video.addEventListener("ended", () => { stopFrames(); setPlaying(false); update(sample.duration); });
  video.addEventListener("error", () => {
    play.disabled = true;
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
  update(displayTime);
  if (video.readyState >= 1) onMetadata();
  if (video.error) {
    play.disabled = true;
    $("#media-error").hidden = false;
  }
}

function appendRow(body, row, values, duration = false) {
  const tr = document.createElement("tr");
  if (row.sft) tr.className = "sft-row";
  if (row.reference) tr.className = "reference-row";
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = row.displayName || row.model;
  if (row.sft) {
    const tag = document.createElement("span");
    tag.className = "model-type";
    tag.textContent = "+ SFT";
    th.append(tag);
  }
  tr.append(th);
  values.forEach((value, index) => {
    const td = document.createElement("td");
    td.textContent = value.toFixed(1);
    if (duration && index < 2) td.className = "short-action";
    if (!duration && index === 0) td.className = "score-cell";
    tr.append(td);
  });
  body.append(tr);
}

async function setupResults() {
  const data = await readData("data/paper.json");
  let allModels = false;
  const selectedNames = [
    "Human Expert", "GPT-6 Astra", "Qwen3-VL-32B-Instruct",
    "Qwen3-VL-4B-Instruct", "EgoAction (Qwen3-VL-4B)",
    "LLaVA-OV2-8B", "EgoAction (LLaVA-OV2-8B)"
  ];
  function renderOverall() {
    const body = $("#overall-table tbody");
    body.replaceChildren();
    const rows = allModels ? data.overall : selectedNames.map((name) => data.overall.find((row) => row.model === name)).filter(Boolean);
    rows.forEach((row) => appendRow(body, row, [row.score, row.semantic, row.temporal, row.hand]));
    $("#show-all").innerHTML = allModels ? 'Show selected comparisons <span aria-hidden="true">↑</span>' : 'Show all models <span aria-hidden="true">↓</span>';
    $("#show-all").setAttribute("aria-expanded", String(allModels));
  }
  function renderDuration() {
    const metric = $("#duration-metric").value;
    const body = $("#duration-table tbody");
    body.replaceChildren();
    data.duration.filter((row) => row.metric === metric).forEach((row) => appendRow(body, row, row.values, true));
    $("#duration-table caption").textContent = `${metric} by ground-truth action duration. Scores 0–100, higher is better. First two columns highlight sub-second actions.`;
  }
  $("#show-all").addEventListener("click", () => { allModels = !allModels; renderOverall(); });
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
