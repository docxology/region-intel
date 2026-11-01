/** Descriptive structure of one accepted corpus, never a measure of civic burden. */
export type CorpusProfile = {
    schemaVersion: "regional-corpus-profile/v1";
    units?: { items: string; records: string; identifier: string };
    articles: {
        guid: string;
        number: string;
        title: string;
        sections: number;
    }[];
    totalArticles: number;
    totalSections: number;
    minSections: number;
    medianSections: number;
    maxSections: number;
    emptyArticles: number;
};
export function profileCorpus(value: unknown): CorpusProfile {
    const input = value as {
        articles?: unknown[];
    };
    if (!input || !Array.isArray(input.articles) || !input.articles.length || input.articles.length > 10000)
        throw new Error("Invalid corpus profile input");
    const seen = new Set<string>();
    const articles = input.articles.map(raw => {
        const a = raw as {
            guid?: unknown;
            number?: unknown;
            title?: unknown;
            sections?: unknown[];
        };
        if (!a || typeof a.guid !== "string" || !a.guid || seen.has(a.guid) || typeof a.number !== "string" || typeof a.title !== "string" || !Array.isArray(a.sections))
            throw new Error("Invalid or duplicate corpus article");
        seen.add(a.guid);
        return { guid: a.guid, number: a.number, title: a.title, sections: a.sections.length };
    });
    const counts = articles.map(a => a.sections).sort((a, b) => a - b), n = counts.length;
    return { schemaVersion: "regional-corpus-profile/v1", articles, totalArticles: n, totalSections: counts.reduce((a, b) => a + b, 0), minSections: counts[0]!, medianSections: (counts[Math.floor((n - 1) / 2)]! + counts[Math.floor(n / 2)]!) / 2, maxSections: counts[n - 1]!, emptyArticles: counts.filter(n => n === 0).length };
}
export function profileCsv(profile: CorpusProfile): string {
    const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    return (profile.units ? "guid,pdf_page,title,nonempty_extracted_lines\n" : "guid,article_number,title,section_records\n") + profile.articles.map(a => [quote(a.guid), quote(a.number), quote(a.title), a.sections].join(",")).join("\n") + "\n";
}
