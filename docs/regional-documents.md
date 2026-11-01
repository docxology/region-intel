# Public document collections

For regions whose official code provider is unavailable or unsupported, a public PDF collection is an independent evidence plane. Set civic `code` to `null`, omit `ecode360` capability, and declare root `documents.json` with schema `regional-documents/v1` and a nonempty `documents` array. Each row has `id`, `sourceId`, `title`, `url`, `statedEdition`, `rights`; source ID and URL must match the deployment catalog. No eCode identity is fabricated.

Run `bun run region documents:acquire`, then `documents:check`. Acquisition bounds each PDF to 16 MB and the collection to 64 MB, extracts every physical page with Poppler, records source time, stated edition, PDF hashes and text, and transactionally promotes a complete collection. Failed stages are retained. Install `pdftotext` (Poppler) for acquisition, replay, Pages and native manuscripts.

The retained seed lives at `pages-data/documents/` by default. Every read rehashes the original PDF and replays extraction; altered text, wrong profiles, sources, page membership or PDF bytes fail. Document counts mean physical PDF pages and nonempty extracted lines, including front matter and empty pages. They are never legal article or section counts. Search links to original PDF page fragments; images, reading order and tables require original inspection. A stated edition is not a current-law certification.

Pages, manuscript evidence and exact Git publication checks consume the same retained collection. The manuscript profile includes explicit unit labels; CSV and figures use PDF pages and extracted lines. Native rendering still requires the pinned `docxology/template` API and a separate review. Existing eCode consumers retain their accepted corpus path.

Retained failure staging is a distinct sibling under the configured seed root, as required by transactional publication. Add `**/.documents-build-*/` to the consumer ignore rules; inspect and preserve diagnostics separately from public input membership.

## Explicit recorded captures

`documents:acquire` never silently falls back after an HTTP error. A separately recorded public download may be imported with `bun run region documents:import --source output/document-capture`. The capture directory must be a child of the isolated output root, with only `capture.json` and one `<id>.pdf` per configured document. Metadata schema `recorded-public-capture/v1` has `profileId` and ordered `documents` rows containing exactly `id`, `sourceId`, `url`, `retrievedAt`, `transport` (`curl`, `browser-download` or `bounded-http`), `httpStatus` (200), `pdfSha256`, `pdfBytes`. IDs, URL, roster and bytes must match; provenance is operator-recorded and does not independently prove a network observation. Preserve the actual transport command/response evidence separately. Do not import a failed or access-controlled capture, and never put credentials, cookies or raw request headers in metadata.

Import and live acquisition share extraction, bounds, the publication lock, transaction and descriptor-change check. The original captured clock survives import. Pages publishes the retained PDFs and search uses those exact bytes, with upstream locations separately recorded. Binary members use the same complete-member and hash replay as native assets.
