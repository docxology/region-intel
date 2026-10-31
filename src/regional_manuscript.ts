/** Consumer-owned scholarly sources, accepted-seed evidence and native review editions. */
import { readFile, readdir, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { LoadedDeployment } from "./deployment.js";
import { deploymentPath } from "./deployment.js";
import { withCivicProfile } from "./civic_profile.js";
import { withOutputRoot } from "./shared/paths.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import { readPublicationBundle, publicationCoreFiles, PUBLICATION_OPTIONAL_FILES, publicationHash, promotePublicationDirectory } from "./publication_bundle.js";
import { validateManuscript } from "./manuscript_document.js";
import { runBoundedChild } from "./shared/subprocess.js";
import { withFileLease } from "./shared/storage.js";
const SOURCE = "docs/manuscript";
const TOKENS = new Set(["REGION_NAME", "PROFILE_ID", "MUNICIPALITY_CODE", "CODE_ARTICLES", "CODE_SECTIONS", "SOURCE_COUNT", "MONITOR_COUNT", "VERIFIED_AT", "EDITION_ID", "CORE_PIN", "EVIDENCE_FINGERPRINT"]);
type Config = {
    schemaVersion: string;
    title: string;
    version: string;
    status: string;
    authors: string[];
};
type Input = {
    config: Config;
    sources: Record<string, string>;
    variables: Record<string, string>;
    fingerprint: string;
    evidence: Record<string, unknown>;
};
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const output = (d: LoadedDeployment) => deploymentPath(d.root, d.config.outputDir + "/manuscript-review");
async function bounded(d: LoadedDeployment, path: string, limit = 2000000): Promise<string> {
    return decode(await captureArtifactBytes(deploymentPath(d.root, path), limit));
}
/** Capture public inputs; never substitute live output or the Crescent reference study. */
async function inputs(d: LoadedDeployment): Promise<Input> {
    const raw = await bounded(d, SOURCE + "/config.json", 65536), config = JSON.parse(raw) as Config;
    if (!config || Object.keys(config).sort().join() !== ["schemaVersion", "title", "version", "status", "authors"].sort().join() || config.schemaVersion !== "regional-manuscript/v1" || config.status !== "review-draft" || (typeof config.version !== "string" || config.version.length > 32 || !/^\d+\.\d+\.\d+$/.test(config.version)) || typeof config.title !== "string" || !config.title.trim() || config.title.length > 200 || !Array.isArray(config.authors) || config.authors.length < 1 || config.authors.length > 10 || [config.title, ...config.authors].some(v => typeof v !== "string" || !v.trim() || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)))
        throw new Error("Invalid regional manuscript configuration");
    const entries = await readdir(deploymentPath(d.root, SOURCE), { withFileTypes: true });
    if (entries.some(e => !e.isFile()))
        throw new Error("Manuscript sources must be regular files");
    const names = entries.map(e => e.name).filter(n => /^\d{2}_.*\.md$/.test(n)).sort();
    if (names.length !== 10)
        throw new Error("Regional manuscript requires ten numbered sections");
    const sources: Record<string, string> = { "config.json": raw };
    for (const name of [...names, "references.bib", "claim_ledger.json"])
        sources[name] = await bounded(d, SOURCE + "/" + name);
    const errors = await validateManuscript({ root: d.root, variableNames: TOKENS });
    if (errors.length)
        throw new Error(errors.join("\n"));
    if (!names.some(n => sources[n].includes("{{CODE_ARTICLES}}")) || !names.some(n => sources[n].includes("{{CODE_SECTIONS}}")))
        throw new Error("Regional results must bind corpus counts through evidence tokens");
    // Parse a private exact-byte snapshot. Never re-open untrusted seed members
    // through the compatibility bundle reader's ordinary readFile path.
    const bundle = await withCivicProfile(d.profile, async () => {
        const captured: Record<string, Uint8Array> = {};
        for (const name of [...publicationCoreFiles(), ...PUBLICATION_OPTIONAL_FILES]) {
            try {
                captured[name] = await captureArtifactBytes(deploymentPath(d.root, d.config.seedDir + "/" + name), 16_000_000);
            } catch (error) {
                if (!PUBLICATION_OPTIONAL_FILES.includes(name as typeof PUBLICATION_OPTIONAL_FILES[number]) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        const snapshot = await mkdtemp(join(tmpdir(), "regional-manuscript-input-"));
        try {
            for (const [name, bytes] of Object.entries(captured)) await Bun.write(join(snapshot, name), bytes);
            return await withOutputRoot(d.seed, () => readPublicationBundle(snapshot));
        } finally { await rm(snapshot, { recursive: true, force: true }); }
    });
    const report = JSON.parse(bundle.bytes["verification-report.json"]!);
    if (report.schemaVersion !== "corpus-verification/v2" || report.publicationEligible !== true || report.overallStatus !== "pass" || ["local", "currentToc", "sample"].some(p => report.planes?.[p] !== "pass"))
        throw new Error("Regional manuscript requires complete accepted v2 seed verification");
    const code = JSON.parse(bundle.bytes[d.profile.corpusSlug + ".json"]!);
    const articles = code.articles.length, sections = code.articles.reduce((n: number, a: {
        sections: unknown[];
    }) => n + a.sections.length, 0);
    if (articles !== report.totalArticles || sections !== report.totalExpectedSections || sections !== report.totalFoundSections)
        throw new Error("Manuscript corpus denominator mismatch");
    const files: Record<string, {
        sha256: string;
        bytes: number;
    }> = {};
    for (const [name, text] of Object.entries(bundle.bytes))
        files[d.config.seedDir + "/" + name] = { sha256: publicationHash(text), bytes: Buffer.byteLength(text) };
    for (const path of ["region.json", d.config.civicProfile, d.config.regionConfig, "package.json", "bun.lock", d.config.seedDir + "/publication-input.json"]) {
        const text = await bounded(d, path, 16000000);
        files[path] = { sha256: publicationHash(text), bytes: Buffer.byteLength(text) };
    }
    for (const [name, text] of Object.entries(sources))
        files[SOURCE + "/" + name] = { sha256: publicationHash(text), bytes: Buffer.byteLength(text) };
    const retained = JSON.parse(await bounded(d, d.config.seedDir + "/publication-input.json"));
    if (retained.editionId !== bundle.receipt.editionId)
        throw new Error("Seed publication receipt edition differs");
    for (const [name, record] of Object.entries(bundle.receipt.files))
        if (retained.files?.[name]?.sha256 !== record.sha256 || retained.files?.[name]?.bytes !== record.bytes)
            throw new Error("Seed publication receipt bytes differ");
    const pkg = JSON.parse(await bounded(d, "package.json"));
    const pin = pkg.dependencies?.["region-intel"];
    if (typeof pin !== "string" || !/^github:docxology\/region-intel#[a-f0-9]{40}$/.test(pin))
        throw new Error("Manuscript requires an immutable public core pin");
    const ledger = JSON.parse(sources["claim_ledger.json"]!);
    for (const claim of ledger.claims)
        if (!claim.evidence.length || claim.evidence.some((p: unknown) => typeof p !== "string" || !Object.hasOwn(files, p)))
            throw new Error("Claim evidence must name captured public input files");
    const rendererSha256 = publicationHash(await readFile(fileURLToPath(import.meta.url)));
    const selectedConfiguration = { deployment: d.config, profile: d.profile, policy: d.policy };
    const fingerprint = publicationHash(JSON.stringify({ selectedConfiguration, files, rendererSha256 }));
    const variables = { REGION_NAME: d.profile.name, PROFILE_ID: d.profile.id, MUNICIPALITY_CODE: d.profile.code!.municipalityCode, CODE_ARTICLES: String(articles), CODE_SECTIONS: String(sections), SOURCE_COUNT: String(d.config.sources.length), MONITOR_COUNT: String(d.config.enabledMonitors.length), VERIFIED_AT: bundle.receipt.sourceVerifiedAt!, EDITION_ID: bundle.receipt.editionId, CORE_PIN: pin.split("#")[1]!, EVIDENCE_FINGERPRINT: fingerprint };
    return { config, sources, variables, fingerprint, evidence: { selectedConfiguration, schemaVersion: "regional-manuscript-evidence/v1", profileId: d.profile.id, editionId: bundle.receipt.editionId, variables, files, rendererSha256, inputFingerprint: fingerprint, limitations: ["Recorded accepted seed; no new upstream acquisition", "Live TOC and sample do not establish all-page currentness", "No legal, civic-impact, model-factuality or release acceptance implied"] } };
}
function project(input: Input): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [name, text] of Object.entries(input.sources))
        if (/^\d{2}_.*\.md$/.test(name))
            files[name] = text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_all, key: string) => { if (!Object.hasOwn(input.variables, key))
                throw new Error("Unknown regional manuscript token"); return input.variables[key]!; });
    files["references.bib"] = input.sources["references.bib"]!;
    files["claim_ledger.json"] = input.sources["claim_ledger.json"]!;
    files["evidence.json"] = JSON.stringify(input.evidence, null, 2) + "\n";
    files["metadata.yaml"] = Bun.YAML.stringify({ title: input.config.title, author: input.config.authors, date: input.variables.VERIFIED_AT!.slice(0, 10), subtitle: `Version ${input.config.version} — review draft; not a published release`, lang: "en", fontsize: "11pt", papersize: "a4", geometry: "margin=25mm", colorlinks: true });
    files["manuscript.md"] = Object.keys(files).filter(n => /^\d{2}_/.test(n)).map(n => files[n]).join("\n\n");
    return files;
}
export async function checkRegionalManuscript(d: LoadedDeployment): Promise<{
    inputFingerprint: string;
    variables: Record<string, string>;
}> { const input = await inputs(d); return { inputFingerprint: input.fingerprint, variables: input.variables }; }
/** A failed renderer never replaces a previously complete review edition. */
export async function buildRegionalManuscript(d: LoadedDeployment, render = false): Promise<string> {
    const destination = output(d);
    await mkdir(dirname(destination), { recursive: true });
    return withFileLease(join(d.output, "state/regional-manuscript.lock"), async () => {
        const input = await inputs(d), files = project(input), stage = await mkdtemp(join(dirname(destination), ".manuscript-review-build-"));
        try {
            for (const [name, text] of Object.entries(files))
                await Bun.write(join(stage, name), text);
            const tools: Record<string, string> = {};
            async function run(args: string[]): Promise<string> { const result = await runBoundedChild(args, { cwd: stage, timeoutMs: 180000, maxBytes: 2000000 }); if (result.status !== "ok" || !result.reaped)
                throw new Error(`Manuscript tool failed: ${args[0]} (${result.status}, exit ${result.exitCode})\n${result.stderr}`); return result.stdout + result.stderr; }
            if (render) {
                for (const tool of ["pandoc", "xelatex", "qpdf"])
                    tools[tool] = (await run([tool, "--version"])).split("\n").slice(0, 2).join("\n");
                tools.pdftotext = (await run(["pdftotext", "-v"])).split("\n")[0]!;
                const args = ["pandoc", "manuscript.md", "--from=markdown-raw_tex-raw_html", "--standalone", "--citeproc", "--bibliography=references.bib", "--metadata-file=metadata.yaml", "--fail-if-warnings", "--resource-path=."];
                await run([...args, "--to=html5", "--embed-resources", "--output=manuscript.html"]);
                await run([...args, "--pdf-engine=xelatex", "--pdf-engine-opt=-no-shell-escape", "--output=manuscript.pdf"]);
                await run(["qpdf", "--check", "manuscript.pdf"]);
                await run(["pdftotext", "-layout", "manuscript.pdf", "manuscript.txt"]);
                const pdfText = await readFile(join(stage, "manuscript.txt"), "utf8"), html = await readFile(join(stage, "manuscript.html"), "utf8");
                if (!pdfText.replace(/\s+/g, " ").includes(input.config.title) || !html.includes(input.config.title) || /\{\{[A-Z_]+\}\}|\?\?|\[@/.test(pdfText + html))
                    throw new Error("Native rendering has unresolved content or missing title");
            }
            if ((await inputs(d)).fingerprint !== input.fingerprint)
                throw new Error("Manuscript inputs changed during build");
            const hashes: Record<string, string> = {};
            for (const name of (await readdir(stage)).sort())
                hashes[name] = publicationHash(await readFile(join(stage, name)));
            await Bun.write(join(stage, "review-receipt.json"), JSON.stringify({ schemaVersion: "regional-manuscript-review/v1", inputFingerprint: input.fingerprint, profileId: d.profile.id, version: input.config.version, status: "review-draft", rendered: render, tools, files: hashes, independentReview: "not-established-by-renderer", publication: "not-authorized-by-this-receipt" }, null, 2) + "\n");
            await promotePublicationDirectory(stage, destination);
            return destination;
        }
        catch (error) {
            throw new Error(`Regional manuscript build failed; diagnostic staging retained at ${stage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }, { staleMs: 0 });
}
export async function validateRegionalRender(d: LoadedDeployment, directoryRelative?: string): Promise<void> {
    const input = await inputs(d), root = directoryRelative ? deploymentPath(d.root, directoryRelative === "bundle" ? `review/${input.config.version}-draft` : directoryRelative) : output(d), receipt = JSON.parse(decode(await captureArtifactBytes(join(root, "review-receipt.json"), 65536))), expected = project(input);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
        Object.keys(receipt).sort().join() !== ["schemaVersion","inputFingerprint","profileId","version","status","rendered","tools","files","independentReview","publication"].sort().join() ||
        receipt.schemaVersion !== "regional-manuscript-review/v1" || receipt.inputFingerprint !== input.fingerprint ||
        receipt.profileId !== d.profile.id || receipt.rendered !== true || receipt.version !== input.config.version ||
        receipt.status !== "review-draft" || receipt.independentReview !== "not-established-by-renderer" ||
        receipt.publication !== "not-authorized-by-this-receipt" || !receipt.files || typeof receipt.files !== "object" || Array.isArray(receipt.files) ||
        !receipt.tools || typeof receipt.tools !== "object" || Array.isArray(receipt.tools) ||
        Object.keys(receipt.tools).sort().join() !== ["pandoc","xelatex","qpdf","pdftotext"].sort().join() ||
        Object.values(receipt.tools).some(value => typeof value !== "string" || !value.length || value.length > 2048))
        throw new Error("Rendered review receipt does not match current inputs");
    const required = [...Object.keys(expected), "manuscript.html", "manuscript.pdf", "manuscript.txt"].sort();
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.some(e => !e.isFile()) || entries.map(e => e.name).sort().join() !== [...required, "review-receipt.json"].sort().join() || Object.keys(receipt.files).sort().join() !== required.join())
        throw new Error("Rendered edition member set differs");
    for (const name of required) {
        const bytes = await captureArtifactBytes(join(root, name), 16000000);
        if (publicationHash(bytes) !== receipt.files[name] || name in expected && decode(bytes) !== expected[name])
            throw new Error("Rendered edition bytes differ: " + name);
    }
}
/** Publish a visibly labelled review packet, never a tag, DOI or release. */
export async function packageRegionalManuscript(d: LoadedDeployment): Promise<string> {
    const source = await buildRegionalManuscript(d, true);
    await validateRegionalRender(d);
    const input = await inputs(d), relative = `review/${input.config.version}-draft`, target = deploymentPath(d.root, relative);
    await mkdir(dirname(target), { recursive: true });
    const stage = await mkdtemp(join(dirname(target), ".review-build-"));
    for (const name of await readdir(source))
        await Bun.write(join(stage, name), await captureArtifactBytes(join(source, name), 16000000));
    await validateRegionalRender(d, `review/${stage.split("/").pop()}`);
    await promotePublicationDirectory(stage, target);
    return target;
}
