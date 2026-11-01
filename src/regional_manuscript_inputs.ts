import { sameNames } from "./regional_manuscript_members.js";
/** Consumer-owned scholarly sources, accepted-seed evidence and native review editions. */
import { readdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedDeployment } from "./deployment.js";
import { deploymentPath } from "./deployment.js";
import { withCivicProfile } from "./civic_profile.js";
import { withOutputRoot } from "./shared/paths.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import { readPublicationBundle, publicationCoreFiles, PUBLICATION_OPTIONAL_FILES, publicationHash } from "./publication_bundle.js";
import { validateManuscript } from "./manuscript_document.js";
import { profileCorpus, type CorpusProfile } from "./regional_corpus_profile.js";
import { rendererFingerprint, TEMPLATE_REVISION } from "./regional_template.js";
const SOURCE = "docs/manuscript";
const TOKENS = new Set(["REGION_NAME", "PROFILE_ID", "MUNICIPALITY_CODE", "CODE_ARTICLES", "CODE_SECTIONS", "SOURCE_COUNT", "MONITOR_COUNT", "VERIFIED_AT", "EDITION_ID", "CORE_PIN", "EVIDENCE_FINGERPRINT", "CODE_MEDIAN_SECTIONS", "CODE_MAX_SECTIONS", "CODE_MIN_SECTIONS", "CODE_EMPTY_ARTICLES", "TEMPLATE_PIN"]);
export type Config = {
    schemaVersion: string;
    title: string;
    version: string;
    status: string;
    authors: string[];
    authorOrcids?: Record<string, string>;
    cover?: {
        path: string;
        alt: string;
        credit: string;
    };
};
export type Input = {
    config: Config;
    sources: Record<string, string>;
    variables: Record<string, string>;
    fingerprint: string;
    assets: Record<string, Uint8Array>;
    corpusProfile: CorpusProfile;
    evidence: Record<string, unknown>;
};
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
async function bounded(d: LoadedDeployment, path: string, limit = 2000000): Promise<string> {
    return decode(await captureArtifactBytes(deploymentPath(d.root, path), limit));
}
/** Capture public inputs; never substitute live output or the Crescent reference study. */
export async function inputs(d: LoadedDeployment): Promise<Input> {
    const raw = await bounded(d, SOURCE + "/config.json", 65536), config = JSON.parse(raw) as Config;
    if (!config || !sameNames(Object.keys(config), ["schemaVersion", "title", "version", "status", "authors", ...(config.cover === undefined ? [] : ["cover"]), ...(config.authorOrcids === undefined ? [] : ["authorOrcids"])]) || config.schemaVersion !== "regional-manuscript/v1" || config.status !== "review-draft" || (typeof config.version !== "string" || config.version.length > 32 || !/^\d+\.\d+\.\d+$/.test(config.version)) || typeof config.title !== "string" || !config.title.trim() || config.title.length > 200 || !Array.isArray(config.authors) || config.authors.length < 1 || config.authors.length > 10 || [config.title, ...config.authors].some(v => typeof v !== "string" || !v.trim() || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)))
        throw new Error("Invalid regional manuscript configuration");
    if (config.authorOrcids !== undefined) {
        if (!config.authorOrcids || typeof config.authorOrcids !== "object" || Array.isArray(config.authorOrcids) || Object.entries(config.authorOrcids).some(([name, id]) => !config.authors.includes(name) || typeof id !== "string" || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)))
            throw new Error("Invalid manuscript author identifiers");
        for (const id of Object.values(config.authorOrcids)) {
            const digits = id.replaceAll("-", "");
            let total = 0;
            for (const digit of digits.slice(0, 15))
                total = (total + Number(digit)) * 2;
            const check = (12 - total % 11) % 11;
            if (digits[15] !== (check === 10 ? "X" : String(check)))
                throw new Error("Invalid ORCID checksum");
        }
    }
    const assets: Record<string, Uint8Array> = {};
    if (config.cover !== undefined) {
        const c = config.cover;
        if (!c || !sameNames(Object.keys(c), ["alt", "credit", "path"]) || typeof c.path !== "string" || !/^docs\/assets\/[a-z0-9_/-]+\.png$/.test(c.path) || ![c.alt, c.credit].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 1000 && !/[\x00-\x1f]/.test(v)))
            throw new Error("Invalid manuscript cover configuration");
        const bytes = await captureArtifactBytes(deploymentPath(d.root, c.path), 8000000);
        if (Buffer.from(bytes).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
            throw new Error("Manuscript cover must be a PNG");
        assets["figures/cover.png"] = bytes;
    }
    const entries = await readdir(deploymentPath(d.root, SOURCE), { withFileTypes: true });
    if (entries.some(e => !e.isFile()))
        throw new Error("Manuscript sources must be regular files");
    const names = entries.map(e => e.name).filter(n => /^\d{2}_.*\.md$/.test(n)).sort();
    if (names.length !== 10)
        throw new Error("Regional manuscript requires ten numbered sections");
    const sources: Record<string, string> = { "config.json": raw };
    for (const name of [...names, "references.bib", "claim_ledger.json"])
        sources[name] = await bounded(d, SOURCE + "/" + name);
    for (const name of names)
        if (/\\(?:input|include|write|openout|read|usepackage|special)\b|<\/?(?!https?:\/\/|mailto:)[a-z][a-z0-9:-]*(?:[\s/>])/i.test(sources[name]!))
            throw new Error("Regional sources refuse active HTML and TeX file operations");
    const errors = await validateManuscript({ root: d.root, variableNames: TOKENS });
    if (errors.length)
        throw new Error(errors.join("\n"));
    if (!names.some(n => sources[n].includes("{{CODE_ARTICLES}}")) || !names.some(n => sources[n].includes("{{CODE_SECTIONS}}")))
        throw new Error("Regional results must bind corpus counts through evidence tokens");
    if (!d.profile.code) return documentInputs(d, config, sources, assets);
    // Parse a private exact-byte snapshot. Never re-open untrusted seed members
    // through the compatibility bundle reader's ordinary readFile path.
    const bundle = await withCivicProfile(d.profile, async () => {
        const captured: Record<string, Uint8Array> = {};
        for (const name of [...publicationCoreFiles(), ...PUBLICATION_OPTIONAL_FILES]) {
            try {
                captured[name] = await captureArtifactBytes(deploymentPath(d.root, d.config.seedDir + "/" + name), 16000000);
            }
            catch (error) {
                if (!PUBLICATION_OPTIONAL_FILES.includes(name as typeof PUBLICATION_OPTIONAL_FILES[number]) || (error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
            }
        }
        const snapshot = await mkdtemp(join(tmpdir(), "regional-manuscript-input-"));
        try {
            for (const [name, bytes] of Object.entries(captured))
                await Bun.write(join(snapshot, name), bytes);
            return await withOutputRoot(d.seed, () => readPublicationBundle(snapshot));
        }
        finally {
            await rm(snapshot, { recursive: true, force: true });
        }
    });
    const report = JSON.parse(bundle.bytes["verification-report.json"]!);
    if (report.schemaVersion !== "corpus-verification/v2" || report.publicationEligible !== true || report.overallStatus !== "pass" || ["local", "currentToc", "sample"].some(p => report.planes?.[p] !== "pass"))
        throw new Error("Regional manuscript requires complete accepted v2 seed verification");
    const code = JSON.parse(bundle.bytes[d.profile.corpusSlug + ".json"]!);
    const corpusProfile = profileCorpus(code);
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
    if (config.cover)
        files[config.cover.path] = { sha256: publicationHash(assets["figures/cover.png"]!), bytes: assets["figures/cover.png"]!.byteLength };
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
    const rendererSha256 = await rendererFingerprint();
    const selectedConfiguration = { deployment: d.config, profile: d.profile, policy: d.policy };
    const fingerprint = publicationHash(JSON.stringify({ selectedConfiguration, files, rendererSha256 }));
    const variables = { REGION_NAME: d.profile.name, PROFILE_ID: d.profile.id, MUNICIPALITY_CODE: d.profile.code!.municipalityCode, CODE_ARTICLES: String(articles), CODE_SECTIONS: String(sections), SOURCE_COUNT: String(d.config.sources.length), MONITOR_COUNT: String(d.config.enabledMonitors.length), VERIFIED_AT: bundle.receipt.sourceVerifiedAt!, EDITION_ID: bundle.receipt.editionId, CORE_PIN: pin.split("#")[1]!, EVIDENCE_FINGERPRINT: fingerprint, CODE_MEDIAN_SECTIONS: String(corpusProfile.medianSections), CODE_MAX_SECTIONS: String(corpusProfile.maxSections), CODE_MIN_SECTIONS: String(corpusProfile.minSections), CODE_EMPTY_ARTICLES: String(corpusProfile.emptyArticles), TEMPLATE_PIN: TEMPLATE_REVISION };
    return { config, sources, variables, assets, corpusProfile, fingerprint, evidence: { selectedConfiguration, template: { repository: "https://github.com/docxology/template", revision: TEMPLATE_REVISION }, schemaVersion: "regional-manuscript-evidence/v2", profileId: d.profile.id, editionId: bundle.receipt.editionId, variables, files, rendererSha256, inputFingerprint: fingerprint, limitations: ["Recorded accepted seed; no new upstream acquisition", "Live TOC and sample do not establish all-page currentness", "No legal, civic-impact, model-factuality or release acceptance implied"] } };
}

/** PDF evidence uses physical pages and nonempty lines, never fabricated code sections. */
async function documentInputs(d:LoadedDeployment,config:Config,sources:Record<string,string>,assets:Record<string,Uint8Array>):Promise<Input>{
 const doc=await (await import("./regional_documents.js")).readDocuments(d),files:Record<string,{sha256:string;bytes:number}>={};
 for(const [path,bytes] of Object.entries(doc.files))files[path]={sha256:publicationHash(bytes),bytes:bytes.length};
 for(const path of ["region.json",d.config.civicProfile,d.config.regionConfig,"package.json","bun.lock"]){const text=await bounded(d,path,16000000);files[path]={sha256:publicationHash(text),bytes:Buffer.byteLength(text)};}
 for(const [name,text] of Object.entries(sources))files[SOURCE+"/"+name]={sha256:publicationHash(text),bytes:Buffer.byteLength(text)};
 if(config.cover)files[config.cover.path]={sha256:publicationHash(assets["figures/cover.png"]!),bytes:assets["figures/cover.png"]!.length};
 try{const path=d.config.seedDir+"/regional-observations.json",text=await bounded(d,path,4000000);await (await import("./regional_surface.js")).regionalObservations(d);files[path]={sha256:publicationHash(text),bytes:Buffer.byteLength(text)};}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 const pin=JSON.parse(await bounded(d,"package.json")).dependencies?.["region-intel"];
 if(typeof pin!=="string"||!/^github:docxology\/region-intel#[a-f0-9]{40}$/.test(pin))throw new Error("Manuscript requires an immutable public core pin");
 const ledger=JSON.parse(sources["claim_ledger.json"]!);
 for(const claim of ledger.claims)if(!claim.evidence.length||claim.evidence.some((p:unknown)=>typeof p!=="string"||!Object.hasOwn(files,p)))throw new Error("Claim evidence must name captured public input files");
 const rendererSha256=await rendererFingerprint(),selectedConfiguration={deployment:d.config,profile:d.profile,policy:d.policy},fingerprint=publicationHash(JSON.stringify({selectedConfiguration,files,rendererSha256})),p=doc.profile;
 const variables={REGION_NAME:d.profile.name,PROFILE_ID:d.profile.id,MUNICIPALITY_CODE:doc.receipt.documents.map(x=>x.id).join(", "),CODE_ARTICLES:String(p.totalArticles),CODE_SECTIONS:String(p.totalSections),SOURCE_COUNT:String(d.config.sources.length),MONITOR_COUNT:String(d.config.enabledMonitors.length),VERIFIED_AT:doc.receipt.acquiredAt,EDITION_ID:doc.editionId,CORE_PIN:pin.split("#")[1]!,EVIDENCE_FINGERPRINT:fingerprint,CODE_MEDIAN_SECTIONS:String(p.medianSections),CODE_MAX_SECTIONS:String(p.maxSections),CODE_MIN_SECTIONS:String(p.minSections),CODE_EMPTY_ARTICLES:String(p.emptyArticles),TEMPLATE_PIN:TEMPLATE_REVISION};
 return {config,sources,variables,assets,corpusProfile:p,fingerprint,evidence:{schemaVersion:"regional-document-manuscript-evidence/v1",selectedConfiguration,template:{repository:"https://github.com/docxology/template",revision:TEMPLATE_REVISION},profileId:d.profile.id,editionId:doc.editionId,variables,files,rendererSha256,inputFingerprint:fingerprint,limitations:["Retained public PDF edition; not the full municipal code","Physical PDF pages and nonempty extracted lines are extraction units, not legal sections","Page text replays through installed Poppler; figures, layout, tables and legal interpretation require the original","No legal currency, impact, model-factuality or release acceptance implied"]}};
}
