/** Read-only correspondence between public working bytes and Git publication bytes. */
import { join, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { captureArtifactBytes } from "./artifact_custody.js";
import { deploymentPath, loadDeployment, type LoadedDeployment } from "./deployment.js";
import { publicationCoreFiles, PUBLICATION_OPTIONAL_FILES, publicationHash } from "./publication_bundle.js";
import { withCivicProfile } from "./civic_profile.js";
import { runBoundedChild } from "./shared/subprocess.js";
import { inputs } from "./regional_manuscript_inputs.js";
import { validateRegionalRender } from "./regional_manuscript.js";

export type PublicationReference = "HEAD" | "index";
const MAX_FILES = 4096, MAX_FILE = 32000000, MAX_TOTAL = 160000000;

async function git(root: string, args: string[]): Promise<string> {
    // Disable hook-like fsmonitor execution and all transports, including lazy fetch.
    const child = await runBoundedChild(["git", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", ...args], { cwd: root, timeoutMs: 15000, maxBytes: 8000000 });
    if (child.status !== "ok" || !child.reaped)
        throw new Error("Publication Git read failed: " + args[0] + " (" + child.status + ", exit " + child.exitCode + ")");
    return child.stdout;
}

/** No staging, commits, fetches, archive extraction, or temporary checkouts. */
export async function verifyGitPublication(root: string, paths: readonly string[], reference: PublicationReference = "HEAD", trackedOptionalPaths: readonly string[] = []): Promise<{ reference: PublicationReference; files: number; bytes: number; fileSetSha256: string; referenceSnapshotSha256: string }> {
    if (!["HEAD", "index"].includes(reference) || !paths.length || paths.length > MAX_FILES || new Set(paths).size !== paths.length || trackedOptionalPaths.length > MAX_FILES || new Set(trackedOptionalPaths).size !== trackedOptionalPaths.length || new Set([...paths, ...trackedOptionalPaths]).size > MAX_FILES)
        throw new Error("Invalid publication path set or reference");
    root = await realpath(root);
    if (await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim()) !== root)
        throw new Error("Publication root must be its own Git checkout");
    let names = [...new Set([...paths, ...trackedOptionalPaths])].sort();
    for (const name of names) {
        if (relative(root, deploymentPath(root, name)).split("\\").join("/") !== name || /[\x00-\x1f\x7f]/.test(name))
            throw new Error("Publication paths must be canonical relative files");
    }
    const revision = reference === "HEAD" ? (await git(root, ["rev-parse", "--verify", "HEAD"])).trim() : null;
    const args = reference === "index" ? ["ls-files", "--stage", "-z"] : ["ls-tree", "-r", "-z", "--full-tree", revision!];
    const listing = await git(root, args);
    const entries = new Map<string, { mode: string; oid: string }>();
    for (const line of listing.split("\0").filter(Boolean)) {
        const tab = line.indexOf("\t");
        if (tab < 0) throw new Error("Invalid Git publication listing");
        const fields = line.slice(0, tab).split(" "), name = line.slice(tab + 1);
        if (reference === "index" ? fields[2] !== "0" : fields[1] !== "blob") {
            if (names.includes(name)) throw new Error("Publication member is unmerged or not a blob: " + name);
            continue;
        }
        const oid = fields[reference === "index" ? 1 : 2]!;
        if (entries.has(name) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) throw new Error("Invalid Git publication identity");
        entries.set(name, { mode: fields[0]!, oid });
    }
    names = names.filter(name => paths.includes(name) || entries.has(name));
    let bytes = 0;
    const hashes: Record<string, string> = Object.create(null);
    for (const name of names) {
        const entry = entries.get(name);
        if (!entry || !["100644", "100755"].includes(entry.mode))
            throw new Error("Required publication file is not a tracked regular blob in " + reference + ": " + name);
        const content = await captureArtifactBytes(deploymentPath(root, name), MAX_FILE);
        bytes += content.byteLength;
        if (bytes > MAX_TOTAL) throw new Error("Publication closure exceeds byte bound");
        const oid = new Bun.CryptoHasher(entry.oid.length === 40 ? "sha1" : "sha256").update("blob " + content.byteLength + "\0").update(content).digest("hex");
        if (oid !== entry.oid) throw new Error("Publication working bytes differ from " + reference + ": " + name);
        hashes[name] = publicationHash(content);
    }
    for (const name of names)
        if (publicationHash(await captureArtifactBytes(deploymentPath(root, name), MAX_FILE)) !== hashes[name])
            throw new Error("Publication member changed during verification: " + name);
    if (await git(root, args) !== listing) throw new Error("Git publication reference changed during verification");
    if (revision && (await git(root, ["rev-parse", "--verify", "HEAD"])).trim() !== revision) throw new Error("Git HEAD changed during verification");
    return { reference, files: names.length, bytes, fileSetSha256: publicationHash(JSON.stringify(hashes)), referenceSnapshotSha256: publicationHash(listing) };
}

export async function checkRegionalPublication(d: LoadedDeployment, reference: PublicationReference = "HEAD", deploymentFile = "region.json"): Promise<object> {
    const selected = loadDeployment(d.root, deploymentFile);
    if (JSON.stringify([selected.config, selected.profile, selected.policy]) !== JSON.stringify([d.config, d.profile, d.policy])) throw new Error("Selected publication deployment differs");
    const paths = new Set([deploymentFile,d.config.civicProfile,d.config.regionConfig,"package.json","bun.lock","scripts/region.ts"]);
    if(!d.profile.code){const docs=await (await import("./regional_documents.js")).readDocuments(d);for(const name of Object.keys(docs.files))paths.add(name);}
    else {
      paths.add(d.config.seedDir+"/publication-input.json");
      for(const name of withCivicProfile(d.profile,publicationCoreFiles))paths.add(d.config.seedDir+"/"+name);
      for(const name of PUBLICATION_OPTIONAL_FILES){const path=d.config.seedDir+"/"+name;try{await captureArtifactBytes(deploymentPath(d.root,path),MAX_FILE);paths.add(path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
    }
    const observationPath=d.config.seedDir+"/regional-observations.json";
    try{await captureArtifactBytes(deploymentPath(d.root,observationPath),4000000);paths.add(observationPath);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    let manuscript: { inputFingerprint: string; members: number } | null = null;
    const config = deploymentPath(d.root, "docs/manuscript/config.json");
    if (await Bun.file(config).exists()) {
        await validateRegionalRender(d, "bundle");
        const input = await inputs(d), evidence = input.evidence.files as Record<string, unknown>;
        for (const name of Object.keys(evidence)) paths.add(name);
        const folder = "review/" + input.config.version + "-draft";
        const receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await captureArtifactBytes(join(d.root, folder, "review-receipt.json"), 512000)));
        for (const name of [...Object.keys(receipt.files), "review-receipt.json"]) paths.add(folder + "/" + name);
        manuscript = { inputFingerprint: input.fingerprint, members: Object.keys(receipt.files).length + 1 };
    }
    const trackedOptionalPaths = [...PUBLICATION_OPTIONAL_FILES.map(name => d.config.seedDir + "/" + name), "docs/manuscript/config.json", observationPath, "documents.json"];
    const verified = await verifyGitPublication(d.root, [...paths], reference, trackedOptionalPaths);
    if (manuscript && (await inputs(d)).fingerprint !== manuscript.inputFingerprint)
        throw new Error("Manuscript inputs changed during publication preflight");
    return { schemaVersion: "regional-publication-preflight/v1", profileId: d.profile.id, ...verified, manuscript, scope: "Exact Git/worktree publication correspondence; no live-source, semantic, review or release certification" };
}
