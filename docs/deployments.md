# Regional deployments

A thin deployment contains `region.json`, configuration JSON, a pinned
`region-intel` dependency and `scripts/region.ts`:

```ts
import { fileURLToPath } from "node:url";
import { runRegionalCli } from "region-intel/cli";
await runRegionalCli({ root: fileURLToPath(new URL("../", import.meta.url)), args: Bun.argv.slice(2).filter(arg => arg !== "--") });
```

The versioned `region-deployment/v1` document selects `civicProfile`,
`regionConfig`, `outputDir`, `seedDir`, `enabledMonitors` and `sources`.
Every path belongs to the consumer. Identity and monitor policy must share a
profile ID. No regional source code is copied into consumers. Configuration is
public data: never include credentials. Use environment variables for secrets.

`bun run validate` in a consumer validates its configuration and installed
package integration. `bun run validate` in this repository runs the shared
release gate. These are separate evidence planes. Run `bun run pages:export`
and `bun run pages:validate` in each consumer to build and check its publication.
Use `bun run source-discovery` for the configured source catalog, `bun run news`
for feeds, `bun run gov-meetings` for bounded official-page links, and
`bun run alerts` for the explicitly enabled monitor roster. Live fetch failures
remain visible; an empty result does not establish absence of hazards.

## Command routing

Both consumers use the same dispatcher, but locality-specific features retain
their actual admission and presentation. Source entry points below live in the
installed package, never in a copied consumer `src/` tree.

| Command or surface | Crescent compatibility profile | Alternate regional profile, including Davis |
| --- | --- | --- |
| `validate`, `status`, `civic:profile`, `region:config` | Configuration, output identity and installed-package admission | Same shared admission; not a provider or model readiness check |
| `scrape`, `verify`, `export`, `index`, `query`, `chat` | Installed source entry points | Same shared methods with selected profile and owned roots |
| `alerts` / enabled `alerts:*` | Explicit configured monitor batch | Only the selected enabled roster; disabled adapters are rejected |
| `source-discovery` | Canonical Crescent registry and retained health | Configured source catalog, initially `not-checked`; no reachability probe |
| `gov-meetings` | Reference meeting/archive adapter | Bounded official-page meeting/agenda/minutes links, at most 100 per source; dates remain null |
| `analytics`, `insights` | Reference analytics and evidence pipeline | Retained observation counts with explicit lack of comparable sampling windows |
| `gui` | Authored Quadruplicate application | Regional dashboard plus shared API and local corpus search |
| `pages:export`, `pages:validate` | Authored multi-page static edition and validation | Regional static dashboard, accepted code edition and exact-byte source replay |
| `weekly-check` | Crescent reference collection workflow | Catalog, news, meetings, enabled alerts, geography, observation summary and Pages checks; failed steps remain in the run receipt |
| `manuscript:*` | Retained reference tooling unless a local manuscript config is selected | Consumer-owned manuscript sources when configured; shared native PDF/HTML methods and exact accepted-seed evidence |
| `docs:*` | Installed reference-source documentation tooling | Same installed documentation tooling; does not copy a guide tree into the consumer |

The package's OpenAPI inventory describes the shared API; the regional dashboard
does not promise every authored reference interface. Optional model retrieval
requires separate model/vector services. `pages:validate` checks a local export;
it does not check a remote deployment. The consumer importer removes standalone
`--` separators so forwarded arguments reach the same command parser.

## Compatibility

Crescent City retains the reviewed public seed, publication identity and
Crescent-specific reference adapters. The core owns those implementations.
Davis uses an independent eCode360 municipality, inland weather/geography,
Yolo County policy and official City sources. Marine, tide, harbor, tsunami,
fisheries and coastal vessel feeds are excluded from its enabled roster.
Unenabled provider policy fields in the v1 full policy schema are inert; they
must not be described as Davis coverage.

## Manuscript and documentation

All generic method/module documentation and manuscript tooling are maintained
here. `docs/manuscript/` is the retained evidence-bound reference manuscript;
its numerical claims concern its recorded Crescent edition only. Regional
manuscript notes must cite their own input artifacts. Do not relabel the
reference manuscript's findings as Davis results. Native PDF/DOCX rendering is
an optional external toolchain and requires inspection of its own outputs.

## Workflows and publication

The shared repository runs `.github/workflows/core.yml` for core qualification.
Its guarded legacy delivery workflows are compatibility examples. Each consumer
owns `validate.yml`, `pages.yml` and `weekly.yml`. A consumer main push triggers
acceptance and Pages delivery; the workflow may collect live sources before
exporting. Editing docs and pushing does not acquire a new municipal edition.
See [operations](operations.md) for exact local checks and evidence to retain.

## Upgrade

Change the dependency to a reviewed full Git SHA, run `bun install` and commit
the resulting `bun.lock`. Re-run consumer acceptance for both regions and the
shared gate for that core SHA. An upgrade must not silently reuse a data root
bound to a different profile. No mutable branch or local `file:` dependency is
used in published deployment manifests.

## Candidate acquisition and accepted corpus publication

Use a separate deployment configuration such as `region.candidate.json` whose
output directory is a sibling of active output. Run acquisition, verification
and export there before touching the active corpus. Interrupted candidates remain
unaccepted; the current public seed stays intact.

The shared corpus methods validate the selected profile, complete TOC/article
membership, retained raw-source extraction custody, exact manifest/TOC/article
hash binding and the recorded live verification planes. Promotion preserves
unrelated producer state. Existing bounded artifact transactions are composed
with a recoverable journal, metadata last and reverse rollback; their individual
limits are not bypassed. Neither offline-only checks nor a fabricated report
qualifies a source edition.

A verified public code edition can be seeded and exported by the generic regional
Pages renderer. Static search and code downloads derive from that accepted edition;
partial candidate data is never merged into a public snapshot.

From a consumer, run:

```sh
bun run corpus:check -- --source .corpus-candidates/reviewed-edition
bun run corpus:promote -- --source .corpus-candidates/reviewed-edition
bun run pages:seed
bun run pages:export
bun run pages:validate
```

Promotion rejects overlapping candidate/active/seed roots and protected source,
configuration and Git directories. Failure restores earlier committed batches;
cancellation cleanup uses its own 60 s deadline. An interrupted process retains a
journal for the next promotion to recover before accepting new data. Provider access,
legal sufficiency and complete all-page currentness remain separate evidence.
