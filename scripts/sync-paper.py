"""Export only the selected paper content and demo annotations; never copy source trees.

Usage: python3 scripts/sync-paper.py --paper /path/to/EgoAction_Paper \
    --episode /path/to/source_gt_episode.json
"""
import argparse
import csv
import hashlib
import html
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


def clean_tex(text):
    text = re.sub(r"~?\\cite\w*\{[^}]+\}", "", text)
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


def make_data(paper, episode):
    arxiv = paper / "arxiv"
    main_rows = table_rows(arxiv / "table/tab_main_results_dev15.tex", 8)
    if not main_rows:
        raise ValueError("Main results table could not be parsed.")
    overall = []
    for model, values in main_rows:
        sft = model.startswith("EgoAction (")
        overall.append({
            "model": model,
            "displayName": model[11:-1] if sft else model.replace("-Instruct", ""),
            "sft": sft,
            "reference": model == "Human Expert",
            "score": values[0], "semantic": values[5],
            "temporal": values[6], "hand": values[7],
        })
    duration_tex = table_rows(arxiv / "table/tab_action_duration.tex", 20)
    metrics = ["EgoActionScore", "Semantic", "Temporal", "Hand"]
    expected = {}
    backbone = None
    for model, values in duration_tex:
        if model.startswith("+ EgoAction"):
            model = f"EgoAction ({backbone})"
        else:
            backbone = model
        for i, metric in enumerate(metrics):
            expected[(model, metric)] = values[i*5:(i+1)*5]
    duration = []
    with (arxiv / "data/action_duration/heatmap_scores.csv").open() as f:
        for row in csv.DictReader(f):
            model = row["model"]
            values = [float(row[col]) for col in ["lt_0p5", "0p5_to_1", "1_to_2", "2_to_5", "ge_5"]]
            if values != expected.get((model, row["metric"])):
                raise ValueError(f"CSV and manuscript disagree: {model}, {row['metric']}")
            sft = model.startswith("EgoAction (")
            duration.append({"model": model, "displayName": model[11:-1] if sft else model,
                             "sft": sft, "metric": row["metric"], "values": values})
    if len(duration) != 24:
        raise ValueError("Expected 24 metric/model rows in the duration table.")
    abstract = " ".join(line for line in (arxiv / "abstract.tex").read_text().splitlines()
                        if not line.lstrip().startswith("%"))
    abstract = " ".join(clean_tex(abstract).split())
    revision = subprocess.check_output(["git", "-C", str(paper), "rev-parse", "HEAD"], text=True).strip()
    paths = ["arxiv/abstract.tex", "arxiv/main.tex", "arxiv/table/tab_main_results_dev15.tex",
             "arxiv/table/tab_action_duration.tex", "arxiv/data/action_duration/heatmap_scores.csv"]
    result = {
        "source": {"paperRevision": revision, "note": "Snapshot of the manuscript, not a live leaderboard.",
                   "files": {p: hashlib.sha256((paper / p).read_bytes()).hexdigest() for p in paths}},
        "abstract": abstract, "overall": overall, "duration": duration,
    }
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
    return result, sample


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", required=True, type=Path)
    parser.add_argument("--episode", required=True, type=Path)
    args = parser.parse_args()
    paper, sample = make_data(args.paper.resolve(), args.episode.resolve())
    directory = SITE / "data"
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in [("paper", paper), ("sample", sample)]:
        (directory / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    index = SITE / "index.html"
    content = index.read_text()
    content = re.sub(r"<!-- ABSTRACT_START -->.*?<!-- ABSTRACT_END -->",
                     "<!-- ABSTRACT_START -->" + html.escape(paper["abstract"]) + "<!-- ABSTRACT_END -->",
                     content, flags=re.S)
    index.write_text(content)
    print(f"Exported {len(paper['overall'])} overall rows, {len(paper['duration'])} duration rows, "
          f"{len(sample['actions'])} source annotations. CSV and LaTeX values match.")


if __name__ == "__main__":
    main()
