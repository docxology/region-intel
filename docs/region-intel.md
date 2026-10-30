# Repository extraction

The shared implementation now lives in `docxology/region-intel`. Both
`docxology/crescent-city-intel` and `docxology/davis-ca-intel` are consumers of the
same pinned package. See [the deployment contract](deployments.md).

## Ownership

| Shared package | Regional consumer |
| --- | --- |
| Algorithms, provider adapters, transport, custody, schemas | Identity and geography |
| Search, RAG, analytics, API and dashboard methods | Reviewed sources and enabled monitors |
| Tests, release gate, OpenAPI, module documentation | Regional output, public seeds and claim evidence |
| Manuscript validation, hydration and reference manuscript | Local manuscript application and live-acceptance receipts |

The reference implementation retains an explicitly named Crescent compatibility
preset for existing artifact schemas, authored presentation and reproducibility.
It is not enabled by renaming another region. Alternate regions must provide an
independent identity, policy, source catalog and monitor roster.

Package-owned assets resolve relative to the installed package. Consumer output
resolves inside the consumer repository. Neither a core test pass nor a valid
configuration certifies live upstream completeness, legal currency, model
factuality or successful hosted deployment.
