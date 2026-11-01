/** Transactional consumer manuscripts rendered by the pinned docxology/template API. */
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import type { LoadedDeployment } from "./deployment.js";
import { deploymentPath } from "./deployment.js";
import { promotePublicationDirectory } from "./publication_bundle.js";
import { withFileLease } from "./shared/storage.js";
import { inputs } from "./regional_manuscript_inputs.js";
import { project } from "./regional_manuscript_projection.js";
import { renderTemplate, TEMPLATE_REVISION, TEMPLATE_RENDERER_SHA256, templateAssets } from "./regional_template.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import { inventory, validateMembers } from "./regional_manuscript_members.js";
const output = (d: LoadedDeployment) => deploymentPath(d.root, d.config.outputDir + "/manuscript-review");
export async function checkRegionalManuscript(d: LoadedDeployment): Promise<{
    inputFingerprint: string;
    variables: Record<string, string>;
}> {
    const input = await inputs(d);
    return { inputFingerprint: input.fingerprint, variables: input.variables };
}
/** Failed rendering leaves prior editions intact and retains its diagnostic work. */
export async function buildRegionalManuscript(d: LoadedDeployment, render = false): Promise<string> {
    const destination = output(d);
    await mkdir(dirname(destination), { recursive: true });
    return withFileLease(join(d.output, "state/regional-manuscript.lock"), async () => {
        const input = await inputs(d), files = project(input), stage = await mkdtemp(join(dirname(destination), ".manuscript-review-build-"));
        try {
            for (const [name, bytes] of Object.entries({ ...files, ...input.assets })) {
                await mkdir(dirname(join(stage, name)), { recursive: true });
                await Bun.write(join(stage, name), bytes);
            }
            const tools = render ? await renderTemplate(stage, input.config, input.variables) : {};
            if ((await inputs(d)).fingerprint !== input.fingerprint)
                throw new Error("Manuscript inputs changed during build");
            const hashes = await inventory(stage);
            await Bun.write(join(stage, "review-receipt.json"), JSON.stringify({ schemaVersion: "regional-manuscript-review/v2", inputFingerprint: input.fingerprint, profileId: d.profile.id, version: input.config.version, status: "review-draft", rendered: render, template: { repository: "https://github.com/docxology/template", revision: TEMPLATE_REVISION }, tools, files: hashes, independentReview: "not-established-by-renderer", publication: "not-authorized-by-this-receipt" }, null, 2) + "\n");
            if (render)
                await validateRegionalRender(d, relative(d.root, stage));
            await promotePublicationDirectory(stage, destination);
            return destination;
        }
        catch (error) {
            throw new Error("Regional manuscript build failed; diagnostic staging retained at " + stage + ": " + (error instanceof Error ? error.message : String(error)), { cause: error });
        }
    }, { staleMs: 0 });
}
export async function validateRegionalRender(d: LoadedDeployment, directoryRelative?: string): Promise<void> {
    const input = await inputs(d), root = directoryRelative ? deploymentPath(d.root, directoryRelative === "bundle" ? "review/" + input.config.version + "-draft" : directoryRelative) : output(d);
    const receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await captureArtifactBytes(join(root, "review-receipt.json"), 512000)));
    if (!receipt || Object.keys(receipt).sort().join() !== ["schemaVersion", "inputFingerprint", "profileId", "version", "status", "rendered", "template", "tools", "files", "independentReview", "publication"].sort().join() || receipt.schemaVersion !== "regional-manuscript-review/v2" || receipt.inputFingerprint !== input.fingerprint || receipt.profileId !== d.profile.id || receipt.version !== input.config.version || receipt.status !== "review-draft" || receipt.rendered !== true || receipt.independentReview !== "not-established-by-renderer" || receipt.publication !== "not-authorized-by-this-receipt" || JSON.stringify(receipt.template) !== JSON.stringify({ repository: "https://github.com/docxology/template", revision: TEMPLATE_REVISION }) || !receipt.tools || Object.keys(receipt.tools).sort().join() !== ["pandoc", "xelatex", "qpdf", "pdftotext", "template", "python", "matplotlib", "pandoc-crossref"].sort().join() || Object.values(receipt.tools).some(v => typeof v !== "string" || !v.length || v.length > 2048))
        throw new Error("Rendered review receipt does not match current inputs");
    const projectedAssets = { ...input.assets, ...(input.config.cover ? { "web/assets/paper-cover.png": input.assets["figures/cover.png"]! } : {}) };
    const required = [...Object.keys(project(input)), ...Object.keys(projectedAssets), "manuscript.pdf", "manuscript.txt", "web/index.html", "template-render.json", ...Object.keys(templateAssets).map(p => "web/" + p), ...["architecture", "corpus-profile", "evidence-boundaries"].flatMap(n => ["png", "pdf", "svg"].map(ext => "figures/" + n + "." + ext))].sort();
    await validateMembers(root, receipt.files, required, { ...project(input), ...projectedAssets });
    for (const [name, record] of Object.entries(templateAssets))
        if (receipt.files["web/" + name] !== record.sha256)
            throw new Error("Pinned template web asset differs: " + name);
    const native = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await captureArtifactBytes(join(root, "template-render.json"), 65536)));
    if (JSON.stringify(native.api) !== JSON.stringify(["RenderManager.render_combined_pdf", "RenderManager.render_combined_web"]) || JSON.stringify(native.formats) !== JSON.stringify(["pdf", "html"]) || native.offlineAssets !== true || native.rendererModuleSha256 !== TEMPLATE_RENDERER_SHA256 || native.tools?.template !== "docxology/template@" + TEMPLATE_REVISION || receipt.tools.template !== native.tools.template || receipt.tools.python !== native.tools.python || receipt.tools.matplotlib !== native.tools.matplotlib)
        throw new Error("Native template provenance contract differs");
    if (native.repository !== receipt.template.repository || native.revision !== TEMPLATE_REVISION || native.inputFingerprint !== input.fingerprint)
        throw new Error("Template rendering provenance differs");
}
/** Publish a draft packet; no release, tag or DOI is created. */
export async function packageRegionalManuscript(d: LoadedDeployment): Promise<string> {
    const source = await buildRegionalManuscript(d, true);
    await validateRegionalRender(d);
    const input = await inputs(d), target = deploymentPath(d.root, "review/" + input.config.version + "-draft");
    await mkdir(dirname(target), { recursive: true });
    const stage = await mkdtemp(join(dirname(target), ".review-build-"));
    for (const name of Object.keys(await inventory(source))) {
        await mkdir(dirname(join(stage, name)), { recursive: true });
        await Bun.write(join(stage, name), await readFile(join(source, name)));
    }
    await validateRegionalRender(d, "review/" + stage.split("/").pop());
    await promotePublicationDirectory(stage, target);
    return target;
}
