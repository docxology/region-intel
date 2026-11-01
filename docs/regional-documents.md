# Public document collections

For regions whose official code provider is unavailable or unsupported, a public PDF collection is an independent evidence plane. Set civic `code` to `null`, omit `ecode360` capability, and declare root `documents.json` with schema `regional-documents/v1` and a nonempty `documents` array. Each row has `id`, `sourceId`, `title`, `url`, `statedEdition`, `rights`; source ID and URL must match the deployment catalog. No eCode identity is fabricated.

Run `bun run region documents:acquire`, then `documents:check`. Acquisition bounds each PDF to 16 MB and the collection to 64 MB, extracts every physical page with Poppler, records source time, stated edition, PDF hashes and text, and transactionally promotes a complete collection. Failed stages are retained. Install `pdftotext` (Poppler) for acquisition, replay, Pages and native manuscripts.

The retained seed lives at `pages-data/documents/` by default. Every read rehashes the original PDF and replays extraction; altered text, wrong profiles, sources, page membership or PDF bytes fail. Document counts mean physical PDF pages and nonempty extracted lines, including front matter and empty pages. They are never legal article or section counts. Search links to original PDF page fragments; images, reading order and tables require original inspection. A stated edition is not a current-law certification.

Pages, manuscript evidence and exact Git publication checks consume the same retained collection. The manuscript profile includes explicit unit labels; CSV and figures use PDF pages and extracted lines. Native rendering still requires the pinned `docxology/template` API and a separate review. Existing eCode consumers retain their accepted corpus path.

Retained failure staging is a distinct sibling under the configured seed root, as required by transactional publication. Add `**/.documents-build-*/` to the consumer ignore rules; inspect and preserve diagnostics separately from public input membership.
