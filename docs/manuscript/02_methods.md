# Methods {#sec:methods}

## Deployment and provenance

A civic profile declares jurisdiction identity, timezone, corpus namespace, and publication identity. Regional policy supplies provider-specific parameters. A deployment selects those documents and owns its evidence. Admission checks the binding before a regional producer runs. Runtime output ownership prevents an alternate profile from adopting another jurisdiction's retained data.

Provenance distinguishes a source entity, the activity that derived an artifact, and the accountable actor [@lebo2013provo]. In Region Intel the installed package supplies code and shared assets, while the consuming repository supplies policy, selected sources, and accepted inputs. Artifact hashes bind the bytes associated with a particular edition.

![Conceptual architecture of regional evidence, template rendering, and publication review.](../../output/figures/method-architecture.png){#fig:method-architecture}

## Document units

The municipal-code path profiles article and section records. A separate public-PDF path retains exact PDF bytes and records physical pages and extracted text lines. These are different units, and the output keeps those units explicit.

The worked example calls the same `profileCorpus` and `profileCsv` functions used by the regional manuscript input and projection. Profiling validates the aggregate structure, rejects duplicate article identifiers, counts section records, and reports the minimum, median, maximum, and number of empty articles. CSV retains the article identifiers and counts.
