# Regional operations

Use a regional consumer for local operation and `region-intel` for shared-method
development. Read [deployments](deployments.md) for command routing and
[configuration](configuration.md) for environment settings. Install the frozen
lockfile with Bun; CI pins Bun 1.4.2. On GitVault, follow its enclosing storage,
runtime and repository-admission contract for every source command.

## Start from an independent clone

Clone `docxology/crescent-city-intel` or `docxology/davis-ca-intel`. In that checkout:

```sh
bun install --frozen-lockfile
bun run status
bun run validate
bun run pages:export
bun run pages:validate -- .pages
```

This uses the tracked accepted public seed without requiring a neighboring
core checkout, model server or new live acquisition. Read `docs/edition.md` for
the seed's exact municipality, verification time and input hashes. Output paths
are consumer-owned; `.pages/` and `output/` remain generated local artifacts.

`bun run gui` serves the local interface, normally on port 3000. Static code
search uses the accepted public projection. Local GUI corpus search instead
uses acquired/promoted raw articles; installing dependencies or exporting the
static seed does not populate that corpus. RAG additionally needs its configured
model/vector services and profile-bound index. Never copy another city's output.

## Acquire and accept a new municipal edition

Install Chromium separately with `bunx playwright install chromium`; use the
workflow's headless setting where appropriate. Inspect the consumer's
`region.candidate.json` and keep its output root separate from active output
and seeds. Run from the consumer:

```sh
REGION_DEPLOYMENT=region.candidate.json bun run all
bun run corpus:check -- --source .corpus-candidates/EDITION
bun run corpus:promote -- --source .corpus-candidates/EDITION
bun run corpus:check
bun run pages:seed
bun run pages:export
bun run pages:validate -- .pages
```

Replace `EDITION` with the actual candidate directory declared by configuration.
An `all` failure stops before later stages. Re-run against that same candidate
to resume; preserve failed reports and checkpoints. Full local source/extraction
and TOC-member custody, the current TOC and a deterministic live sample must
qualify the complete edition. A live sample is not an all-page legal-currentness
certificate. Explicit source-marked reserved/repealed sections stay counted;
unmarked empty content remains a failure.

Promotion checks identities and exact source hashes, rejects protected or
overlapping roots, preserves unrelated producer state and journals bounded
transactions. On a failed later batch or cancellation it restores earlier
batches. Preserve interrupted journals for supported recovery on the next
promotion; do not delete locks or manually mix candidate files with active data.
Refresh edition documentation only from the accepted public input receipts.
Raw provider HTML, recovery records, credentials and operator diagnostics remain
local and ignored; public seeds contain reviewed projections and commitments.

## Collect other sources

Run `source-discovery`, `news`, `gov-meetings` and enabled `alerts` separately
when diagnosing upstream access, or use `weekly-check` for the declared regional
sequence. The [routing table](deployments.md#command-routing) describes locality
differences. Inspect per-source health and actual dated output: a catalog entry
is not collected evidence, and an unavailable feed is not an empty healthy feed.
Monitor selection does not establish local safety coverage. Calendar, source
rights, notification destinations and paid providers keep their own prerequisites.

## Check and publish changes

Shared checkout: run `bun run docs:generate` after authority/source-inventory
changes, then `bun run docs:check` and the full `bun run validate`. Preserve
failed gate logs, skips, output fences and measured coverage denominators.
For a new runtime package, update each consumer's exact Git SHA with `bun install`,
commit its lockfile and run its `validate`, fresh `pages:export` and
`pages:validate`. A documentation-only core commit does not automatically change
an already qualified consumer runtime pin.

Each consumer owns acceptance and Pages Actions workflows. Main pushes trigger
them; scheduled collection and Pages builds can fetch live sources. The shared
repository does not deploy consumer hostnames. Check the workflow's exact head
SHA and conclusion after a push. Remote publication identity and served bytes
need their own check; a passing local export is not evidence of hosted success.

## Diagnose without erasing evidence

| Symptom | Check |
| --- | --- |
| Frozen install fails | Compare the manifest's exact public Git SHA and `bun.lock`; do not replace the dependency with a sibling `file:` path |
| Profile/output binding fails | Compare deployment, civic and regional-policy identities; preserve the occupied root and use a new correctly bound root or reviewed migration |
| Local search is empty but static search works | Acquire and promote the selected raw municipal corpus; static seeds do not include private raw articles |
| Provider returns 403, a challenge or partial content | Retain unavailable/failure evidence; resume only through the adapter's supported path and never promote the partial candidate |
| Source report says `not-checked` | Run the applicable collector; source discovery alone may only describe configuration |
| Pages validation fails | Re-export from unchanged accepted inputs, retain the failure and inspect identity/hash/member differences; do not bless stale output |
| RAG is unavailable | Check actual model/vector services and profile-bound index separately from deterministic corpus and Pages checks |
| Renderer cannot find adapter or source | Point the template project at the shared checkout, following [manuscript rendering](manuscript.md); the consumers contain application notes only |
