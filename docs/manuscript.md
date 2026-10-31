# Manuscript and template rendering

The source-controlled paper is in [`docs/manuscript/`](manuscript/). It is a
software-and-artifact evaluation paper, not a claim of safety impact or legal
sufficiency. The manuscript keeps implementation invariants, one-run
observations, generated language, and public-delivery claims separate through
`docs/manuscript/claim_ledger.json`.

## Ownership after extraction

The renderer adapter, numbered sources, bibliography and claim ledger live in
`region-intel`. Use the shared checkout as the renderer project for that retained reference
study. A configured consumer can own independent regional source prose and
claims through the shared native workflow below; the reference findings are
never relabelled as a Davis study. The [regional methods manuscript](region-methods-manuscript.md)
describes the common design without importing numerical reference findings.

## Consumer-owned regional manuscripts

A consumer may own ten numbered, labelled source sections, a bibliography,
claim ledger and `docs/manuscript/config.json` using `regional-manuscript/v1`.
The local document declares a title, semantic manuscript version, author list
and explicit `review-draft` status. Generic checking/hydration/rendering remains
in `src/regional_manuscript.ts`; no renderer implementation is copied into a
consumer. The retained Crescent study remains the default when no local config
is selected. A local config routes manuscript commands to that consumer's own
sources and exact accepted public seed.

From a configured consumer, run:

```sh
bun run manuscript:check
bun run manuscript:render
bun run manuscript:validate-render
bun run manuscript:bundle
bun run manuscript:validate-render -- --bundle
```

Checking recomputes source denominators and captures configuration, frozen
dependency, seed/publication verification, source prose, bibliography, ledger
and renderer hashes. Unsupported claims, unknown tokens and changed bindings
fail. Rendering uses native Pandoc, XeLaTeX, qpdf and pdftotext through bounded
owned children, with raw HTML/TeX disabled in manuscript Markdown. Failed
staging is retained; prior complete output is preserved. PDF/HTML and exact
input/tool/output receipts live under consumer `output/manuscript-review/`.
Bundle writes a visibly labelled `review/<version>-draft/` packet; it does not
create a GitHub release, tag or DOI. Inspect actual PDF pages and obtain an
independent review before declaring a particular packet review-ready. Source,
render, scientific and publication acceptance remain distinct. See Davis for
an authored inland application; do not substitute the Crescent findings.

## Source and hydration

The numbered Markdown files provide the renderer-compatible IMRAD spine:
abstract, introduction, methods, results, discussion, limitations and ethics,
reproducibility, conclusion, appendix, and references. Run:

~~~text
bun run analytics
bun run manuscript:check
bun run manuscript:hydrate
bun run scripts/validate-manuscript.ts --hydrated
~~~

Hydration reads `output/state/analytics-overview.json`, writes
`output/data/manuscript_variables.json`, and creates the ignored
`output/manuscript/` tree. The analytics input fingerprint is preserved in the
variable artifact and rendered abstract/results text. Do not edit generated
Markdown or hand-copy snapshot values into source prose.

## Rendering with the shared template repository

The external template renderer can consume this project through a temporary
link. Set both paths to existing absolute checkouts; the example refuses to
replace an existing link or directory:

~~~bash
CCI_TEMPLATE_CHECKOUT=/path/to/template
CCI_PROJECT_CHECKOUT=/path/to/region-intel
(
  cd "$CCI_TEMPLATE_CHECKOUT" || exit 1
  CCI_RENDER_LINK="$PWD/projects/working/region-intel"
  if [ -e "$CCI_RENDER_LINK" ] || [ -L "$CCI_RENDER_LINK" ]; then
    echo "Renderer link already exists; select an unused project slot." >&2
    exit 1
  fi
  mkdir -p "$PWD/projects/working"
  ln -s "$CCI_PROJECT_CHECKOUT" "$CCI_RENDER_LINK" || exit 1
  trap 'unlink "$CCI_RENDER_LINK"' EXIT
  uv run python scripts/pipeline/stage_03_render.py --project working/region-intel
)
~~~

The renderer invokes `scripts/z_generate_manuscript_variables.py`, which
delegates to Bun, then compiles `output/manuscript/` into PDF and HTML. The
link must be removed after the render; the template repository is not a
project dependency and no template source is changed by this workflow. Record
the exact template commit, runtime/toolchain, hydration fingerprint, and actual
PDF/HTML outputs for each acceptance run. Regenerate and render again when the
analytics inputs change; a prior compile does not verify the latest metrics.

## Publication checks

`bun run validate` includes the manuscript source contract in addition to the
TypeScript, deterministic test, generated-output, Pages, and whitespace gates.
When an analytics overview exists, it also hydrates and checks the generated
manuscript fingerprint. The manuscript validator checks H1 continuity, IMRAD
headings, Pandoc citations, bibliography closure, equation/table references,
token names, claim-ledger shape, and hydrated output. A successful renderer
compile is necessary but does not establish LLM factuality, source
completeness, public interpretability, legal advice, or safety efficacy.
