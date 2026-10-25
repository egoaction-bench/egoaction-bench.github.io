# EgoActionBench project page

A lightweight research project page with a real, synchronized action-annotation
viewer. This repository is **only for the website**. The manuscript remains in
`player0718/EgoAction_Paper`.

## Local preview

Requires Node.js 18 or newer. There are no npm dependencies and no build step.

```sh
npm start
# Open http://127.0.0.1:4173
npm test
```

The preview server binds to loopback only and serves **only `site/`**, with byte
range requests for video seeking. `PORT=4174 npm start` selects another port.
Do not open the HTML using `file://`; JSON loading needs HTTP.

## Structure

- `site/index.html`, `styles.css`, `app.js`, `logic.js`, `motion.js`: the self-contained page.
- `site/assets/`: five hand-selected display assets, not a source-data cache.
- `site/data/paper.json`: overall and duration tables exported from the manuscript.
- `site/data/sample.json`: eleven original annotations for one 10.14-second excerpt.
- `scripts/sync-paper.py`: extracts selected paper content, checking CSV scores
  against the LaTeX duration table before export.
- `scripts/prepare-assets.py`: reproduces the small video, poster, teaser image,
  official teaser wordmark, and first-letter favicon.
- `tests/`: source-data, interval, asset, HTML, and preview-server regression checks.

## Content and provenance

The example is the first 10.14 seconds of the pumpkin-cutting episode used in the
paper teaser. Three buttons select **moments in that same example**, not three
different episodes. These are source human annotations, not model inference;
provenance remains in `site/data/sample.json` rather than in visual badges.
Both examples display the full original captions, and half-open `[start, end)`
times are preserved. The video is resized, encoded as H.264, and stripped of audio,
without changing its 50 fps frame rate, time origin, or playback speed.

Results come from the current manuscript snapshot identified in
`site/data/paper.json`. Displayed one-decimal scores are not recomputed. All five
duration bins remain separate. The date in the existing manuscript is not changed.
The BibTeX entry is a preliminary project citation, not an invented publication.

To update the selected text and scores:

```sh
python3 scripts/sync-paper.py \
  --paper /absolute/path/to/EgoAction_Paper \
  --episode /absolute/path/to/source_gt_episode.json
npm test
```

Optional asset regeneration requires `pypdfium2`, `pypdf`, Pillow, and an existing FFmpeg executable:

```sh
python3 scripts/prepare-assets.py \
  --teaser /absolute/path/to/final/teaser.pdf \
  --video /absolute/path/to/pumpkin_native.mp4 \
  --ffmpeg /absolute/path/to/ffmpeg
```

## Interface and motion

The page uses larger typography throughout: 16 px desktop navigation and primary
buttons, 18 px narrative text, and 16 px desktop result-table values. Small-screen
layouts stack the annotations instead of shrinking the captions. Decorative
eyebrow slogans are omitted; information and control labels remain.
Both video examples use white backgrounds and lightly tinted, outlined caption
cards without colored vertical bars. Captions wrap naturally at 16 px rather
than being rewritten as short labels. Timeline widths still reflect exact action
durations; narrow bars expose the full caption through their accessible label,
tooltip, action picker, and selected-action detail.

The wordmark in the header, hero, and footer is extracted losslessly from the
final paper teaser, not approximated with a font. The split hero uses the existing
example clip and its source annotation intervals. It plays muted while visible,
pauses offscreen, and has an explicit pause/play control. Reduced-motion and
Save-Data preferences suppress automatic playback. Manually pausing is respected,
and the analytical viewer takes precedence over the decorative preview.
Scroll entry effects are subtle and never hide content by default.
No reference-site assets, code, or animation libraries are included.

## Publication boundary

The owner requested the initial GitHub release on October 25, 2026.
Only the selected website and display assets are included.
Paper, Code, and Dataset are clearly marked **Coming soon**; replace those statuses
with reviewed public links when available. The paper source repository is not
presented as evaluation code.

This project does not grant or replace permissions for third-party media.
Review release permissions before adding or replacing any display media;
no full source video, dataset dump, model weights, manuscript PDFs/LaTeX, reference
papers, credentials, analytics, or external font scripts are included.

## Deployment

The `Deploy project page` workflow validates the website and publishes only
`site/`, not scripts, tests, README, or provenance files. It runs on deliberate
pushes to `main`. A manual dispatch is also available with the media-release
confirmation checkbox. Local edits do not publish anything until pushed.

GitHub initially enabled its automatic branch-based build of `main`. The workflow
waits for that build to finish before replacing its output with the site-only
artifact, so the final public root is the designed website rather than the README.
It runs on **every** push to `main`, including documentation changes, to avoid
leaving the automatic branch build as the final deployment.

For the cleanest future deployment setup, a repository administrator can select
**Settings → Pages → Source → GitHub Actions**. The workflow detects that mode
and skips the compatibility wait. Until that setting is changed, the automatic
branch build may briefly appear while an update is deploying.

An initial `gh-pages` branch is retained as a site-only release snapshot; it is
not the active publishing source and does not require a pull request.

To publish a reviewed update after authorization, run `npm test`, commit and push
the changes to `main`, then verify that `Deploy project page` completed and the
public root and assets match `site/`.

The URL in the manuscript remains `https://egoaction-bench.github.io`.
No repository setting is changed by local preview or tests. The current deployment
uses the workflow's scoped Pages permission; no personal access token is stored.
