"""Render the README Manim GIFs and record their exact source fingerprints."""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCENES = {"NormalizationProof": "normalization-proof", "LatencyReport": "latency-report"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("Install FFmpeg and put it on PATH before rendering the evidence GIFs.")
    subprocess.run([sys.executable, "-m", "manim", "-ql", "--fps", "12", "-r", "960,540", "--format", "mp4", "--media_dir", ".tools-media", "scripts/render_evidence.py", *SCENES], cwd=ROOT, check=True)
    assets = ROOT / "docs" / "assets"
    assets.mkdir(exist_ok=True)
    for scene, name in SCENES.items():
        source = ROOT / ".tools-media" / "videos" / "render_evidence" / "540p12" / f"{scene}.mp4"
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vf", "split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=full[p];[s1][p]paletteuse=dither=none", "-loop", "0", str(assets / f"{name}.gif")], check=True)
    sources = ["scripts/render_evidence.py", "scripts/build_evidence.py", "docs/load-test-shifts-results.json"]
    manifest = {"renderer": f"Manim Community {version('manim')} + FFmpeg palette conversion", "resolution": [960, 540], "fps": 12,
                "sourceSha256": {name: digest(ROOT / name) for name in sources},
                "outputs": {f"{name}.gif": {"sha256": digest(assets / f"{name}.gif"), "bytes": (assets / f"{name}.gif").stat().st_size} for name in SCENES.values()}}
    (assets / "evidence-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Rendered and fingerprinted docs/assets/normalization-proof.gif and latency-report.gif")


if __name__ == "__main__":
    main()
