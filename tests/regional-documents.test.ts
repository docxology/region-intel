import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCivicProfile } from "../src/civic_profile.js";
import { loadDeployment } from "../src/deployment.js";
import { acquireDocuments, readDocuments, extractDocument, documentConfiguration, documentPublication } from "../src/regional_documents.js";
import { withTransportScope } from "../src/shared/transport.js";
import { publicationHash } from "../src/publication_bundle.js";
function pdf(): Uint8Array {
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>", "", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    for (const [i, text] of [[3, "First retained public page"], [5, "Second page: flood standards"]] as const) {
        const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET\n`;
        objects[i] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }
    let value = "%PDF-1.4\n", offsets = [0];
    objects.forEach((o, i) => { offsets.push(value.length); value += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = value.length;
    value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(value);
}
test("real PDF capture, all-page replay and independent malformed-input controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "public-documents-")), bytes = pdf();
    let unavailable = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return unavailable ? new Response("offline", { status: 503 }) : new Response(bytes.slice().buffer as ArrayBuffer, { headers: { "Content-Type": "application/pdf" } }); } });
    try {
        const profile = { ...defaultCivicProfile, id: "test-region", corpusSlug: "test-region-code", vectorNamespace: "test-region-code", calendar: { uidDomain: "test-region", productId: "-//Test//EN" }, code: null, capabilities: ["geo"] };
        const policy = JSON.parse(await readFile(new URL("../configs/example-region.json", import.meta.url), "utf8"));
        policy.profileId = profile.id;
        await writeFile(join(root, "civic.json"), JSON.stringify(profile));
        await writeFile(join(root, "policy.json"), JSON.stringify(policy));
        await writeFile(join(root, "region.json"), JSON.stringify({ schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "output", seedDir: "seed", enabledMonitors: [], sources: [{ id: "public-pdf", name: "Public document", kind: "code", url: "https://example.invalid/document.pdf" }] }));
        const conf = { schemaVersion: "regional-documents/v1", documents: [{ id: "public-pdf", sourceId: "public-pdf", title: "Two public pages", url: "https://example.invalid/document.pdf", statedEdition: "Fixture edition", rights: "Real generated test PDF" }] };
        const d = loadDeployment(root);
        expect(await documentConfiguration(d)).toBeNull();
        await writeFile(join(root, "documents.json"), JSON.stringify(conf));
        const scope = { fixture: { origin: server.url.origin, allowedOrigins: ["https://example.invalid"] } };
        await withTransportScope(scope, () => acquireDocuments(d));
        const baseline = await readDocuments(d);
        expect(baseline.profile.totalArticles).toBe(2);
        expect(baseline.receipt.documents[0]!.pages[1]!.text).toContain("flood standards");
        expect(baseline.profile.units?.items).toBe("PDF pages");
        expect((await documentPublication(d)).files["document-search.json"]).toContain("#page=2");
        const path = join(d.seed, "documents/input.json"), original = await readFile(path, "utf8");
        for (const change of [(r: any) => { r.profileId = "other"; }, (r: any) => { r.documents[0].url = "https://example.invalid/other.pdf"; }, (r: any) => { r.documents[0].pages.pop(); }, (r: any) => { const p = r.documents[0].pages[0]; p.text = "forged"; p.sha256 = publicationHash(p.text); }, (r: any) => { r.documents[0].pdfSha256 = "0".repeat(64); }, (r: any) => { r.acquiredAt = "invalid"; }]) {
            const changed = JSON.parse(original);
            change(changed);
            await writeFile(path, JSON.stringify(changed));
            await expect(readDocuments(d)).rejects.toThrow();
            await writeFile(path, original);
        }
        await writeFile(join(d.seed, "documents/unexpected.txt"), "unreviewed");
        await expect(readDocuments(d)).rejects.toThrow("member");
        await rm(join(d.seed, "documents/unexpected.txt"));
        const protectedConfig = JSON.parse(await readFile(join(root, "region.json"), "utf8"));
        protectedConfig.seedDir = ".git";
        await writeFile(join(root, "protected.json"), JSON.stringify(protectedConfig));
        await expect(documentConfiguration(loadDeployment(root, "protected.json"))).rejects.toThrow("protected");
        const pdfPath = join(d.seed, "documents/public-pdf.pdf");
        await writeFile(pdfPath, Buffer.concat([bytes, Buffer.from("changed")]));
        await expect(readDocuments(d)).rejects.toThrow("bytes differ");
        await writeFile(pdfPath, bytes);
        unavailable = true;
        await expect(withTransportScope(scope, () => acquireDocuments(d))).rejects.toThrow("HTTP 503");
        expect(await readFile(path, "utf8")).toBe(original);
        expect((await readDocuments(d)).profile.totalArticles).toBe(2);
        conf.documents[0]!.url = "https://example.invalid/wrong.pdf";
        await writeFile(join(root, "documents.json"), JSON.stringify(conf));
        await expect(documentConfiguration(d)).rejects.toThrow("identity");
        await expect(extractDocument(new TextEncoder().encode("not a PDF"))).rejects.toThrow("PDF");
    }
    finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
