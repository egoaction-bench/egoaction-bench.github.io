"""Export only the selected paper content and demo annotations; never copy source trees.

Usage: python3 scripts/sync-paper.py --paper /path/to/EgoAction_Paper \
    --episode /path/to/source_gt_episode.json

Use --results-only to refresh benchmark results without changing demo annotations.
"""
import argparse
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
OVERALL_METRICS = ("EgoActionScore", "m_tIoU", "F1", "Temporal", "Hand",
                   "Verb", "Objects", "Tools", "Motion", "Semantic")
DURATION_METRICS = ("Content", "Semantic", "m_tIoU", "Hand")
EGOACTION_MODELS = {"EgoAction (Qwen3-VL-4B)", "EgoAction (LLaVA-OV2-8B)"}


def clean_tex(text):
    text = re.sub(r"~?\\cite\w*\{[^}]+\}", "", text)
    text = re.sub(r"\\phantom\{[^}]*\}", "", text)
    text = re.sub(r"\\(?:textbf|textsc|textit)\{([^{}]*)\}", r"\1", text)
    return text.replace(r"\quad", "").replace(r"\\", "").strip()


def table_rows(path, width):
    rows = []
    for line in path.read_text().splitlines():
        if "&" not in line:
            continue
        cells = [clean_tex(cell) for cell in line.split("&")]
        if len(cells) != width + 1:
            continue
        try:
            values = [float(cell) for cell in cells[1:]]
        except ValueError:
            continue
        rows.append((cells[0], values))
    return rows


def benchmark_overview(abstract):
    # Keep the benchmark description and findings, omitting model-training prose.
    sentences = re.split(r"(?<=[.!?])\s+", abstract)
    overview = []
    for sentence in sentences:
        if sentence.startswith("EgoAction improves EgoActionScore"):
            continue
        if sentence.startswith("We benchmark ") and " and further adapt " in sentence:
            sentence = sentence.split(" and further adapt ", 1)[0] + "."
        overview.append(sentence)
    result = " ".join(overview)
    if re.search(r"supervised fine.tuning|reinforcement learning|\bSFT\b|\bGRPO\b", result, re.I):
        raise ValueError("Review the benchmark overview: the source abstract's training wording has changed.")
    return result


def make_paper_data(paper):
    arxiv = paper / "arxiv"
    main_table = arxiv / "table/tab_main_results.tex"
    main_rows = table_rows(main_table, len(OVERALL_METRICS))
    if len(main_rows) != 23 or len({model for model, _ in main_rows}) != 23:
        raise ValueError("Expected 23 unique published main-table rows with 10 metrics each.")
    groups = {}
    group = None
    for line in main_table.read_text().splitlines():
        match = re.match(r"\\modelgroup\{([^}]+)\}", line)
        if match:
            group = match[1]
        elif "&" in line:
            groups[clean_tex(line.split("&", 1)[0])] = group
    overall = []
    for model, values in main_rows:
        ours = model in EGOACTION_MODELS
        overall.append({
            "model": model,
            "displayName": model.replace("-Instruct", ""),
            "group": groups[model], "ours": ours,
            "reference": model == "Human Expert",
            "scores": dict(zip(OVERALL_METRICS, values)),
        })
    duration_tex = table_rows(arxiv / "table/tab_action_duration.tex", 20)
    duration = []
    backbone = None
    for model, values in duration_tex:
        if model.startswith("+ EgoAction"):
            model = f"EgoAction ({backbone})"
        else:
            backbone = model
        for i, metric in enumerate(DURATION_METRICS):
            duration.append({"model": model, "displayName": model,
                             "ours": model in EGOACTION_MODELS, "metric": metric,
                             "values": values[i*5:(i+1)*5]})
    if len(duration) != 24 or len({(r["model"], r["metric"]) for r in duration}) != 24:
        raise ValueError("Expected 24 metric/model rows in the duration table.")
    abstract = " ".join(line for line in (arxiv / "abstract.tex").read_text().splitlines()
                        if not line.lstrip().startswith("%"))
    abstract = " ".join(clean_tex(abstract).split())
    result = {
        "schemaVersion": 2,
        "source": {"paperUrl": "https://arxiv.org/abs/2611.03646",
                   "publishedVersion": "https://arxiv.org/html/2611.03646v1",
                   "note": "Display values transcribed from the published main and action-duration tables.",
                   "overviewScope": "Benchmark-focused excerpt of the manuscript abstract.",
                   "files": ["arxiv/abstract.tex", "arxiv/table/tab_main_results.tex",
                             "arxiv/table/tab_action_duration.tex"]},
        "overview": benchmark_overview(abstract), "overall": overall, "duration": duration,
    }
    return result


def make_sample(episode):
    source = json.loads(episode.read_text())
    short = {
        "l_1": "Hold pumpkin", "l_2": "Press knife spine", "l_3": "Move piece",
        "l_4": "Reach to knife", "l_5": "Press knife spine",
        "r_1": "Hold cleaver", "r_2": "Cut pumpkin", "r_3": "Hold cleaver",
        "r_4": "Cut pumpkin", "bh_1": "Joint cutting", "bh_2": "Joint cutting",
    }
    # End the excerpt at a real annotation boundary, without modifying any intervals.
    duration_seconds = 10.14
    actions = []
    for a in source["gt"]:
        if a["start"] >= duration_seconds:
            continue
        if a["end"] > duration_seconds:
            raise ValueError(f"Excerpt would truncate source annotation {a['gt_id']}.")
        actions.append({"id": a["gt_id"], "hand": a["hand"], "caption": a["caption"],
                        "start": a["start"], "end": a["end"],
                        "shortLabel": short[a["gt_id"]]})
    sample = {"title": "Cutting pumpkin", "dataset": "EPIC-KITCHENS",
              "annotationType": "Human-refined ground truth",
              "sourceEpisode": source["video_id"],
              "duration": duration_seconds, "sourceFps": 50,
              "clipStart": 0, "sourceDuration": source["duration"],
              "note": "First 10.14 seconds of the teaser episode. Original captions and intervals are unchanged.",
              "sourceAnnotationSha256": hashlib.sha256(episode.read_bytes()).hexdigest(),
              "actions": actions}
    return sample


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", required=True, type=Path)
    parser.add_argument("--episode", type=Path)
    parser.add_argument("--results-only", action="store_true")
    parser.add_argument("--check", action="store_true", help="Verify the exports without writing files.")
    args = parser.parse_args()
    if not args.results_only and args.episode is None:
        parser.error("Supply --episode or use --results-only to preserve the demo annotations.")
    paper = make_paper_data(args.paper.resolve())
    exports = {"paper": paper}
    if not args.results_only:
        exports["sample"] = make_sample(args.episode.resolve())
    directory = SITE / "data"
    index = SITE / "index.html"
    content = index.read_text()
    updated, count = re.subn(r"<!-- ABSTRACT_START -->.*?<!-- ABSTRACT_END -->",
                            "<!-- ABSTRACT_START -->" + html.escape(paper["overview"]) + "<!-- ABSTRACT_END -->",
                            content, flags=re.S)
    if count != 1:
        raise ValueError("Expected one benchmark overview placeholder.")
    updated = updated.replace("<summary>Read the abstract ", "<summary>Read the benchmark overview ")
    if args.check:
        for name, data in exports.items():
            if json.loads((directory / f"{name}.json").read_text()) != data:
                raise ValueError(f"The {name} export differs from its current source.")
        if content != updated:
            raise ValueError("The visible benchmark overview differs from its export.")
    else:
        directory.mkdir(parents=True, exist_ok=True)
        for name, data in exports.items():
            (directory / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        index.write_text(updated)
    verb = "Verified" if args.check else "Exported"
    print(f"{verb} {len(paper['overall'])} overall rows, {len(paper['duration'])} duration rows, "
          f"{len(paper['overall']) * len(OVERALL_METRICS)} main-table scores and "
          f"{sum(len(row['values']) for row in paper['duration'])} duration scores from the published paper tables.")


if __name__ == "__main__":
    main()
