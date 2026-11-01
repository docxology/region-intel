import { join, resolve, relative, dirname } from "node:path";
import { mkdir, lstat } from "node:fs/promises";
import type { LoadedDeployment } from "./deployment.js";
import { deploymentPath } from "./deployment.js";
import { withCivicProfile, bindCivicOutputRoot } from "./civic_profile.js";
import { createRunScope, withRunSignal } from "./shared/run_scope.js";
import { withOutputRoot } from "./shared/paths.js";
import { withFileLease, assertSafeFilesystemPath } from "./shared/storage.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import { writeJsonAtomic } from "./shared/source_health.js";
import { replaceArtifacts, rollbackArtifactTransaction, recoverArtifactTransactions, type ArtifactReplacement } from "./shared/artifact_transaction.js";
import { readPublicationBundle, publicationCoreFiles, PUBLICATION_OPTIONAL_FILES, stagePublicationSeed, publicationHash, type PublicationBundle } from "./publication_bundle.js";
import { validateArticleCustody, articleSetSha256 } from "./corpus_editions.js";
import { verificationMatchesInputs, type BoundVerificationReport } from "./verify.js";
import { getArticlePages, getSections } from "./toc.js";
import { buildPagesCodeSearchIndex } from "./pages_snapshot.js";
import type { ArticlePage, TocNode } from "./types.js";
const MAX_FILE = 16000000, MAX_TOTAL = 256000000;
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
function scoped<T>(d: LoadedDeployment, task: () => T): T { return withCivicProfile(d.profile, () => withOutputRoot(d.output, task)); }
function overlaps(a: string, b: string): boolean { return a === b || a.startsWith(b + "/") || b.startsWith(a + "/"); }
function corpusDirectory(d: LoadedDeployment, path: string): string {
    const target = deploymentPath(d.root, relative(d.root, resolve(path)));
    const protectedNames = [".git", ".github", "node_modules", ".venv", "src", "scripts", "tests", "docs", "manuscript", "config", "configs"];
    const protectedRoots = protectedNames.map(name => resolve(d.root, name));
    for (const config of [d.config.civicProfile, d.config.regionConfig]) {
        const file = deploymentPath(d.root, config);
        protectedRoots.push(file);
        if (dirname(file) !== resolve(d.root))
            protectedRoots.push(dirname(file));
    }
    if (protectedRoots.some(root => overlaps(target, root)))
        throw new Error("Corpus root overlaps protected repository content");
    return target;
}
function corpusRoots(d: LoadedDeployment): void {
    const output = corpusDirectory(d, d.output), seed = corpusDirectory(d, d.seed);
    if (overlaps(output, seed))
        throw new Error("Output and seed roots overlap");
}
function corpusSource(d: LoadedDeployment, sourceRelative: string): string {
    corpusRoots(d);
    const source = corpusDirectory(d, deploymentPath(d.root, sourceRelative));
    if (overlaps(source, resolve(d.seed)))
        throw new Error("Source and seed roots overlap");
    return source;
}
async function captured(path: string): Promise<Uint8Array> { await assertSafeFilesystemPath(path); return captureArtifactBytes(path, MAX_FILE); }
async function preflight(root: string): Promise<void> { for (const file of [...publicationCoreFiles(), ...PUBLICATION_OPTIONAL_FILES]) {
    try {
        await captured(join(root, file));
    }
    catch (error) {
        if (!PUBLICATION_OPTIONAL_FILES.includes(file as typeof PUBLICATION_OPTIONAL_FILES[number]) || (error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
    }
} }
async function captureCorpus(d: LoadedDeployment, source: string): Promise<{
    bundle: PublicationBundle;
    files: ArtifactReplacement[];
}> {
    await bindCivicOutputRoot(source);
    await preflight(source);
    const bundle = await readPublicationBundle(source);
    const toc = JSON.parse(bundle.bytes["toc.json"]!) as TocNode;
    const manifest = JSON.parse(bundle.bytes["manifest.json"]!);
    if (!manifest.completedAt || !Number.isFinite(Date.parse(manifest.completedAt)))
        throw new Error("Corpus has no valid completion receipt");
    const expected = getArticlePages(toc);
    if (expected.length > 10000)
        throw new Error("Corpus exceeds article bound");
    const files: ArtifactReplacement[] = Object.entries(bundle.bytes).map(([path, text]) => ({ path, text }));
    let total = files.reduce((n, f) => n + ("text" in f ? Buffer.byteLength(f.text) : f.bytes.byteLength), 0);
    const articles: ArticlePage[] = [];
    for (const node of expected) {
        if (!/^[A-Za-z0-9_-]+$/.test(node.guid))
            throw new Error("Unsafe article identity");
        const bytes = await captured(join(source, "articles", node.guid + ".json"));
        total += bytes.byteLength;
        if (total > MAX_TOTAL)
            throw new Error("Corpus exceeds aggregate bound");
        const article = JSON.parse(decode(bytes)) as ArticlePage;
        const errors = validateArticleCustody(article, getSections(node).map(s => s.guid), true);
        if (errors.length)
            throw new Error(`Article ${node.guid} custody failed: ${errors.join("; ")}`);
        const entry = manifest.articles[node.guid];
        if (article.guid !== node.guid || entry.guid !== node.guid || entry.sha256 !== article.sha256 || entry.sectionCount !== article.sections.length)
            throw new Error("Raw article differs from manifest");
        articles.push(article);
        files.push({ path: `articles/${node.guid}.json`, bytes });
    }
    const verification = JSON.parse(bundle.bytes["verification-report.json"]!) as BoundVerificationReport;
    if (verification.schemaVersion !== "corpus-verification/v2" || !await verificationMatchesInputs(verification, source))
        throw new Error("Verification does not match raw corpus inputs");
    if (verification.binding.articleSetSha256 !== articleSetSha256(articles))
        throw new Error("Raw article set differs from verified public edition");
    for (const file of files) {
        const bytes = await captured(join(source, file.path));
        if (publicationHash(bytes) !== publicationHash("text" in file ? file.text : file.bytes))
            throw new Error("Candidate changed during capture");
    }
    return { bundle, files };
}
export async function checkRegionalCorpus(d: LoadedDeployment, sourceRelative = d.config.outputDir): Promise<{
    editionId: string;
    articleCount: number;
    sectionCount: number;
}> {
    return scoped(d, async () => { const source = corpusSource(d, sourceRelative); return withFileLease(join(source, "state/corpus.lock"), async () => { const { bundle } = await captureCorpus(d, source); const code = JSON.parse(bundle.bytes[d.profile.corpusSlug + ".json"]!); return { editionId: bundle.receipt.editionId, articleCount: code.articles.length, sectionCount: code.articles.reduce((n: number, a: ArticlePage) => n + a.sections.length, 0) }; }, { staleMs: 0 }); });
}
interface PromotionJournal {
    schemaVersion: "regional-corpus-promotion/v1";
    profileId: string;
    target: string;
    editionId: string;
    status: "applying" | "committed" | "rolled-back";
    transactions: string[];
}
async function rollback(d: LoadedDeployment, journal: PromotionJournal, path: string): Promise<void> {
    // Recovery must outlive cancellation of the producer, while retaining its own deadline.
    const cleanup = createRunScope({ deadlineMs: 60000 });
    try {
        await withRunSignal(cleanup.signal, async () => {
            await recoverArtifactTransactions(d.output);
            for (const id of [...journal.transactions].reverse()) {
                cleanup.signal.throwIfAborted();
                await rollbackArtifactTransaction(d.output, id);
            }
            cleanup.signal.throwIfAborted();
            journal.status = "rolled-back";
            await writeJsonAtomic(path, journal);
        }, cleanup.deadlineAt);
    }
    finally {
        cleanup.dispose();
    }
}
export async function promoteRegionalCorpus(d: LoadedDeployment, sourceRelative: string): Promise<{
    editionId: string;
    transactionCount: number;
}> {
    return scoped(d, async () => {
        const source = corpusSource(d, sourceRelative), target = resolve(d.output);
        if (source === target || source.startsWith(target + "/") || target.startsWith(source + "/"))
            throw new Error("Candidate and active roots must not overlap");
        await mkdir(target, { recursive: true });
        await bindCivicOutputRoot(target);
        const locks = [join(source, "state/corpus.lock"), join(target, "state/corpus.lock")].sort();
        return withFileLease(locks[0]!, () => withFileLease(locks[1]!, async () => {
            const journalPath = join(target, "state/regional-corpus-promotion.json");
            try {
                const prior = JSON.parse(decode(await captured(journalPath))) as PromotionJournal;
                if (prior.schemaVersion !== "regional-corpus-promotion/v1" || prior.profileId !== d.profile.id || prior.target !== target || !Array.isArray(prior.transactions) || prior.transactions.length > 1000 || prior.transactions.some(id => !/^[a-f0-9-]{36}$/.test(id)) || !["applying", "committed", "rolled-back"].includes(prior.status))
                    throw new Error("Invalid regional corpus recovery journal");
                if (prior.status === "applying")
                    await rollback(d, prior, journalPath);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
            }
            const { bundle, files } = await captureCorpus(d, source);
            const journal: PromotionJournal = { schemaVersion: "regional-corpus-promotion/v1", profileId: d.profile.id, target, editionId: bundle.receipt.editionId, status: "applying", transactions: [] };
            await writeJsonAtomic(journalPath, journal);
            const ordered = [...files.filter(f => f.path.startsWith("articles/")), ...files.filter(f => !f.path.startsWith("articles/"))];
            const batches: ArtifactReplacement[][] = [];
            let batch: ArtifactReplacement[] = [], size = 0;
            for (const file of ordered) {
                const length = "text" in file ? Buffer.byteLength(file.text) : file.bytes.byteLength;
                if (length > 16000000)
                    throw new Error("Single corpus artifact exceeds transaction limit");
                if (batch.length && (batch.length >= 80 || size + length > 12000000)) {
                    batches.push(batch);
                    batch = [];
                    size = 0;
                }
                batch.push(file);
                size += length;
            }
            if (batch.length)
                batches.push(batch);
            try {
                for (const replacements of batches)
                    await replaceArtifacts(target, replacements, { onProgress: async (receipt) => { if (!journal.transactions.includes(receipt.id)) {
                            journal.transactions.push(receipt.id);
                            await writeJsonAtomic(journalPath, journal, { signal: null });
                        } } });
                const promoted = await captureCorpus(d, target);
                if (promoted.bundle.receipt.editionId !== bundle.receipt.editionId)
                    throw new Error("Promoted corpus differs from candidate");
                journal.status = "committed";
                await writeJsonAtomic(journalPath, journal);
                return { editionId: journal.editionId, transactionCount: journal.transactions.length };
            }
            catch (error) {
                try {
                    await rollback(d, journal, journalPath);
                }
                catch (recovery) {
                    throw new AggregateError([error, recovery], "Corpus promotion requires recovery");
                }
                throw error;
            }
        }, { staleMs: 0 }), { staleMs: 0 });
    });
}
export async function seedRegionalCorpus(d: LoadedDeployment, sourceRelative = d.config.outputDir): Promise<string[]> {
    return scoped(d, async () => { const source = corpusSource(d, sourceRelative); return withFileLease(join(source, "state/corpus.lock"), async () => { const { bundle } = await captureCorpus(d, source); return stagePublicationSeed(bundle, d.seed); }, { staleMs: 0 }); });
}
export async function regionalCorpusPublication(d: LoadedDeployment): Promise<{
    files: Record<string, string>;
    summary: {
        kind?: "documents";
        articleCount: number;
        sectionCount: number;
        verifiedAt: string | null;
        editionId: string;
    } | null;
}> {
    return scoped(d, async () => {
        corpusRoots(d);
        if (!d.profile.code && await (await import("./regional_documents.js")).documentConfiguration(d)) return (await import("./regional_documents.js")).documentPublication(d);
        let selected: string | null = null;
        for (const root of [d.output, d.seed]) {
            let present = 0;
            for (const file of publicationCoreFiles()) {
                try {
                    await lstat(join(root, file));
                    present++;
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                        throw error;
                }
            }
            if (present) {
                selected = root;
                break;
            }
        }
        if (!selected)
            return { files: {} as Record<string, string>, summary: null };
        await preflight(selected);
        const root = selected;
        const bundle = root === d.output ? await withFileLease(join(root, "state/corpus.lock"), async () => (await captureCorpus(d, root)).bundle, { staleMs: 0 }) : await readPublicationBundle(root);
        if (JSON.parse(bundle.bytes["verification-report.json"]!).schemaVersion !== "corpus-verification/v2")
            throw new Error("Publication requires v2 verification");
        const code = JSON.parse(bundle.bytes[d.profile.corpusSlug + ".json"]!);
        for (const [name, text] of Object.entries(bundle.bytes))
            if (publicationHash(await captured(join(selected, name))) !== publicationHash(text))
                throw new Error("Published corpus changed during capture");
        const index = buildPagesCodeSearchIndex(code);
        return { files: { "code.json": bundle.bytes[d.profile.corpusSlug + ".json"]!, "code-index.json": JSON.stringify(index) }, summary: { articleCount: index.articleCount, sectionCount: index.sectionCount, verifiedAt: bundle.receipt.sourceVerifiedAt ?? null, editionId: bundle.receipt.editionId } };
    });
}
