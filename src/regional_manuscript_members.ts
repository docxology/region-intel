/** Bounded recursive receipt membership for complete offline native editions. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { captureArtifactBytes } from "./artifact_custody.js";
import { publicationHash } from "./publication_bundle.js";
export async function inventory(root: string): Promise<Record<string, string>> {
    const files: Record<string, string> = Object.create(null);
    let total = 0;
    async function visit(relative: string, depth: number): Promise<void> {
        if (depth > 12)
            throw new Error("Manuscript member depth exceeded");
        const entries = await readdir(join(root, relative), { withFileTypes: true });
        if (relative && !entries.length)
            throw new Error("Empty manuscript member directory");
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === "." || entry.name === ".." || entry.name.includes("\\") || entry.name.length > 240)
                throw new Error("Invalid manuscript member");
            const name = relative ? relative + "/" + entry.name : entry.name;
            if (entry.isDirectory())
                await visit(name, depth + 1);
            else if (entry.isFile()) {
                if (Object.keys(files).length >= 2048)
                    throw new Error("Manuscript member count exceeded");
                const bytes = await captureArtifactBytes(join(root, name), 32000000);
                total += bytes.byteLength;
                if (total > 128000000)
                    throw new Error("Manuscript bundle size exceeded");
                files[name] = publicationHash(bytes);
            }
            else
                throw new Error("Manuscript members must be regular files or directories");
        }
    }
    await visit("", 0);
    return files;
}
/** Compare names structurally: delimiters may occur in real filenames or keys. */
export function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
    if (actual.length !== expected.length)
        return false;
    const left = [...actual].sort(), right = [...expected].sort();
    return left.every((name, index) => name === right[index]);
}
export async function validateMembers(root: string, hashes: unknown, required: string[], expected: Record<string, string | Uint8Array>): Promise<void> {
    if (!hashes || typeof hashes !== "object" || Array.isArray(hashes))
        throw new Error("Invalid manuscript member hashes");
    const recorded = hashes as Record<string, unknown>, actual = await inventory(root);
    delete actual["review-receipt.json"];
    if (new Set(required).size !== required.length || !sameNames(Object.keys(actual), required) || !sameNames(Object.keys(recorded), required))
        throw new Error("Rendered edition member set differs");
    for (const name of required) {
        if (!Object.hasOwn(actual, name) || !Object.hasOwn(recorded, name) || typeof recorded[name] !== "string" || !/^[a-f0-9]{64}$/.test(recorded[name]) || actual[name] !== recorded[name])
            throw new Error("Rendered edition bytes differ: " + name);
        if (Object.hasOwn(expected, name) && actual[name] !== publicationHash(expected[name]!))
            throw new Error("Rendered source projection differs: " + name);
    }
}
