import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeFilesystemPath } from "./shared/storage.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import type { LoadedDeployment } from "./deployment.js";
export function renderRegionalSurface(d: LoadedDeployment, evidence: unknown = null, options: {
    localApi?: boolean;
    corpus?: {
        articleCount: number;
        sectionCount: number;
        verifiedAt: string | null;
        editionId: string;
    } | null;
} = {}): string {
    const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const observations = evidence as {
        news?: Array<{
            title?: string;
            url?: string;
            source?: string;
            publishedAt?: string;
        }>;
        meetings?: {
            sources?: Array<{
                sourceId?: string;
                status?: string;
                documents?: Array<{
                    title?: string;
                    url?: string;
                }>;
            }>;
        };
    } | null;
    const link = (url: unknown, title: unknown): string => { if (typeof url !== "string" || typeof title !== "string")
        return ""; try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
            return "";
        return `<a href="${escape(parsed.href)}">${escape(title)}</a>`;
    }
    catch {
        return "";
    } };
    const newsRows = (observations?.news ?? []).map(item => `<li>${link(item.url, item.title)}<small>${escape(item.source ?? "")} · ${escape(item.publishedAt ?? "Publication date unknown")}</small></li>`);
    const news = newsRows.length ? `<ul>${newsRows.slice(0, 6).join("")}</ul>${newsRows.length > 6 ? `<details><summary>Show ${newsRows.length - 6} more collected news items</summary><ul>${newsRows.slice(6).join("")}</ul></details>` : ""}` : "<p>No news collected for this edition.</p>";
    const meetings = (observations?.meetings?.sources ?? []).map(source => `<li><strong>${escape(source.sourceId ?? "Source")}</strong> · ${escape(source.status ?? "Not collected")}<details><summary>${(source.documents ?? []).length} captured document links</summary><ul>${(source.documents ?? []).map(doc => `<li>${link(doc.url, doc.title)}</li>`).join("")}</ul></details></li>`).join("");
    const code = d.config.sources.find(source => source.kind === "code");
    const staticCorpus = options.corpus ? `<p>${options.corpus.articleCount} articles · ${options.corpus.sectionCount} sections. Verification recorded ${escape(options.corpus.verifiedAt ?? "unknown")}.</p><p><a href="code.json" download>Download the verified municipal corpus</a></p><form id="code-search"><input name="q" aria-label="Search published municipal code" required><button>Search code</button></form><div id="code-results" aria-live="polite"></div><script>document.querySelector('#code-search').addEventListener('submit',async event=>{event.preventDefault();const target=document.querySelector('#code-results');try{const response=await fetch('code-index.json');if(!response.ok)throw Error('Published index unavailable');const index=await response.json(),terms=String(new FormData(event.target).get('q')).trim().toLowerCase().split(/\\s+/).filter(Boolean),text=new Map(index.shards.x.map(row=>[row.id,row.x]));const matches=index.shards.t.map(row=>({row,score:terms.length?(terms.every(term=>row.t.includes(term))?2:terms.every(term=>(text.get(row.id)||'').includes(term))?1:-1):-1})).filter(hit=>hit.score>=0).sort((a,b)=>b.score-a.score).slice(0,30);target.replaceChildren();if(!matches.length)target.textContent='No matching sections.';for(const hit of matches){const item=document.createElement('p'),anchor=document.createElement('a');anchor.textContent=hit.row.n+' '+hit.row.title;const url=new URL(hit.row.u);if(url.protocol==='https:'&&!url.username&&!url.password)anchor.href=url.href;item.append(anchor);target.append(item);}}catch(error){target.textContent=error.message;}})</script>` : "";
    const search = options.localApi ? `<form id="search"><input name="q" aria-label="Search municipal code" required><button>Search</button></form><pre id="result">Acquire the municipal corpus to search locally.</pre><script>document.querySelector('#search').addEventListener('submit',async e=>{e.preventDefault();const r=document.querySelector('#result');try{const response=await fetch('/api/search?q='+encodeURIComponent(new FormData(e.target).get('q')));if(!response.ok)throw new Error('Search unavailable: HTTP '+response.status);r.textContent=JSON.stringify(await response.json(),null,2)}catch(error){r.textContent=error.message}})</script>` : staticCorpus || `<p>${code ? link(code.url, "Read the official municipal code") : "No municipal-code provider configured."}</p><p>Local corpus search is available in the regional GUI after acquisition.</p>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(d.profile.publication.title)}</title><style>*{box-sizing:border-box}body{font:18px/1.6 system-ui;max-width:70rem;margin:2rem auto;padding:1rem;color:#16312f;background:#f4f6ef}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1}h2{margin-top:2rem}section{background:white;padding:1.5rem;border:1px solid #c9d8cd;border-radius:.6rem;margin:1rem 0}li{margin:.8rem 0}a{color:#136257;overflow-wrap:anywhere}small{display:block;color:#4b625b}input{padding:.6rem;max-width:75%}button{padding:.6rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}header p{max-width:50rem}</style></head><body><header><h1>${escape(d.profile.publication.title)}</h1><p>${escape(d.profile.publication.description)}</p><p>${escape(d.profile.municipality)} · ${escape(d.profile.timeZone)}</p></header><main><section><h2>Latest collected news</h2>${news}</section><section><h2>Meeting documents</h2>${meetings ? `<ul>${meetings}</ul>` : "<p>No meeting documents collected for this edition.</p>"}<p>Links identify published documents; discovery does not establish meeting dates or complete archive coverage.</p></section><section><h2>Collected observations</h2><p>Enabled monitors: ${escape(d.config.enabledMonitors.join(", ")) || "None configured"}.</p><details><summary>View observation evidence and availability</summary><pre>${escape(evidence === null ? "No observations collected for this edition." : JSON.stringify(evidence, null, 2))}</pre></details></section><section><h2>Municipal code</h2>${search}</section><section><h2>Reviewed source catalog</h2><p>Configured sources need separate collection and freshness receipts.</p><ul>${d.config.sources.map(source => `<li>${link(source.url, source.name)}<small>${escape(source.kind)}</small></li>`).join("")}</ul></section></main></body></html>`;
}
export async function regionalObservations(d: LoadedDeployment): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = { profileId: d.profile.id, alerts: null, news: [], meetings: null };
    async function read(relative: string): Promise<unknown> {
        const path = join(d.output, relative);
        try {
            await assertSafeFilesystemPath(path);
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024)
                throw new Error("Invalid regional observation file");
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await captureArtifactBytes(path, 4 * 1024 * 1024)));
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return null;
            throw error;
        }
    }
    const alerts = await read("alerts/composite/current.json") as Record<string, unknown> | null;
    if (alerts) {
        const available = (alerts.monitors ?? {}) as Record<string, Record<string, unknown>>;
        const monitors = d.config.enabledMonitors.map(key => { const row = available[key === "airquality" ? "airQuality" : key]; return { key, level: row?.level ?? null, summary: typeof row?.summary === "string" ? row.summary : null, count: typeof row?.count === "number" ? row.count : null, availability: row ? (row.availability ?? "available") : "unavailable" }; });
        result.alerts = { assessedAt: alerts.assessedAt, eligibleMonitorCount: monitors.length, unavailableMonitorCount: monitors.filter(row => row.availability === "unavailable").length, coverage: "Only enabled monitors are represented; missing observations do not establish calm conditions", monitors };
    }
    const meetings = await read("regional-meetings.json") as {
        profileId?: string;
        sources?: Array<Record<string, unknown>>;
    } | null;
    if (meetings && meetings.profileId !== d.profile.id)
        throw new Error("Meeting artifact profile mismatch");
    result.meetings = meetings ? { profileId: d.profile.id, sources: (meetings.sources ?? []).map(source => ({ sourceId: source.sourceId, status: source.status, retrievedAt: source.retrievedAt, documents: Array.isArray(source.documents) ? source.documents.map((doc: Record<string, unknown>) => ({ title: doc.title, url: doc.url, meetingDate: doc.meetingDate })) : [] })) } : null;
    let files: string[] = [];
    try {
        await assertSafeFilesystemPath(join(d.output, "news"));
        files = (await readdir(join(d.output, "news"))).filter(f => f.endsWith(".json") && f !== "source-health.json").sort().slice(-10);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
    }
    const items: unknown[] = [];
    for (const file of files) {
        const value = await read("news/" + file) as {
            items?: Record<string, unknown>[];
        } | null;
        for (const item of value?.items ?? [])
            items.push({ title: item.title, url: item.link, publishedAt: item.pubDate, source: item.source });
    }
    result.news = items.slice(-100);
    return result;
}
