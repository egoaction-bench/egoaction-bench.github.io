// All motion is original to this page: no third-party animation library or assets.
export function setupScrollMotion() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const header = document.querySelector(".site-header");
  const updateHeader = () => header.classList.toggle("is-scrolled", scrollY > 16);
  addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
  if (!("IntersectionObserver" in window) || reduced.matches) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (reduced.matches || !entry.target.animate) continue;
      // Content is never hidden by default, so blocked JS cannot hide the page.
      entry.target.animate([
        { opacity: 0.35, transform: "translateY(18px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 600, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
  }, { threshold: 0.12 });
  document.querySelectorAll(".section-topline,.intro-grid,.principles article,.teaser-figure,.evaluation-steps li,.citation").forEach((element) => observer.observe(element));
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      observer.disconnect();
      document.getAnimations().forEach((animation) => animation.cancel());
    }
  });
}

export async function setupHeroMotion(samplePromise) {
  const sample = await samplePromise;
  const video = document.querySelector("#hero-video");
  const button = document.querySelector("#hero-motion-toggle");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const connection = navigator.connection;
  const visible = () => {
    const bounds = video.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight && !document.hidden;
  };
  let onScreen = visible();
  let userPlaying = null; // null = automatic; false = explicitly paused.
  let failed = false;
  let initialPositionSet = false;

  function updateButton() {
    const playing = !video.paused;
    button.setAttribute("aria-label", playing ? "Pause homepage preview" : "Play homepage preview");
    button.querySelector(".motion-label").textContent = playing ? "Pause preview" : "Play preview";
    button.querySelector(".motion-symbol").textContent = playing ? "Ⅱ" : "▶";
  }

  async function reconcile() {
    const autoplayAllowed = !reduced.matches && !connection?.saveData;
    const shouldPlay = !failed && onScreen && !document.hidden &&
      userPlaying !== false && (userPlaying === true || autoplayAllowed);
    if (!shouldPlay) { video.pause(); return; }
    try { await video.play(); } catch {
      // Autoplay can be denied by the browser. Keep the poster and explicit play control.
      updateButton();
    }
  }

  function fail() {
    failed = true;
    video.pause();
    button.disabled = true;
    button.setAttribute("aria-label", "Static homepage preview");
    button.querySelector(".motion-label").textContent = "Static preview";
    document.querySelector("#hero-media-error").hidden = false;
  }

  function initializePosition() {
    if (!initialPositionSet) {
      initialPositionSet = true;
      video.currentTime = 4.5;
    }
    if (Math.abs(video.duration - sample.duration) > 0.06) { fail(); return; }
    reconcile();
  }

  video.addEventListener("loadedmetadata", initializePosition);
  video.addEventListener("play", updateButton);
  video.addEventListener("pause", updateButton);
  video.addEventListener("error", fail);
  button.hidden = false;
  button.addEventListener("click", () => {
    userPlaying = video.paused;
    reconcile();
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      reconcile();
    }, { threshold: 0.15 });
    observer.observe(video);
  }
  document.addEventListener("visibilitychange", reconcile);
  reduced.addEventListener("change", () => {
    if (reduced.matches) userPlaying = false;
    reconcile();
  });
  connection?.addEventListener?.("change", reconcile);
  // The analytical viewer takes precedence over the decorative preview.
  document.querySelector("#demo-video").addEventListener("play", () => {
    userPlaying = false;
    reconcile();
  });
  if (video.error) fail();
  else if (video.readyState >= 1) initializePosition();
}
