import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDeployment } from "../src/deployment.ts";
import { checkRegionalManuscript, buildRegionalManuscript, validateRegionalRender } from "../src/regional_manuscript.ts";
import { writePublicationFixture } from "./helpers/publication-fixture.ts";
import { readPublicationBundle } from "../src/publication_bundle.ts";
import { defaultCivicProfile, withCivicProfile } from "../src/civic_profile.ts";
const titles = ["Abstract", "Introduction", "Methods", "Results", "Discussion", "Limitations, Ethics, and Threats to Validity", "Reproducibility and Artifact Specification", "Conclusion", "Appendix: Formal Contracts and Worked Records", "References"];
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "regional-paper-"));
    await mkdir(join(root, "docs/manuscript"), { recursive: true });
    await writeFile(join(root, "civic.json"), JSON.stringify(defaultCivicProfile));
    await writeFile(join(root, "policy.json"), await readFile(join(import.meta.dir, "../configs/crescent-city-region.json")));
    await writeFile(join(root, "region.json"), JSON.stringify({ schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "output", seedDir: "seed", enabledMonitors: ["weather"], sources: [] }));
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "region-intel": "github:docxology/region-intel#" + "a".repeat(40) } }));
    await writeFile(join(root, "bun.lock"), "synthetic locked fixture\n");
    const d = loadDeployment(root);
    await withCivicProfile(d.profile, () => writePublicationFixture(d.seed));
    const report = JSON.parse(await readFile(join(d.seed, "verification-report.json"), "utf8"));
    Object.assign(report, { schemaVersion: "corpus-verification/v2", verifiedAt: "2026-10-31T00:00:00Z", totalArticles: 1, totalExpectedSections: 1, totalFoundSections: 1 });
    await writeFile(join(d.seed, "verification-report.json"), JSON.stringify(report));
    const bundle = await withCivicProfile(d.profile, () => readPublicationBundle(d.seed));
    await writeFile(join(d.seed, "publication-input.json"), JSON.stringify(bundle.receipt));
    await writeFile(join(root, "docs/manuscript/config.json"), JSON.stringify({ schemaVersion: "regional-manuscript/v1", title: "Synthetic custody paper", version: "0.1.0", status: "review-draft", authors: ["Fixture project"] }));
    for (const [i, title] of titles.entries())
        await writeFile(join(root, "docs/manuscript", String(i).padStart(2, "0") + "_section.md"), `# ${title} {#sec:section${i}}\n\nRecorded {{CODE_ARTICLES}} articles and {{CODE_SECTIONS}} sections. [@prov2013]\n`);
    await writeFile(join(root, "docs/manuscript/references.bib"), '@misc{prov2013, title={Provenance}, author={{W3C}}, year={2013}}\n');
    await writeFile(join(root, "docs/manuscript/claim_ledger.json"), JSON.stringify({ schemaVersion: "1.0.0", claims: Array.from({ length: 4 }, (_, i) => ({ id: "claim" + i, statement: "Synthetic count", status: "fixture", scope: "test", notEstablished: "Live acceptance", evidence: ["seed/manifest.json"] })) }));
    return d;
}
test("regional paper derives accepted-seed counts and rejects changed bytes, old publication bindings and unsupported claims", async () => {
    const d = await fixture();
    try {
        const checked = await checkRegionalManuscript(d);
        expect(checked.variables.CODE_ARTICLES).toBe("1");
        expect(checked.variables.CODE_SECTIONS).toBe("1");
        expect(checked.variables.PROFILE_ID).toBe(d.profile.id);
        const path = join(d.seed, d.profile.corpusSlug + ".json"), original = await readFile(path, "utf8");
        await writeFile(path, original + " ");
        await expect(checkRegionalManuscript(d)).rejects.toThrow();
        await writeFile(path, original);
        const publication = join(d.seed, "publication-input.json"), saved = await readFile(publication, "utf8");
        await writeFile(publication, JSON.stringify({ ...JSON.parse(saved), editionId: "f".repeat(64) }));
        await expect(checkRegionalManuscript(d)).rejects.toThrow("edition differs");
        await writeFile(publication, saved);
        const ledger = join(d.root, "docs/manuscript/claim_ledger.json"), claims = JSON.parse(await readFile(ledger, "utf8"));
        claims.claims[0].evidence = ["not-captured.json"];
        await writeFile(ledger, JSON.stringify(claims));
        await expect(checkRegionalManuscript(d)).rejects.toThrow("captured public");
    }
    finally {
        await rm(d.root, { recursive: true, force: true });
    }
});
test("missing source and unknown tokens fail; hydration owns no reference manuscript and a real missing tool preserves the prior edition", async () => {
    const d = await fixture();
    try {
        const path = join(d.root, "docs/manuscript/00_section.md"), original = await readFile(path, "utf8");
        await writeFile(path, original + "{{BOGUS}}\n");
        await expect(checkRegionalManuscript(d)).rejects.toThrow("unknown manuscript variable");
        await writeFile(path, original);
        const out = await buildRegionalManuscript(d);
        const prior = await readFile(join(out, "review-receipt.json"), "utf8");
        expect(await readFile(join(out, "manuscript.md"), "utf8")).toContain("Recorded 1 articles and 1 sections");
        await expect(validateRegionalRender(d)).rejects.toThrow();
        const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/regional_cli.ts"), "manuscript:render"], { cwd: d.root, env: { ...process.env, PATH: "/no-regional-render-tools", REGION_TEMPLATE_PYTHON: "/no-regional-render-tools/python", REGION_TEMPLATE_ROOT: d.root, REGION_DEPLOYMENT: "region.json", REGION_ROOT: d.root }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text();
        expect(await child.exited).not.toBe(0);
        expect((await stderr) + (await stdout)).toContain("Manuscript tool failed");
        expect(await readFile(join(out, "review-receipt.json"), "utf8")).toBe(prior);
    }
    finally {
        await rm(d.root, { recursive: true, force: true });
    }
}, 30000);

test("required and optional seed members reject symlink escapes and oversized regular files", async () => {
    const d = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "regional-paper-outside-"));
    try {
        const manifest = join(d.seed, "manifest.json");
        const bytes = await readFile(manifest);
        await writeFile(join(outside, "manifest.json"), bytes);
        await unlink(manifest);
        await symlink(join(outside, "manifest.json"), manifest);
        await expect(checkRegionalManuscript(d)).rejects.toThrow();
        await unlink(manifest); await writeFile(manifest, bytes);
        const optional = join(d.seed, "readability.json");
        const readability = await readFile(join(import.meta.dir, "../pages-data/readability.json"));
        await writeFile(optional, readability);
        const bundle = await withCivicProfile(d.profile, () => readPublicationBundle(d.seed));
        await writeFile(join(d.seed, "publication-input.json"), JSON.stringify(bundle.receipt));
        await expect(checkRegionalManuscript(d)).resolves.toBeDefined();
        await writeFile(join(outside, "optional.json"), readability);
        await unlink(optional);
        await symlink(join(outside, "optional.json"), optional);
        await expect(checkRegionalManuscript(d)).rejects.toThrow();
        await unlink(optional);
        await writeFile(optional, "{}" + " ".repeat(16_000_000));
        await expect(checkRegionalManuscript(d)).rejects.toThrow("bounded regular file");
    } finally { await rm(d.root, {recursive:true,force:true}); await rm(outside, {recursive:true,force:true}); }
});

test("different selected deployment values cannot share a manuscript evidence fingerprint", async () => {
    const d = await fixture();
    try {
        const first = await checkRegionalManuscript(d);
        await writeFile(join(d.root,"alternate.json"),JSON.stringify({...d.config,enabledMonitors:["weather","earthquake"]}));
        const second = await checkRegionalManuscript(loadDeployment(d.root,"alternate.json"));
        expect(first.variables.MONITOR_COUNT).toBe("1");
        expect(second.variables.MONITOR_COUNT).toBe("2");
        expect(first.inputFingerprint).not.toBe(second.inputFingerprint);
    } finally { await rm(d.root,{recursive:true,force:true}); }
});

test("a BOM cannot silently collapse changed manuscript input bytes", async () => {
    const d = await fixture();
    try {
        await checkRegionalManuscript(d);
        const config = join(d.root,"docs/manuscript/config.json");
        const original = await readFile(config);
        await writeFile(config,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),original]));
        await expect(checkRegionalManuscript(d)).rejects.toThrow();
    } finally { await rm(d.root,{recursive:true,force:true}); }
});


test("author identifiers and cover bytes are captured; invalid metadata and linked artwork fail", async () => {
    const d=await fixture();
    try {
        const path=join(d.root,"docs/manuscript/config.json"),config=JSON.parse(await readFile(path,"utf8"));
        const before=await checkRegionalManuscript(d);
        config.authorOrcids={[config.authors[0]]:"0000-0000-0000-0001"};
        await writeFile(path,JSON.stringify(config));
        expect((await checkRegionalManuscript(d)).inputFingerprint).not.toBe(before.inputFingerprint);
        config.authorOrcids[config.authors[0]]="0000-0000-0000-0002";
        await writeFile(path,JSON.stringify(config));
        await expect(checkRegionalManuscript(d)).rejects.toThrow("ORCID checksum");
        config.authorOrcids={unlisted:"0000-0000-0000-0001"};
        await writeFile(path,JSON.stringify(config));
        await expect(checkRegionalManuscript(d)).rejects.toThrow("author identifiers");
        delete config.authorOrcids;
        await mkdir(join(d.root,"docs/assets"),{recursive:true});
        const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=","base64");
        await writeFile(join(d.root,"docs/assets/cover.png"),bytes);
        config.cover={path:"docs/assets/cover.png",alt:"Synthetic one-pixel fixture",credit:"Test fixture only"};
        await writeFile(path,JSON.stringify(config));
        expect((await checkRegionalManuscript(d)).inputFingerprint).not.toBe(before.inputFingerprint);
        await writeFile(join(d.root,"docs/assets/retained.png"),bytes);
        await unlink(join(d.root,"docs/assets/cover.png"));
        await symlink(join(d.root,"docs/assets/retained.png"),join(d.root,"docs/assets/cover.png"));
        await expect(checkRegionalManuscript(d)).rejects.toThrow();
    } finally {await rm(d.root,{recursive:true,force:true});}
});
test("authored raw active content and TeX file operations never reach the native renderer",async()=>{
    const d=await fixture();
    try {
        const path=join(d.root,"docs/manuscript/00_section.md"),original=await readFile(path,"utf8");
        for(const payload of ["<script>throw 1</script>","<img src=x onerror=alert(1)>","<svg/onload=alert(1)>","\\input{outside.tex}"]){
            await writeFile(path,original+"\n"+payload);
            await expect(checkRegionalManuscript(d)).rejects.toThrow("active HTML");
        }
    } finally {await rm(d.root,{recursive:true,force:true});}
});
