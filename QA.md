# Local preview verification

## Automated checks

`npm test`: 15 tests pass.

- Source action IDs, hand tracks, and half-open interval boundaries.
- The 5.98–6.26 s action is exactly 0.28 s; no neighboring annotation is
  displayed during an unannotated gap.
- All 22 overall-result rows, 24 duration-result rows, and 120 duration-score
  cells are present. The export script also compares the CSV to the LaTeX table.
- Required assets and anchors resolve; manuscript and reference files are absent.
- The local server handles video ranges, suffix ranges, HEAD, missing assets,
  invalid ranges, and disallowed methods.
- Files outside `site/` are not served, including the repository configuration.
- Header, hero, and footer use the official teaser wordmark; decorative eyebrow
  slogans are absent. All five asset sizes and hashes match the media manifest.

JavaScript syntax checks pass. Source hashes still match the paper files used
for export. The manuscript working tree is unchanged.

## Browser checks

Tested in the Codex in-app browser:

- Real H.264 video loads with duration 10.14 s.
- The three moment buttons seek to 2.50, 4.50, and 6.10 s.
- Clicking the short-action bar seeks to 5.98 s and displays the exact caption,
  interval, and duration.
- Play, end-of-clip handling, and 0.5× playback work.
- At the end of the half-open excerpt, no action is incorrectly kept active.
- The mobile action picker offers a larger alternative to tapping short bars.
- Result tabs, metric selection, full/selected model views, and BibTeX copying work.
- Left/right arrow keys switch tabs and move keyboard focus.
- 320, 390, 768, and 1280 px layouts have no page-level horizontal overflow.
  Wide result tables scroll within their own containers on mobile.
- Simulated blocked video displays a useful error and disables playback while
  preserving annotation exploration.
- Simulated blocked JSON files restore native video controls and display an
  explicit result-loading error.
- All simulated network blocks and temporary viewport overrides were reset.
- Final page loads without visible errors.

## Typography and motion revision — October 19, 2026

- Visually checked the split desktop hero, larger viewer text, and results table.
  At 1280 px, navigation and primary buttons are 16 px; the paper subtitle is
  21 px and annotation captions are 16 px.
- Removed decorative small slogans above all section titles, the decorative
  hero-video label, and the footer tagline. Necessary source, score, hand, and
  control labels remain.
- Rechecked 320, 390, 768, and 1280 px widths with no page-level horizontal
  overflow. On mobile the wide results table stays inside its scroll container.
- The new hero plays muted normally. Emulated reduced motion starts at a static
  4.50 s; manually playing still works, and scrolling to Explore pauses it.
- Exact 5.98 s short-action selection, 0.5× speed, duration tab, and metric
  selection still work with the new layout.
- Blocking video disables the hero playback button and leaves the poster,
  correct 4.50 s annotations, and the analytical timeline available.
  Blocking sample JSON leaves a static hero and native viewer controls.
- Restored all network and motion emulation settings after testing.
- Sample/result JSON bytes are identical to the pre-revision backup, manuscript
  source hashes still match, and the manuscript working tree remains clean.

## Review boundary

This is not an exhaustive browser or accessibility certification. Public media
release permission and real resource URLs still need owner review before
publishing. The checks above describe the local preview before its first release.
The deployment workflow uploads only `site/`.

## Initial release preparation — October 25, 2026

- The owner explicitly requested deployment of the current version to GitHub.
- Re-ran all 14 automated tests and JavaScript syntax checks successfully.
- Reviewed the upload allowlist: no manuscript source, reference papers, full
  dataset, credentials, symlinks, or local filesystem paths in the published files.
- Python bytecode caches are excluded from Git.
- The `gh-pages` snapshot contains only `site/`. The active deployment workflow
  uploads the same site-only artifact from `main`, after the auto-created
  branch build finishes.
- The site-only deployment succeeded, and every published HTML/CSS/JS, data,
  logo, teaser, poster, and video file was checked against its local bytes.
  Repository tooling and provenance are not part of that final served artifact.

## Remove standalone statistics — October 25, 2026

- Removed the four-number statistics strip at the owner's request.
- Retained the abstract verbatim and left all source data and result tables unchanged.
- Removed unused statistics CSS and its scroll-animation target.
- Checked the desktop transition from benchmark features to the abstract; it now
  uses a 40 px gap, with a 28 px gap on small screens.
- All 15 tests pass, including a regression check for the removed strip and
  byte-for-byte abstract text equality with the paper data.
