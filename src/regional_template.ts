/** Explicit pinned template dependency; no direct-Pandoc fallback. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedChild } from "./shared/subprocess.js";
import { publicationHash } from "./publication_bundle.js";
import assets from "./regional_template_assets.json";
import type { Config } from "./regional_manuscript_inputs.js";
export const TEMPLATE_REVISION = assets.revision;
export const TEMPLATE_RENDERER_SHA256 = assets.rendererModuleSha256;
export const templateAssets = assets.assets;
const directory = fileURLToPath(new URL(".", import.meta.url));
export async function rendererFingerprint(): Promise<string> {
    const files = ["regional_manuscript.ts", "regional_manuscript_inputs.ts", "regional_manuscript_projection.ts", "regional_manuscript_members.ts", "regional_corpus_profile.ts", "regional_documents.ts", "regional_template.ts", "regional_template.py", "regional_figures.py", "regional_template_assets.json"];
    const hashes: Record<string, string> = {};
    for (const name of files)
        hashes[name] = publicationHash(await readFile(join(directory, name)));
    return publicationHash(JSON.stringify(hashes));
}
export async function renderTemplate(stage: string, config: Config, variables: Record<string, string>): Promise<Record<string, string>> {
    const python = process.env.REGION_TEMPLATE_PYTHON, root = process.env.REGION_TEMPLATE_ROOT;
    if (!python || !root)
        throw new Error("Manuscript tool failed: set REGION_TEMPLATE_ROOT and REGION_TEMPLATE_PYTHON for pinned docxology/template");
    async function run(args: string[]): Promise<string> {
        const result = await runBoundedChild(args, { cwd: stage, timeoutMs: 600000, maxBytes: 4000000 });
        if (result.status !== "ok" || !result.reaped)
            throw new Error("Manuscript tool failed: " + args[0] + " (" + result.status + ", exit " + result.exitCode + ")\n" + result.stderr);
        return result.stdout + result.stderr;
    }
    await Bun.write(join(stage, "template-request.json"), JSON.stringify({ config, variables, repository: assets.repository, revision: TEMPLATE_REVISION }));
    // The adapter verifies the real checkout and imported module before using its API.
    await run([python, "-B", join(directory, "regional_template.py"), stage, root]);
    const native = JSON.parse(await readFile(join(stage, "template-render.json"), "utf8")) as {
        tools: Record<string, string>;
    };
    const tools = native.tools;
    for (const tool of ["pandoc", "xelatex", "qpdf", "pandoc-crossref"])
        tools[tool] = (await run([tool, "--version"])).split("\n").slice(0, 2).join("\n");
    tools.pdftotext = (await run(["pdftotext", "-v"])).split("\n")[0]!;
    await run(["qpdf", "--check", "manuscript.pdf"]);
    await run(["pdftotext", "-layout", "manuscript.pdf", "manuscript.txt"]);
    const text = await readFile(join(stage, "manuscript.txt"), "utf8");
    if (!text.replace(/\s+/g, " ").includes(config.title) || /\{\{[A-Z_]+\}\}|\?\?|\[@/.test(text))
        throw new Error("Template rendering has unresolved content or missing title");
    return tools;
}
