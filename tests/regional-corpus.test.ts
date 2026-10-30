import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from "node:fs/promises";
import { withRunSignal } from "../src/shared/run_scope.ts";
import { withOutputRoot } from "../src/shared/paths.ts";
import { newPage, closeBrowser } from "../src/browser.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultCivicProfile, withCivicProfile, bindCivicOutputRoot } from "../src/civic_profile.ts";
import { DEFAULT_REGION_CONFIG } from "../src/region_config.ts";
import { checkRegionalCorpus, promoteRegionalCorpus, seedRegionalCorpus, regionalCorpusPublication } from "../src/regional_corpus.ts";
import { bindArticleExtraction, custodyHash } from "../src/corpus_editions.ts";
import { buildConsolidatedJson } from "../src/export.ts";
import { writePublicationFixture } from "./helpers/publication-fixture.ts";
import type { LoadedDeployment } from "../src/deployment.ts";
import type { ArticlePage, TocNode } from "../src/types.ts";
async function fixture(root: string, count = 1) {
    const d: LoadedDeployment = { root, profile: defaultCivicProfile, policy: DEFAULT_REGION_CONFIG, output: join(root, "output"), seed: join(root, "seed"), config: { schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "output", seedDir: "seed", enabledMonitors: [], sources: [] } };
    const source = join(root, "candidate");
    await mkdir(source);
    await bindCivicOutputRoot(source);
    const articles: ArticlePage[] = Array.from({ length: count }, (_, i) => { const guid = String(1000 + i), section = String(100000 + i), html = "<p>Permit licensing requirements.</p>", rawHtml = `<div id="${section}_content">${html}</div>`; return bindArticleExtraction({ guid, url: `https://ecode360.com/${guid}`, title: "Permits", number: String(i), rawHtml, sha256: custodyHash(rawHtml), scrapedAt: "2026-10-30T00:00:00Z", sections: [{ guid: section, number: String(i), title: 'License </script><img src=x onerror="globalThis.corpusInjected=true">', html, text: "Permit licensing requirements.", history: "" }] }); });
    await writePublicationFixture(source, "", articles);
    await mkdir(join(source, "articles"));
    for (const article of articles)
        await writeFile(join(source, "articles", article.guid + ".json"), JSON.stringify(article));
    const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
    manifest.completedAt = "2026-10-30T00:00:00Z";
    for (const article of articles)
        manifest.articles[article.guid].guid = article.guid;
    const bytes = JSON.stringify(manifest) + "\n";
    await writeFile(join(source, "manifest.json"), bytes);
    const verification = JSON.parse(await readFile(join(source, "verification-report.json"), "utf8"));
    verification.schemaVersion = "corpus-verification/v2";
    verification.binding.manifestSha256 = custodyHash(bytes);
    await writeFile(join(source, "verification-report.json"), JSON.stringify(verification));
    const toc = JSON.parse(await readFile(join(source, "toc.json"), "utf8")) as TocNode;
    await writeFile(join(source, defaultCivicProfile.corpusSlug + ".json"), JSON.stringify(buildConsolidatedJson(toc, articles)));
    return { d, source, articles };
}
test("complete corpus promotion spans existing bounded batches and preserves other producers", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-corpus-"));
    try {
        const { d } = await fixture(root, 301);
        await mkdir(join(d.output, "news"), { recursive: true });
        await writeFile(join(d.output, "news", "retained.json"), "retained");
        expect((await checkRegionalCorpus(d, "candidate")).articleCount).toBe(301);
        const result = await promoteRegionalCorpus(d, "candidate");
        expect(result.transactionCount).toBeGreaterThan(1);
        expect((await checkRegionalCorpus(d)).sectionCount).toBe(301);
        expect(await readFile(join(d.output, "news", "retained.json"), "utf8")).toBe("retained");
        const prior = JSON.parse(await readFile(join(d.output, "state/regional-corpus-promotion.json"), "utf8"));
        prior.status = "applying";
        await writeFile(join(d.output, "state/regional-corpus-promotion.json"), JSON.stringify(prior));
        await promoteRegionalCorpus(d, "candidate");
        for (const id of prior.transactions)
            expect(JSON.parse(await readFile(join(d.output, "state/artifact-transactions", id, "receipt.json"), "utf8")).status).toBe("rolled-back");
        await seedRegionalCorpus(d);
        const published = await regionalCorpusPublication({ ...d, output: join(root, "empty") });
        expect(published.summary?.articleCount).toBe(301);
        expect(published.files["code.json"]).not.toContain("rawHtml");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
test("invalid candidate and failed later batch never replace the accepted corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-corpus-negative-"));
    try {
        const { d, source, articles } = await fixture(root, 101);
        const articlePath = join(source, "articles", articles[0]!.guid + ".json"), original = await readFile(articlePath, "utf8");
        await writeFile(articlePath, original.replace("Permit licensing requirements.", "Changed text."));
        await expect(promoteRegionalCorpus(d, "candidate")).rejects.toThrow();
        await writeFile(articlePath, original);
        await mkdir(join(d.output, "articles"), { recursive: true });
        const outside = join(root, "outside");
        await writeFile(outside, "preserved");
        await symlink(outside, join(d.output, "articles", articles[90]!.guid + ".json"));
        await expect(promoteRegionalCorpus(d, "candidate")).rejects.toThrow("symlink");
        await expect(access(join(d.output, "articles", articles[0]!.guid + ".json"))).rejects.toThrow();
        expect(await readFile(outside, "utf8")).toBe("preserved");
        const journal = JSON.parse(await readFile(join(d.output, "state/regional-corpus-promotion.json"), "utf8"));
        expect(journal.status).toBe("rolled-back");
        await expect(promoteRegionalCorpus(d, "output/nested")).rejects.toThrow("overlap");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
test("publication refuses partial active data, foreign identity, failed binding and private fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-publication-"));
    try {
        const { d, source } = await fixture(root);
        const candidate = { ...d, output: source };
        expect((await regionalCorpusPublication(candidate)).summary?.sectionCount).toBe(1);
        const codePath = join(source, d.profile.corpusSlug + ".json"), original = await readFile(codePath, "utf8");
        const code = JSON.parse(original);
        code.articles[0].sections[0].text = "Modified public section";
        await writeFile(codePath, JSON.stringify(code));
        await expect(regionalCorpusPublication(candidate)).rejects.toThrow();
        code.articles[0].sections[0].text = JSON.parse(original).articles[0].sections[0].text;
        code.guid = "DA4922";
        await writeFile(codePath, JSON.stringify(code));
        await expect(regionalCorpusPublication(candidate)).rejects.toThrow();
        await expect(regionalCorpusPublication({ ...d, seed: source })).rejects.toThrow();
        await writeFile(codePath, original);
        code.guid = defaultCivicProfile.code!.municipalityCode;
        code.privateDiagnostic = "/private/operator";
        await writeFile(codePath, JSON.stringify(code));
        await expect(regionalCorpusPublication(candidate)).rejects.toThrow();
        await writeFile(codePath, original);
        const report = JSON.parse(await readFile(join(source, "verification-report.json"), "utf8"));
        report.binding.manifestSha256 = "0".repeat(64);
        await writeFile(join(source, "verification-report.json"), JSON.stringify(report));
        await expect(regionalCorpusPublication(candidate)).rejects.toThrow();
        await mkdir(d.output);
        await writeFile(join(d.output, "toc.json"), "{}");
        await expect(regionalCorpusPublication(d)).rejects.toThrow();
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("alternate Pages ships searchable verified code and rejects rehashed replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-pages-corpus-"));
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
        const { source } = await fixture(root);
        const { validateCivicProfile, civicProfileFingerprint } = await import("../src/civic_profile.ts");
        const profile = validateCivicProfile({ ...JSON.parse(await readFile(new URL("../configs/example-civic.json", import.meta.url), "utf8")), code: { provider: "ecode360", municipalityCode: "EX1234" }, capabilities: ["ecode360", "news", "events", "analytics", "geo"] });
        const policy = JSON.parse(await readFile(new URL("../configs/example-region.json", import.meta.url), "utf8"));
        const tocPath = join(source, "toc.json"), toc = JSON.parse(await readFile(tocPath, "utf8"));
        toc.guid = "EX1234";
        const tocText = JSON.stringify(toc);
        await writeFile(tocPath, tocText);
        const oldCode = JSON.parse(await readFile(join(source, defaultCivicProfile.corpusSlug + ".json"), "utf8"));
        oldCode.guid = "EX1234";
        oldCode.source = "https://ecode360.com/EX1234";
        await writeFile(join(source, profile.corpusSlug + ".json"), JSON.stringify(oldCode));
        await rm(join(source, defaultCivicProfile.corpusSlug + ".json"));
        const verification = JSON.parse(await readFile(join(source, "verification-report.json"), "utf8"));
        verification.binding.tocSha256 = custodyHash(tocText);
        await writeFile(join(source, "verification-report.json"), JSON.stringify(verification));
        await writeFile(join(source, "state/civic-profile.json"), JSON.stringify({ schemaVersion: "civic-output-profile/v1", profileId: profile.id, profileSha256: civicProfileFingerprint(profile) }));
        await writeFile(join(root, "civic.json"), JSON.stringify(profile));
        await writeFile(join(root, "policy.json"), JSON.stringify(policy));
        await writeFile(join(root, "region.json"), JSON.stringify({ schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "candidate", seedDir: "seed", enabledMonitors: [], sources: [] }));
        const cli = new URL("../src/regional_cli.ts", import.meta.url).pathname;
        await writeFile(join(root, "entry.ts"), `import {runRegionalCli} from ${JSON.stringify(cli)};await runRegionalCli({root:import.meta.dir,args:Bun.argv.slice(2)});`);
        const { runBoundedChild } = await import("../src/shared/subprocess.ts");
        const run = (command: string) => runBoundedChild([process.execPath, join(root, "entry.ts"), command], { cwd: root, timeoutMs: 20000 });
        const exported = await run("pages:export");
        expect(exported.stderr).toBe("");
        expect(exported.exitCode).toBe(0);
        expect((await run("pages:validate")).exitCode).toBe(0);
        const pageRoot = join(root, ".pages");
        server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const path = new URL(request.url).pathname; const file = Bun.file(join(pageRoot, path === "/" ? "index.html" : path.slice(1))); if (!await file.exists())
                return new Response("Not found", { status: 404 }); return new Response(file, { headers: { "Content-Type": path === "/" ? "text/html" : "application/json" } }); } });
        await withOutputRoot(root, async () => { try {
            const page = await newPage();
            await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
            await page.goto(server!.url.href);
            await page.getByRole("textbox", { name: "Search published municipal code" }).fill("permit licensing");
            await page.getByRole("button", { name: "Search code" }).click();
            await page.waitForFunction(() => document.querySelector("#code-results")?.textContent?.includes("License"));
            expect(await page.locator("#code-results a").getAttribute("href")).toBe("https://ecode360.com/1000");
            expect(await page.locator("#code-results img").count()).toBe(0);
            expect(await page.evaluate(() => Reflect.get(globalThis, "corpusInjected"))).toBeUndefined();
            if (process.env.REGIONAL_CORPUS_EVIDENCE_DIR)
                await page.screenshot({ path: join(process.env.REGIONAL_CORPUS_EVIDENCE_DIR, "static-search.png"), fullPage: true });
        }
        finally {
            const receipt = await closeBrowser();
            expect(receipt?.directChildReaped).toBe(true);
            expect(receipt?.processGroupGone).toBe(true);
        } });
        await writeFile(join(pageRoot, "unexpected.json"), "{}");
        expect((await run("pages:validate")).exitCode).not.toBe(0);
        await rm(join(pageRoot, "unexpected.json"));
        const indexBytes = await readFile(join(pageRoot, "code-index.json"));
        await rm(join(pageRoot, "code-index.json"));
        expect((await run("pages:validate")).exitCode).not.toBe(0);
        await writeFile(join(pageRoot, "code-index.json"), indexBytes);
        const receipt = JSON.parse(await readFile(join(pageRoot, "region.json"), "utf8"));
        await writeFile(join(pageRoot, "code.json"), JSON.stringify({ ...oldCode, guid: "DA4922" }));
        receipt.codeHash = custodyHash(await readFile(join(pageRoot, "code.json"), "utf8"));
        await writeFile(join(pageRoot, "region.json"), JSON.stringify(receipt));
        expect((await run("pages:validate")).exitCode).not.toBe(0);
    }
    finally {
        server?.stop(true);
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
test("cancelled promotion restores earlier committed batches before returning", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-corpus-cancel-"));
    try {
        const { d, articles } = await fixture(root, 301);
        await mkdir(join(d.output, "articles"), { recursive: true });
        const priorPath = join(d.output, "articles", articles[0]!.guid + ".json");
        await writeFile(priorPath, "previous exact bytes");
        const controller = new AbortController();
        let finished = false, observedCommitted = false;
        const operation = withRunSignal(controller.signal, () => promoteRegionalCorpus(d, "candidate"))
            .then(() => null, error => error).finally(() => { finished = true; });
        const deadline = Date.now() + 10000;
        while (!finished && Date.now() < deadline) {
            try {
                const journal = JSON.parse(await readFile(join(d.output, "state/regional-corpus-promotion.json"), "utf8"));
                if (journal.transactions.length >= 2) {
                    const first = JSON.parse(await readFile(join(d.output, "state/artifact-transactions", journal.transactions[0], "receipt.json"), "utf8"));
                    if (first.status === "committed") {
                        observedCommitted = true;
                        controller.abort(new Error("Cancellation regression"));
                        break;
                    }
                }
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 3));
        }
        const failure = await operation;
        expect(observedCommitted).toBe(true);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(AggregateError);
        expect(await readFile(priorPath, "utf8")).toBe("previous exact bytes");
        const journal = JSON.parse(await readFile(join(d.output, "state/regional-corpus-promotion.json"), "utf8"));
        expect(journal.status).toBe("rolled-back");
        for (const id of journal.transactions)
            expect(JSON.parse(await readFile(join(d.output, "state/artifact-transactions", id, "receipt.json"), "utf8")).status).toBe("rolled-back");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
test("corpus admission preserves protected content and separates candidate, active and seed roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "region-corpus-roots-"));
    try {
        const { d } = await fixture(root);
        for (const name of [".git", "src", "configs"]) {
            const protectedRoot = join(root, name);
            await mkdir(protectedRoot);
            const marker = join(protectedRoot, "retained");
            await writeFile(marker, "preserved");
            await expect(promoteRegionalCorpus({ ...d, output: protectedRoot }, "candidate")).rejects.toThrow("protected");
            await expect(seedRegionalCorpus({ ...d, seed: protectedRoot }, "candidate")).rejects.toThrow("protected");
            await expect(promoteRegionalCorpus(d, name + "/candidate")).rejects.toThrow("protected");
            expect(await readFile(marker, "utf8")).toBe("preserved");
        }
        await expect(promoteRegionalCorpus(d, "seed/candidate")).rejects.toThrow("overlap");
        await expect(promoteRegionalCorpus({ ...d, seed: join(root, "candidate", "seed") }, "candidate")).rejects.toThrow("overlap");
        await expect(seedRegionalCorpus({ ...d, seed: join(d.output, "seed") }, "candidate")).rejects.toThrow("overlap");
        await expect(checkRegionalCorpus({ ...d, config: { ...d.config, civicProfile: "profiles/civic.json" } }, "profiles/candidate")).rejects.toThrow("protected");
        await expect(access(join(d.output, "state/regional-corpus-promotion.json"))).rejects.toThrow();
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
