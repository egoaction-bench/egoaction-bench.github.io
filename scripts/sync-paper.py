"""Export only the selected paper content and demo annotations; never copy source trees.

Usage: python3 scripts/sync-paper.py --paper /path/to/EgoAction_Paper \
    --episode /path/to/source_gt_episode.json

Use --results-only to refresh benchmark results without changing demo annotations.
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
    main_rows = table_rows(arxiv / "table/tab_main_results_dev15.tex", 10)
    if len(main_rows) != 22 or len({model for model, _ in main_rows}) != 22:
        raise ValueError("Expected 22 unique main-table rows with 10 metrics each.")
    results = json.loads((arxiv / "data/main_results.json").read_text())
    if set(results["selected_grpo_rows"]) != EGOACTION_MODELS:
        raise ValueError("The final EgoAction model selection has changed; review it before exporting.")
    groups = {}
    group = None
    for line in (arxiv / "table/tab_main_results_dev15.tex").read_text().splitlines():
        match = re.match(r"\\modelgroup\{([^}]+)\}", line)
        if match:
            group = match[1]
        elif "&" in line:
            groups[clean_tex(line.split("&", 1)[0])] = group
    overall = []
    for model, values in main_rows:
        original = results["rows"][model]
        scores = original["scores"].get("main", original["scores"])
        if values != [round(scores[metric], 1) for metric in OVERALL_METRICS]:
            raise ValueError(f"Main table and result JSON disagree: {model}")
        ours = model in EGOACTION_MODELS
        if ours:
            selected = results["grpo_selection"]["rows"][model]
            if original["training_stage"] != "SFT+GRPO" or selected["scores"] != scores:
                raise ValueError(f"The final-model provenance does not match: {model}")
            for artifact in ("summary", "result"):
                snapshot = arxiv / selected[f"{artifact}_snapshot"]
                if hashlib.sha256(snapshot.read_bytes()).hexdigest() != selected[f"{artifact}_sha256"]:
                    raise ValueError(f"The archived {artifact} checksum does not match: {model}")
            archived = json.loads((arxiv / selected["result_snapshot"]).read_text())["new_scores"]
            archived = archived.get("main", archived)
            if archived != scores:
                raise ValueError(f"The archived scores do not match the main results: {model}")
        overall.append({
            "model": model,
            "displayName": model.replace("-Instruct", ""),
            "group": groups[model], "ours": ours,
            "reference": model == "Human Expert",
            "scores": dict(zip(OVERALL_METRICS, values)),
        })
    duration_tex = table_rows(arxiv / "table/tab_action_duration.tex", 20)
    expected = {}
    backbone = None
    for model, values in duration_tex:
        if model.startswith("+ EgoAction"):
            model = f"EgoAction ({backbone})"
        else:
            backbone = model
        for i, metric in enumerate(DURATION_METRICS):
            expected[(model, metric)] = values[i*5:(i+1)*5]
    duration = []
    with (arxiv / "data/action_duration/heatmap_scores.csv").open() as f:
        for row in csv.DictReader(f):
            model = row["model"]
            values = [float(row[col]) for col in ["lt_0p5", "0p5_to_1", "1_to_2", "2_to_5", "ge_5"]]
            if values != expected.get((model, row["metric"])):
                raise ValueError(f"CSV and manuscript disagree: {model}, {row['metric']}")
            duration.append({"model": model, "displayName": model,
                             "ours": model in EGOACTION_MODELS, "metric": row["metric"], "values": values})
    if len(duration) != 24 or len({(r["model"], r["metric"]) for r in duration}) != 24:
        raise ValueError("Expected 24 metric/model rows in the duration table.")
    provenance = json.loads((arxiv / "data/action_duration/provenance_v55.json").read_text())
    for source in provenance["sources"]["models"]:
        if source["paper_model"] in EGOACTION_MODELS:
            selected = results["grpo_selection"]["rows"][source["paper_model"]]
            if Path(source["folder"]).name != selected["case"]:
                raise ValueError(f"Duration results use a different model checkpoint: {source['paper_model']}")
    abstract = " ".join(line for line in (arxiv / "abstract.tex").read_text().splitlines()
                        if not line.lstrip().startswith("%"))
    abstract = " ".join(clean_tex(abstract).split())
    revision = subprocess.check_output(["git", "-C", str(paper), "rev-parse", "HEAD"], text=True).strip()
    paths = ["arxiv/abstract.tex", "arxiv/table/tab_main_results_dev15.tex", "arxiv/data/main_results.json",
             "arxiv/table/tab_action_duration.tex", "arxiv/data/action_duration/heatmap_scores.csv",
             "arxiv/data/action_duration/provenance_v55.json"]
    result = {
        "schemaVersion": 2,
        "source": {"paperRevision": revision, "note": "Benchmark display values transcribed from the current manuscript tables.",
                   "overviewScope": "Benchmark-focused excerpt of the manuscript abstract.",
                   "metricProtocolVersion": results["metric_protocol_version"],
                   "metricProtocolSha256": results["metric_protocol_sha256"],
                   "files": {p: hashlib.sha256((paper / p).read_bytes()).hexdigest() for p in paths}},
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
          "220 main-table scores and 120 duration scores. Sources and archived final-model results match.")


if __name__ == "__main__":
    main()
