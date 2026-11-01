import type { Input } from "./regional_manuscript_inputs.js";
import { profileCsv } from "./regional_corpus_profile.js";
import { TEMPLATE_REVISION } from "./regional_template.js";
export function project(input: Input): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [name, text] of Object.entries(input.sources))
        if (/^\d{2}_.*\.md$/.test(name))
            files[name] = text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_all, key: string) => {
                if (!Object.hasOwn(input.variables, key))
                    throw new Error("Unknown regional manuscript token");
                return input.variables[key]!;
            });
    files["references.bib"] = input.sources["references.bib"]!;
    files["claim_ledger.json"] = input.sources["claim_ledger.json"]!;
    files["evidence.json"] = JSON.stringify(input.evidence, null, 2) + "\n";
    const preamble = [
        "\\usepackage[a4paper,margin=25mm]{geometry}",
        "\\usepackage[fontsize=11pt]{scrextend}",
        "\\usepackage{fontspec}",
        "\\usepackage{unicode-math}",
        "\\setmainfont{texgyrepagella-regular.otf}[BoldFont=texgyrepagella-bold.otf,ItalicFont=texgyrepagella-italic.otf,BoldItalicFont=texgyrepagella-bolditalic.otf]",
        "\\setsansfont{texgyreheros-regular.otf}[BoldFont=texgyreheros-bold.otf,ItalicFont=texgyreheros-italic.otf,BoldItalicFont=texgyreheros-bolditalic.otf]",
        "\\setmonofont{lmmono10-regular.otf}",
        "\\setmathfont{latinmodern-math.otf}",
        "\\usepackage{graphicx}",
        "\\usepackage{listings}",
        "\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,columns=fullflexible}",
        "\\newtheorem{theorem}{Theorem}[section]",
        "\\newtheorem{remark}[theorem]{Remark}",
        "\\newtheorem{example}[theorem]{Example}"
    ].join("\n");
    const fence = "```";
    files["preamble.md"] = fence + "latex\n" + preamble + "\n" + fence + "\n";
    files["manuscript.html"] = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=web/index.html"><title>Regional manuscript</title></head><body><p><a href="web/index.html">Open the complete HTML manuscript</a>. Keep the complete packet for offline reading.</p></body></html>\n';
    files["corpus-profile.json"] = JSON.stringify(input.corpusProfile, null, 2) + "\n";
    files[input.corpusProfile.units ? "page-lines.csv" : "article-sections.csv"] = profileCsv(input.corpusProfile);
    files["template-request.json"] = JSON.stringify({ config: input.config, variables: input.variables, repository: "https://github.com/docxology/template", revision: TEMPLATE_REVISION });
    files["graphical_abstract.md"] = "# Graphical abstract\n\n![Shared methods connect regional identity, an accepted source snapshot and authored prose to pinned template rendering and a separately reviewed packet. This is an architecture diagram, not a measured civic outcome.](../output/figures/architecture.png){#fig:graphical_abstract}\n";
    files["metadata.yaml"] = Bun.YAML.stringify({ title: input.config.title, author: input.config.authors, date: input.variables.VERIFIED_AT!.slice(0, 10), subtitle: `Version ${input.config.version} — review draft; not a published release`, lang: "en", fontsize: "11pt", papersize: "a4", geometry: "margin=25mm", colorlinks: true });
    files["manuscript.md"] = Object.keys(files).filter(n => /^\d{2}_/.test(n)).map(n => files[n]).join("\n\n");
    return files;
}
