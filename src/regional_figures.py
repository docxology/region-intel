"""Publication figures from the accepted corpus profile; no model or live fetch."""

import json
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

matplotlib.use("Agg")

TEAL, GOLD, INK, MUTED = "#195b61", "#b98228", "#20363b", "#65767a"


def generate_figures(profile_file: Path, destination: Path) -> None:
    profile = json.loads(profile_file.read_text())
    rows = profile["articles"]
    counts = [row["sections"] for row in rows]
    if (
        len(counts) != profile["totalArticles"]
        or sum(counts) != profile["totalSections"]
    ):
        raise ValueError("Figure denominator differs from captured profile")
    destination.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "svg.hashsalt": "regional-manuscript-v1",
            "text.parse_math": False,
        }
    )

    def save(fig, name):
        for extension in ["png", "pdf", "svg"]:
            metadata = (
                {"Date": None}
                if extension == "svg"
                else (
                    {"CreationDate": None, "ModDate": None}
                    if extension == "pdf"
                    else {}
                )
            )
            fig.savefig(
                destination / (name + "." + extension),
                dpi=240,
                bbox_inches="tight",
                facecolor="white",
                metadata=metadata,
            )
        plt.close(fig)

    fig, (left, right) = plt.subplots(
        1, 2, figsize=(10, 4.7), gridspec_kw={"width_ratios": [1, 1.2]}
    )
    upper = max(counts)
    bins = min(25, max(2, upper + 1))
    left.hist(counts, bins=bins, color=TEAL, edgecolor="white")
    left.axvline(
        profile["medianSections"],
        color=GOLD,
        linewidth=2,
        linestyle="--",
        label="Median: " + str(profile["medianSections"]),
    )
    left.set(
        xlabel="Section records per article page",
        ylabel="Article pages",
        title="A. Distribution across every article",
    )
    left.legend(frameon=False, fontsize=9)
    selected = sorted(
        rows, key=lambda row: (-row["sections"], row["number"], row["guid"])
    )[:12][::-1]
    right.barh(
        list(range(len(selected))),
        [row["sections"] for row in selected],
        color=TEAL,
    )
    right.set_yticks(list(range(len(selected))), [row["number"] for row in selected])
    for y, row in enumerate(selected):
        right.text(
            row["sections"] + max(upper * 0.015, 0.1),
            y,
            str(row["sections"]),
            va="center",
            fontsize=9,
        )
    right.set(
        xlabel="Section records",
        ylabel="Article identifier",
        title="B. Twelve largest article pages",
    )
    right.set_xlim(0, max(upper * 1.17, 1))
    fig.suptitle(
        str(profile["totalArticles"])
        + " article pages · "
        + str(profile["totalSections"])
        + " section records",
        color=INK,
        fontsize=14,
        fontweight="bold",
    )
    fig.text(
        0.5,
        0.01,
        "Recorded source structure only; article size is not legal importance "
        "or civic burden.",
        ha="center",
        color=MUTED,
        fontsize=9,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    save(fig, "corpus-profile")

    def box(ax, xy, width, height, title, body, color=TEAL):
        x, y = xy
        ax.add_patch(
            FancyBboxPatch(
                (x, y),
                width,
                height,
                boxstyle="round,pad=0.015",
                linewidth=1.4,
                edgecolor=color,
                facecolor="#f2f6f5",
            )
        )
        ax.text(
            x + width / 2,
            y + height * 0.71,
            title,
            ha="center",
            va="center",
            color=color,
            fontsize=12,
            fontweight="bold",
        )
        ax.text(
            x + width / 2,
            y + height * 0.33,
            body,
            ha="center",
            va="center",
            color=INK,
            fontsize=10,
            linespacing=1.5,
        )

    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.set(xlim=(0, 1), ylim=(0, 1))
    ax.axis("off")
    box(
        ax,
        (0.03, 0.54),
        0.27,
        0.30,
        "Regional ownership",
        "Identity · source policy\nAccepted seed · authored prose",
    )
    box(
        ax,
        (0.37, 0.54),
        0.27,
        0.30,
        "Shared methods",
        "Admission · derived figures\nEvidence hydration · validation",
    )
    box(
        ax,
        (0.71, 0.54),
        0.26,
        0.30,
        "Pinned template",
        "Cover · PDF · HTML\nTypography · citations · assets",
    )
    for x in [0.31, 0.65]:
        ax.add_patch(
            FancyArrowPatch(
                (x, 0.69),
                (x + 0.05, 0.69),
                arrowstyle="-|>",
                mutation_scale=15,
                color=TEAL,
            )
        )
    box(
        ax,
        (0.19, 0.08),
        0.62,
        0.26,
        "Review packet",
        "Exact inputs + complete outputs + separately recorded review",
        GOLD,
    )
    ax.add_patch(
        FancyArrowPatch(
            (0.5, 0.52), (0.5, 0.36), arrowstyle="-|>", mutation_scale=15, color=GOLD
        )
    )
    fig.suptitle(
        "Shared computation, explicit local evidence",
        color=INK,
        fontsize=16,
        fontweight="bold",
    )
    fig.tight_layout()
    save(fig, "architecture")

    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.set(xlim=(0, 1), ylim=(0, 1))
    ax.axis("off")
    labels = [
        ("Recorded corpus", "Bound accepted bytes\nArticle/section denominator"),
        (
            "Selected policy",
            "Declared sources and monitors\nNo collection-success inference",
        ),
        (
            "Native artifact",
            "Source-to-PDF/HTML rendering\nNo truth inference from a build",
        ),
    ]
    for i, (title, body) in enumerate(labels):
        box(ax, (0.025 + i * 0.33, 0.43), 0.29, 0.39, title, body)
    ax.text(
        0.5,
        0.26,
        "Human and external questions remain separate",
        ha="center",
        fontsize=13,
        fontweight="bold",
        color=GOLD,
    )
    ax.text(
        0.5,
        0.10,
        "Legal currency · interpretation · usability · civic impact · publication",
        ha="center",
        fontsize=11,
        color=INK,
    )
    fig.suptitle(
        "Evidence planes support different claims",
        color=INK,
        fontsize=16,
        fontweight="bold",
    )
    fig.tight_layout()
    save(fig, "evidence-boundaries")
