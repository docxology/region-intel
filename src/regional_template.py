"""Thin adapter to the actual, pinned docxology/template RenderManager."""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result.stdout.strip()


def main() -> None:
    stage, root = [Path(value).resolve(strict=True) for value in sys.argv[1:]]
    request = json.loads((stage / "template-request.json").read_text())
    revision = request["revision"]
    if git(root, "rev-parse", "HEAD") != revision or git(
        root, "status", "--porcelain", "--untracked-files=no"
    ):
        raise ValueError(
            "Template source must be a clean checkout of the exact declared revision"
        )
    origin = git(root, "remote", "get-url", "origin")
    if origin.rstrip("/").removesuffix(".git") not in {
        "https://github.com/docxology/template",
        "git@github.com:docxology/template",
    }:
        raise ValueError("Template repository identity differs")
    sys.path.insert(0, str(root))
    import matplotlib
    import yaml
    from infrastructure.rendering import RenderingConfig, RenderManager, core

    if not Path(core.__file__).resolve().is_relative_to(root):
        raise ValueError(
            "Imported renderer does not belong to the selected template checkout"
        )
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from regional_figures import generate_figures

    # The template's confined offline-asset writer requires project output under
    # the selected checkout. This fresh ignored namespace is never canonical source.
    parent = root / "output" / "region-intel-builds"
    parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="native-", dir=parent))
    manuscript, figures, output = (
        work / "manuscript",
        work / "output/figures",
        work / "output",
    )
    manuscript.mkdir()
    figures.mkdir(parents=True)
    print("TEMPLATE_WORK", work, flush=True)
    config, variables = request["config"], request["variables"]
    for source in stage.glob("[0-9][0-9]_*.md"):
        shutil.copyfile(source, manuscript / source.name)
    for name in ["references.bib", "graphical_abstract.md", "preamble.md"]:
        shutil.copyfile(stage / name, manuscript / name)
    generate_figures(stage / "corpus-profile.json", figures)
    paper = {
        "title": config["title"],
        "subtitle": "Version "
        + config["version"]
        + " — review draft; not a published release",
        "date": variables["VERIFIED_AT"][:10],
        "frontmatter": ["graphical_abstract.md"],
    }
    if "cover" in config:
        shutil.copyfile(stage / "figures/cover.png", figures / "cover.png")
        paper["cover"] = {
            "image": "../output/figures/cover.png",
            "alt": config["cover"]["alt"],
        }
    native = {
        "paper": paper,
        "authors": [
            {
                "name": name,
                **(
                    {"orcid": config["authorOrcids"][name]}
                    if name in config.get("authorOrcids", {})
                    else {}
                ),
            }
            for name in config["authors"]
        ],
        "metadata": {"language": "en"},
        "rendering": {
            "section_breaks": False,
            "cover_height_fraction": 0.43,
            "figure_height_fraction": 0.58,
        },
        "render": {
            "formats": {
                "pdf": True,
                "html": True,
                "slides": False,
                "docx": False,
                "epub": False,
            }
        },
    }
    (manuscript / "config.yaml").write_text(yaml.safe_dump(native, sort_keys=False))
    cfg = RenderingConfig(
        manuscript_dir=str(manuscript),
        figures_dir=str(figures),
        output_dir=str(output),
        pdf_dir=str(output / "pdf"),
        web_dir=str(output / "web"),
        slides_dir=str(output / "slides"),
        enable_slides=False,
        web_asset_mode="local",
    )
    if not shutil.which("pandoc-crossref"):
        raise ValueError("Native template figures require pandoc-crossref")
    manager = RenderManager(cfg, manuscript_dir=manuscript, figures_dir=figures)
    sections = [
        manuscript / "graphical_abstract.md",
        *sorted(manuscript.glob("[0-9][0-9]_*.md")),
    ]
    pdf = manager.render_combined_pdf(sections, manuscript, variables["PROFILE_ID"])
    html = manager.render_combined_web(sections, manuscript, variables["PROFILE_ID"])
    if git(root, "rev-parse", "HEAD") != revision or git(
        root, "status", "--porcelain", "--untracked-files=no"
    ):
        raise ValueError("Template source changed during rendering")
    shutil.copyfile(pdf, stage / "manuscript.pdf")
    (stage / "web").mkdir()
    shutil.copyfile(html, stage / "web/index.html")
    shutil.copyfile(html.parent / "favicon.ico", stage / "web/favicon.ico")
    shutil.copytree(html.parent / "assets", stage / "web/assets")
    for source in figures.iterdir():
        if source.name != "cover.png":
            (stage / "figures").mkdir(exist_ok=True)
            shutil.copyfile(source, stage / "figures" / source.name)
    tools = {
        "template": "docxology/template@" + revision,
        "python": sys.version.splitlines()[0],
        "matplotlib": matplotlib.__version__,
    }
    proof = {
        "repository": request["repository"],
        "revision": revision,
        "inputFingerprint": variables["EVIDENCE_FINGERPRINT"],
        "tools": tools,
        "api": [
            "RenderManager.render_combined_pdf",
            "RenderManager.render_combined_web",
        ],
        "rendererModuleSha256": hashlib.sha256(
            Path(core.__file__).read_bytes()
        ).hexdigest(),
        "formats": ["pdf", "html"],
        "offlineAssets": True,
    }
    (stage / "template-render.json").write_text(json.dumps(proof, indent=2) + "\n")


if __name__ == "__main__":
    main()
