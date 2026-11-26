import { deepStrictEqual } from "node:assert";
import { copyFile, mkdir } from "node:fs/promises";
import { profileCorpus, profileCsv } from "../../src/regional_corpus_profile.ts";

const corpus = await Bun.file("docs/examples/synthetic-corpus.json").json();
const profile = profileCorpus(corpus);
deepStrictEqual(profile.articles.map(article => article.sections), [2, 0, 2]);
deepStrictEqual(
    [profile.totalArticles, profile.totalSections, profile.minSections, profile.medianSections, profile.maxSections, profile.emptyArticles],
    [3, 4, 0, 2, 2, 1],
);

await mkdir("output/offline-corpus", { recursive: true });
await Bun.write("output/offline-corpus/corpus-profile.json", JSON.stringify(profile, null, 2) + "\n");
await Bun.write("output/offline-corpus/article-sections.csv", profileCsv(profile));

await mkdir("output/figures", { recursive: true });
await copyFile("docs/assets/method-architecture.png", "output/figures/method-architecture.png");
const label = "fig:method-architecture";
const registry = {
    [label]: {
        label,
        filename: "method-architecture.png",
        caption: "Conceptual architecture of regional evidence, template rendering, and publication review.",
        generated_by: "docs/assets/method-architecture.png",
        metadata: {
            alt_text: "Regional evidence and authored sources pass through shared methods and a pinned external template into a separately reviewed publication packet.",
        },
    },
};
await Bun.write("output/figures/figure_registry.json", JSON.stringify(registry, null, 2) + "\n");
console.log("Synthetic fixture verified: 3 articles, 4 section records, 1 empty article.");
