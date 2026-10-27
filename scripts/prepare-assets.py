"""Prepare the exact small media allowlist for the project page.

Requires pypdfium2, pypdf, Pillow, and an existing FFmpeg executable with libx264 and WebP.
No downloads and no uploads. Input files are never modified.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ("teaser.webp", "pumpkin-poster.webp", "pumpkin.mp4",
           "egoactionbench-logo.webp", "favicon.png")
REVIEWED_OUTPUTS = ("pumpkin-captioned.mp4", "pumpkin-captioned-poster.webp")


def prepare_logo(teaser, assets):
    from pypdf import PdfReader
    from PIL import Image

    # Extract the actual faceted wordmark from the final teaser, not a redraw.
    reader = PdfReader(teaser)
    matches = [item for item in reader.pages[0].images
               if item.name == "IM9.jp2" and item.image.size == (2141, 287)]
    if len(matches) != 1:
        raise ValueError("The final teaser wordmark has changed; review the logo asset before exporting.")
    logo = matches[0].image.convert("RGBA")
    logo.save(assets / "egoactionbench-logo.webp", lossless=True, method=6)
    # The first letter is used at browser-tab size; keep its original artwork.
    glyph = logo.crop((0, 0, 186, 230))
    # The E's top arm extends over the next letter. Exclude the neighboring g
    # below that arm rather than leaving a sliver of it inside the favicon.
    glyph.paste((0, 0, 0, 0), (163, 65, 186, 230))
    glyph = glyph.crop(glyph.getbbox())
    glyph.thumbnail((144, 144), Image.Resampling.LANCZOS)
    favicon = Image.new("RGBA", (192, 192), "white")
    favicon.alpha_composite(glyph, ((192-glyph.width)//2, (192-glyph.height)//2))
    favicon.convert("RGB").save(assets / "favicon.png")
    return {"source": "Final paper teaser, embedded IM9.jp2",
            "sourceDimensions": [2141, 287], "wordmark": "Lossless extraction",
            "favicon": "First letter of the same wordmark, fitted to 192×192"}


def main():
    import pypdfium2 as pdfium

    parser = argparse.ArgumentParser()
    parser.add_argument("--teaser", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    args = parser.parse_args()
    assets = ROOT / "site/assets"
    assets.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "media-manifest.json"
    previous_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    reviewed = tuple(name for name in REVIEWED_OUTPUTS if (assets / name).is_file())
    if reviewed and reviewed != REVIEWED_OUTPUTS:
        raise ValueError("Keep the reviewed captioned video and its poster together.")
    logo_provenance = prepare_logo(args.teaser, assets)
    with pdfium.PdfDocument(args.teaser) as pdf:
        assert len(pdf) == 1, "Supply the final single-page teaser, not a comparison deck."
        pdf[0].render(scale=2).to_pil().convert("RGB").save(assets / "teaser.webp", quality=94, method=6)
    subprocess.run([
        str(args.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(args.video), "-t", "10.14", "-an",
        "-vf", "scale=960:-2", "-c:v", "libx264", "-crf", "24", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(assets / "pumpkin.mp4")
    ], check=True)
    subprocess.run([
        str(args.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "4.5", "-i", str(assets / "pumpkin.mp4"), "-frames:v", "1",
        str(assets / "pumpkin-poster.webp")
    ], check=True)
    manifest = {
        "note": "Local preview assets. Confirm public release permission before deployment.",
        "video": {"sourceSha256": hashlib.sha256(args.video.read_bytes()).hexdigest(),
                  "clip": [0, 10.14], "sourceFps": 50, "encodedFps": 50,
                  "audio": "removed", "width": 960, "speedChanged": False},
        "teaserSourceSha256": hashlib.sha256(args.teaser.read_bytes()).hexdigest(),
        "logo": logo_provenance,
        "outputs": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                    for p in (assets / name for name in OUTPUTS + reviewed)},
    }
    # The approved captioned clip is imported separately, never silently regenerated.
    if reviewed and "heroVideo" in previous_manifest:
        manifest["heroVideo"] = previous_manifest["heroVideo"]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("Prepared only " + ", ".join(OUTPUTS) + ".")


if __name__ == "__main__":
    main()
