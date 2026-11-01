/** Public PDF collections are a separate evidence plane from municipal-code scraping. */
import { join } from "node:path";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { LoadedDeployment } from "./deployment.js";
import { deploymentPath } from "./deployment.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import { publicationHash, promotePublicationDirectory } from "./publication_bundle.js";
import { boundedHttpFetch } from "./shared/transport.js";
import { runBoundedChild } from "./shared/subprocess.js";
import { withFileLease } from "./shared/storage.js";
import { profileCorpus, type CorpusProfile } from "./regional_corpus_profile.js";
type Document = {
    id: string;
    sourceId: string;
    title: string;
    url: string;
    statedEdition: string;
    rights: string;
};
type Page = {
    page: number;
    text: string;
    sha256: string;
    nonemptyLines: number;
};
type Receipt = {
    schemaVersion: "regional-document-input/v1";
    profileId: string;
    acquiredAt: string;
    documents: Array<Document & {
        pdfSha256: string;
        pdfBytes: number;
        pages: Page[];
        extractor: string;
    }>;
};
const decode = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);
function keys(v: unknown, expected: string[]): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("|") === expected.sort().join("|"); }
function label(v: unknown, max = 1000): v is string { return typeof v === "string" && v.trim() === v && !!v && v.length <= max && !/[\x00-\x1f\x7f]/.test(v); }
function assertDocumentRoots(d: LoadedDeployment): void {
    const protectedNames = [".git", ".github", ".pages", "node_modules", ".venv", "src", "scripts", "tests", "docs", "manuscript", "config", "configs", "review"];
    const protectedPaths = protectedNames.map(name => deploymentPath(d.root, name));
    for (const file of [d.config.civicProfile, d.config.regionConfig, "documents.json", "region.json"]) {
        const path = deploymentPath(d.root, file);
        protectedPaths.push(path);
        const slash = path.lastIndexOf("/");
        if (path.slice(0, slash) !== d.root)
            protectedPaths.push(path.slice(0, slash));
    }
    for (const root of [d.output, d.seed])
        if (protectedPaths.some(path => root === path || root.startsWith(path + "/") || path.startsWith(root + "/")))
            throw new Error("Document evidence root overlaps protected repository content");
}
export async function documentConfiguration(d: LoadedDeployment): Promise<Document[] | null> {
    assertDocumentRoots(d);
    let raw: unknown;
    try {
        raw = JSON.parse(decode(await captureArtifactBytes(deploymentPath(d.root, "documents.json"), 65536)));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
            return null;
        throw e;
    }
    if (!keys(raw, ["schemaVersion", "documents"]) || raw.schemaVersion !== "regional-documents/v1" || !Array.isArray(raw.documents) || !raw.documents.length || raw.documents.length > 8)
        throw new Error("Invalid document configuration");
    const ids = new Set<string>();
    for (const row of raw.documents) {
        if (!keys(row, ["id", "sourceId", "title", "url", "statedEdition", "rights"]) || !label(row.id, 63) || !/^[a-z][a-z0-9-]*$/.test(row.id) || ids.has(row.id) || ![row.title, row.statedEdition, row.rights].every(v => label(v)) || !d.config.sources.some(s => s.id === row.sourceId && s.url === row.url))
            throw new Error("Document identity must match a configured public source");
        ids.add(row.id);
    }
    return raw.documents as Document[];
}
/** Poppler extracts every physical PDF page, including empty pages. No section semantics inferred. */
export async function extractDocument(bytes: Uint8Array): Promise<{
    pages: Page[];
    extractor: string;
}> {
    if (bytes.byteLength > 16000000 || !Buffer.from(bytes).subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("Expected bounded PDF bytes");
    const stage = await mkdtemp(join(tmpdir(), "regional-pdf-"));
    try {
        await Bun.write(join(stage, "source.pdf"), bytes);
        const version = await runBoundedChild(["pdftotext", "-v"], { cwd: stage, timeoutMs: 15000, maxBytes: 4096 });
        const result = await runBoundedChild(["pdftotext", "-layout", "-enc", "UTF-8", "source.pdf", "pages.txt"], { cwd: stage, timeoutMs: 60000, maxBytes: 65536 });
        if (version.status !== "ok" || !version.reaped || result.status !== "ok" || !result.reaped)
            throw new Error("PDF extraction failed: " + result.stderr);
        const text = decode(await captureArtifactBytes(join(stage, "pages.txt"), 16000000));
        if (!text.endsWith("\f"))
            throw new Error("PDF extraction lacks terminal page boundary");
        const pages = text.slice(0, -1).split("\f").map((text, index) => ({ page: index + 1, text, sha256: publicationHash(text), nonemptyLines: text.split(/\r?\n/).filter(line => line.trim()).length }));
        if (!pages.length || pages.length > 10000 || !pages.some(page => page.text.trim()))
            throw new Error("PDF has no bounded extractable text");
        return { pages, extractor: (version.stdout + version.stderr).split("\n")[0]! };
    }
    finally {
        await rm(stage, { recursive: true, force: true });
    }
}
/** Transactional capture: failure preserves the previous complete collection. */
export async function acquireDocuments(d: LoadedDeployment): Promise<Receipt> {
    const config = await documentConfiguration(d);
    if (!config)
        throw new Error("No document collection configured");
    await mkdir(d.seed, { recursive: true });
    return withFileLease(join(d.output, "state/documents.lock"), async () => {
        const stage = await mkdtemp(join(d.seed, ".documents-build-"));
        const receipt: Receipt = { schemaVersion: "regional-document-input/v1", profileId: d.profile.id, acquiredAt: new Date().toISOString(), documents: [] };
        let total = 0;
        for (const doc of config) {
            const response = await boundedHttpFetch(doc.url, { timeoutMs: 60000, maxBytes: 16000000 });
            if (!response.ok)
                throw new Error(`Document ${doc.id}: HTTP ${response.status}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            total += bytes.length;
            if (total > 64000000)
                throw new Error("Document collection exceeds aggregate bound");
            const extracted = await extractDocument(bytes);
            await Bun.write(join(stage, doc.id + ".pdf"), bytes);
            receipt.documents.push({ ...doc, pdfSha256: publicationHash(bytes), pdfBytes: bytes.length, ...extracted });
        }
        if (receipt.documents.reduce((n, doc) => n + doc.pages.length, 0) > 10000)
            throw new Error("Document collection exceeds page bound");
        if (JSON.stringify(await documentConfiguration(d)) !== JSON.stringify(config))
            throw new Error("Document configuration changed during acquisition");
        await Bun.write(join(stage, "input.json"), JSON.stringify(receipt, null, 2) + "\n");
        await promotePublicationDirectory(stage, join(d.seed, "documents"));
        return receipt;
    }, { staleMs: 0 });
}
export async function readDocuments(d: LoadedDeployment): Promise<{
    receipt: Receipt;
    files: Record<string, Uint8Array>;
    profile: CorpusProfile;
    editionId: string;
}> {
    const config = await documentConfiguration(d);
    if (!config)
        throw new Error("No document collection configured");
    const inputPath = d.config.seedDir + "/documents/input.json", raw = await captureArtifactBytes(deploymentPath(d.root, inputPath), 16000000), r = JSON.parse(decode(raw)) as Receipt;
    if (!keys(r, ["schemaVersion", "profileId", "acquiredAt", "documents"]) || r.schemaVersion !== "regional-document-input/v1" || r.profileId !== d.profile.id || typeof r.acquiredAt !== "string" || !Number.isFinite(Date.parse(r.acquiredAt)) || !Array.isArray(r.documents) || r.documents.length !== config.length)
        throw new Error("Document receipt identity differs");
    const files: Record<string, Uint8Array> = { "documents.json": await captureArtifactBytes(deploymentPath(d.root, "documents.json"), 65536), [inputPath]: raw };
    const members = await readdir(deploymentPath(d.root, d.config.seedDir + "/documents"), { withFileTypes: true }), expectedNames = ["input.json", ...config.map(x => x.id + ".pdf")];
    if (members.length !== expectedNames.length || members.some(x => !x.isFile() || x.isSymbolicLink() || !expectedNames.includes(x.name)))
        throw new Error("Unexpected document collection member");
    let total = 0;
    const articles: Array<{
        guid: string;
        number: string;
        title: string;
        sections: unknown[];
    }> = [];
    for (let i = 0; i < config.length; i++) {
        const doc = r.documents[i]!, expected = config[i]!;
        if (!keys(doc, [...Object.keys(expected), "pdfSha256", "pdfBytes", "pages", "extractor"]) || Object.entries(expected).some(([k, v]) => doc[k as keyof Document] !== v) || !label(doc.extractor) || !/^[a-f0-9]{64}$/.test(doc.pdfSha256))
            throw new Error("Document source binding differs");
        const path = d.config.seedDir + "/documents/" + expected.id + ".pdf", bytes = await captureArtifactBytes(deploymentPath(d.root, path), 16000000);
        total += bytes.length;
        if (total > 64000000)
            throw new Error("Document collection exceeds aggregate bound");
        if (bytes.length !== doc.pdfBytes || publicationHash(bytes) !== doc.pdfSha256)
            throw new Error("Document PDF bytes differ");
        const extracted = await extractDocument(bytes);
        if (JSON.stringify(extracted.pages) !== JSON.stringify(doc.pages))
            throw new Error("Document extraction replay differs");
        files[path] = bytes;
        for (const page of extracted.pages)
            articles.push({ guid: expected.id + "-" + page.page, number: String(page.page), title: expected.title + " — PDF page " + page.page, sections: Array.from({ length: page.nonemptyLines }, () => null) });
    }
    const profile = profileCorpus({ articles });
    profile.units = { items: "PDF pages", records: "Nonempty extracted lines", identifier: "PDF page number" };
    return { receipt: r, files, profile, editionId: publicationHash(raw) };
}
export async function documentPublication(d: LoadedDeployment) {
    const docs = await readDocuments(d);
    const rows = docs.receipt.documents.flatMap(doc => doc.pages.map(page => ({ id: doc.id + "-" + page.page, title: doc.title + " — PDF page " + page.page, url: doc.url + "#page=" + page.page, text: page.text })));
    return { files: { "documents.json": JSON.stringify(docs.receipt, null, 2), "document-search.json": JSON.stringify(rows) }, summary: { articleCount: docs.profile.totalArticles, sectionCount: docs.profile.totalSections, verifiedAt: docs.receipt.acquiredAt, editionId: docs.editionId, kind: "documents" as const } };
}
