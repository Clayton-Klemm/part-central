"""Manim scenes for README evidence, rendered locally without TeX.

python scripts/build_evidence.py

LatencyReport reads the actual docs/load-test-shifts-results.json; it never
contains hard-coded latency claims. The build helper renders Manim MP4s then
uses a compact shared palette to make readable GIFs for docs/assets.
"""
import json
from pathlib import Path

from manim import *

BACKGROUND = "#102C27"
CREAM = "#F2F0E8"
MUTED = "#A2B8AF"
GREEN = "#92D1AF"
GOLD = "#E0B66F"
ROOT = Path(__file__).resolve().parents[1]


def label(value, size=28, color=CREAM, mono=False):
    return Text(value, font="Consolas" if mono else "Arial", font_size=size, color=color)


def card(title, detail, width=4.0):
    box = RoundedRectangle(corner_radius=.16, width=width, height=1.25, stroke_color=GREEN, stroke_width=1.3, fill_color="#173D34", fill_opacity=1)
    heading = label(title, 25).move_to(box.get_center() + UP * .23)
    body = label(detail, 17, MUTED).move_to(box.get_center() + DOWN * .25)
    return VGroup(box, heading, body)


class NormalizationProof(Scene):
    def construct(self):
        self.camera.background_color = BACKGROUND
        title = label("One definition. Many traceable inspections.", 34).to_edge(UP, buff=.48)
        kicker = label("RELATIONAL DESIGN  /  CONDITIONAL PROOF", 15, GREEN).next_to(title, DOWN, buff=.19)
        self.play(FadeIn(title, shift=UP * .12), FadeIn(kicker))
        requirements = card("Released requirement", "feature_id → operation, nominal, limits", 5.4).move_to(UP * .6 + LEFT * 3.1)
        readings = card("Append-only readings", "run_id + sequence → value, employee, shift", 6.0).move_to(UP * .6 + RIGHT * 3.1)
        arrow = Arrow(requirements.get_right(), readings.get_left(), buff=.06, color=GOLD, stroke_width=3)
        self.play(FadeIn(requirements, shift=RIGHT * .2))
        self.play(FadeIn(readings, shift=LEFT * .2), GrowArrow(arrow))
        key = label("Key + foreign key = one unambiguous reference", 24, GOLD).move_to(DOWN * .57)
        self.play(Write(key), run_time=.7)
        self.wait(1.0)
        equation = label("Repeated: T × F × (R + M)", 25, mono=True).move_to(DOWN * 1.27)
        equation2 = label("Separated: F × R + T × F × M", 25, GREEN, mono=True).next_to(equation, DOWN, buff=.25)
        self.play(FadeIn(equation), FadeIn(equation2))
        self.wait(.8)
        saving = label("10,000 samples × 20 features → 48.82 MiB less repeated text", 23, GOLD).move_to(DOWN * 2.49)
        self.play(FadeIn(saving, shift=UP * .12))
        foot = label("Illustration: R = 256 B, M = 64 B; excludes keys, indexes, compression. Not a disk benchmark.", 13, MUTED).to_edge(DOWN, buff=.28)
        self.add(foot)
        self.wait(3.0)


class LatencyReport(Scene):
    def construct(self):
        report_path = ROOT / "docs" / "load-test-shifts-results.json"
        report = json.loads(report_path.read_text(encoding="utf-8-sig"))
        assert report["overall"]["errors"] == 0 and report["completedSheets"] == report["expectedCompletedSheets"] and report["regressionBudget"]["passed"], "Render only a successful measured run"
        self.camera.background_color = BACKGROUND
        title = label("Measured on the local PostgreSQL stack", 34).to_edge(UP, buff=.45)
        subtitle = label(f"{report['users']} SIGNED-IN CLIENTS  /  {report['completedSheets']} SHEETS  /  {report['overall']['requests']:,} REQUESTS", 16, GREEN).next_to(title, DOWN, buff=.2)
        self.play(FadeIn(title), FadeIn(subtitle))
        self.add(label("p95 latency by request", 17, MUTED).move_to(UP * 1.78))
        endpoints = [("Save reading", "POST measurement"), ("Job history", "GET job history summaries"), ("Reopen sheet", "GET archived sheet")]
        max_value = max(report["endpoints"][key]["p95_ms"] for _, key in endpoints) * 1.3
        for index, (name, key) in enumerate(endpoints):
            value = report["endpoints"][key]["p95_ms"]
            row_y = 1.05 - index * .92
            text_name = label(name, 23).move_to(LEFT * 4.85 + UP * row_y)
            track = RoundedRectangle(width=6.5, height=.31, corner_radius=.06, stroke_width=0, fill_color="#23453B", fill_opacity=1).move_to(RIGHT * .3 + UP * row_y)
            bar_width = max(.05, 6.5 * value / max_value)
            bar = RoundedRectangle(width=bar_width, height=.31, corner_radius=.06, stroke_width=0, fill_color=GREEN, fill_opacity=1).align_to(track, LEFT).move_to(UP * row_y, coor_mask=UP)
            value_label = label(f"{value:.2f} ms", 22, GOLD, mono=True).move_to(RIGHT * 4.7 + UP * row_y)
            self.play(FadeIn(text_name), FadeIn(track), GrowFromEdge(bar, LEFT), FadeIn(value_label), run_time=.65)
        metric = label(f"p95 overall: {report['overall']['p95_ms']:.2f} ms    |    Unexpected errors: 0", 25, GREEN).move_to(DOWN * 2.06)
        self.play(FadeIn(metric))
        caveat = label("Client-observed p95. Local synthetic workload; employee sign-ins excluded from timing.", 15, MUTED).move_to(DOWN * 2.67)
        source = label(f"Source: load-test-shifts-results.json  •  {report['startedAt'][:10]}  •  Not a production SLA", 14, MUTED).to_edge(DOWN, buff=.29)
        self.add(caveat, source)
        self.wait(3.5)
