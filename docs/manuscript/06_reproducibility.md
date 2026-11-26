# Reproducibility and Artifact Specification {#sec:reproducibility}

The input is `docs/examples/synthetic-corpus.json`. Run `bun docs/manuscript/prepare-offline.ts` from the repository root to call the package's profiling functions, verify the stated counts, and write the JSON and CSV under `output/offline-corpus/`. The same command stages the existing architecture diagram and its figure registry under `output/figures/`.

The documented Template revision renders the ordered sources in this directory to combined PDF and HTML. The verification checks source structure, figure custody, and the output manifests. A historical regional seed, separate reference hydration, and a rendered regional publication each have their own output and provenance requirements.
