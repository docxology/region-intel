# Shared manuscript tooling and retained reference edition

The numbered sources and claim ledger in this directory retain the original
Crescent City reference study. Its observations must not be relabelled as results
for another deployment. Generic validation and hydration methods are shared by
all consumers; native rendering and scientific acceptance remain separate.

See [deployment manuscript ownership](../deployments.md#manuscript-and-documentation).

# Manuscript workflow

This directory is the source-controlled manuscript for the Crescent City
Intelligence Platform. The numbered files form one renderer-compatible paper:
abstract, introduction, methods, results, discussion, limitations and ethics,
reproducibility, conclusion, appendix, and references.

Run `bun run manuscript:check` before editing or rendering. Run
`bun run manuscript:hydrate` after `bun run analytics` to substitute the
current analytics evidence into `output/manuscript/`. The generated directory
is ignored and must not be edited by hand.

The claim ledger is part of the manuscript contract. It distinguishes
implementation claims from snapshot observations and records what each claim
does not establish. The shared template repository renders this source through
`scripts/pipeline/stage_03_render.py` after invoking the Python compatibility
adapter at `scripts/z_generate_manuscript_variables.py`.
