# Manuscripts, scholarship and template-backed rendering

Region Intel owns generic manuscript admission, evidence projection, numerical
profiling, figure production, output custody and external-template orchestration.
Regional consumers own their prose, bibliography, claim ledger, artwork and
accepted public evidence. The retained Crescent reference paper is distinct from
the independently authored Davis software/corpus case study.

## Regional publication backend

Native regional rendering uses the actual **docxology/template RenderManager**
combined PDF and HTML APIs. The dependency is pinned to
[c18dae54a07fe6ac3a7b1a1a274251c169a12e7a](https://github.com/docxology/template/tree/c18dae54a07fe6ac3a7b1a1a274251c169a12e7a).
There is no direct-Pandoc fallback. Template code is imported from that external
checkout; it is not copied into a consumer or reimplemented in this package.

Prepare that clean template revision with its declared Python toolchain and
frozen dependencies. Its offline reader requires the exact MathJax dependencies
in its npm lockfile; follow the template's Node 24/npm 11.20.0 instructions.
For this workflow, optional browser-install scripts are unnecessary because the
figures are generated with Matplotlib rather than Mermaid.

~~~sh
# In the pinned template checkout:
uv sync --frozen --no-default-groups --extra rendering
npm ci --ignore-scripts
~~~

Pandoc 3.12.1 and matching pandoc-crossref 0.3.26, XeLaTeX/BibTeX, qpdf and
pdftotext are required for the qualified workflow. Select the checkout and
interpreter explicitly; do not infer them from a consumer's location.

~~~sh
export REGION_TEMPLATE_ROOT=/path/to/pinned/template
export REGION_TEMPLATE_PYTHON=/path/to/pinned/template/.venv/bin/python
# In a configured regional consumer:
bun install --frozen-lockfile
bun run manuscript:check
bun run manuscript:render
bun run manuscript:validate-render
bun run manuscript:bundle
bun run manuscript:validate-render -- --bundle
~~~

On the local GitVault installation, verify both interpreter prefixes and keep
source, dependencies, TMP and caches on that mounted volume. The consumer's Bun
toolchain is unchanged. Native work uses a fresh ignored namespace under the
selected template's output/region-intel-builds directory, satisfying the
template's confined offline asset writer. Failed native work is retained.

## Authored input and derived figures

A consumer supplies ten labelled numbered sections, references.bib,
claim_ledger.json and config.json under docs/manuscript. Configuration retains
the regional-manuscript/v1 schema and review-draft status. An optional cover
object has path, alt and credit strings. Optional authorOrcids maps declared
author names to validated ORCID identifiers; identifier checks include the checksum. Its path selects a bounded PNG under
docs/assets; all three fields and the exact image bytes participate in the input
identity. No title-page image is treated as measured geographic evidence.

The accepted public seed supplies the article/section denominator. A complete
article-level profile supplies minimum, median, maximum, zero-count pages and
the CSV behind the measured figure. Publication figures have PNG, PDF and SVG
versions. The architecture and evidence-boundary diagrams are explanatory;
the corpus-profile figure is descriptive data. No population inference,
legal-importance score or civic-impact outcome is computed.

The [scholarship record](scholarship.md) maps ten contextual references to the
limited claims they support. Literature results never substitute for a regional
evaluation. The [generic methods manuscript](region-methods-manuscript.md)
describes the shared/local boundary without relabelling Crescent observations.

## Complete native packet and replay

Native packets use regional-manuscript-review/v2. Upgrading from the earlier
direct-Pandoc v1 receipt requires a fresh render and renewed applicable review.
The review target remains review/VERSION-draft; no command creates a release,
tag or DOI. Preserve the entire packet:

- manuscript.pdf and manuscript.txt;
- web/index.html, its font/MathJax assets and favicon;
- figures, including native vector/raster variants and the cover;
- all hydrated sections, bibliography, claim ledger and exact CSV/profile JSON;
- source evidence, template request/provenance and review receipt.

Copying the HTML entry point alone is incomplete. Replay checks the exact bounded
member set, every hash, current text/data/artwork projection and the pinned
template asset hashes. Actual template source identity and imported API are
verified at native execution. A completed stage is validated before promotion;
partial or invalid output cannot displace the prior complete edition.

Recorded source verification, native execution, independent technical review,
scientific/legal acceptance and publication decisions remain distinct. A
renderer-generated receipt explicitly does not manufacture review or publication
approval. Do not edit generated members to make them agree with prose.

## Retained reference manuscript

The numbered sources under this repository's docs/manuscript directory retain
the Crescent reference study and its own claim/evidence scope. They are not
the Davis manuscript. Existing reference hydration remains available through
the thin Python adapter; the route below is retained for that reference edition.

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
