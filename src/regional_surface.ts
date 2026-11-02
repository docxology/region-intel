import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeFilesystemPath } from "./shared/storage.js";
import { captureArtifactBytes } from "./artifact_custody.js";
import type { LoadedDeployment } from "./deployment.js";
import { ALERT_MONITOR_SOURCE_NAMES, MONITOR_KEYS, type MonitorKey } from "./alerts/composite.js";
import { isSourceHealthReceipt } from "./shared/source_health.js";
import { assessSourceClock, SOURCE_CLOCK_POLICIES } from "./source_clocks.js";
import type { SourceHealth } from "./types.js";
export function renderRegionalSurface(d: LoadedDeployment, evidence: unknown = null, options: {
    localApi?: boolean;
    manuscriptTitle?: string | null;
    corpus?: {
        kind?: "documents";
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
    const checks=(evidence as {sourceChecks?:{sources?:Array<{sourceId?:string;checkedAt?:string;status?:string;httpStatus?:number|null}>}}|null)?.sourceChecks;
    const sourceHealth=Array.isArray(checks?.sources)?`<section><h2>Source reachability</h2><p>HTTP checks only. A reachable page does not establish parsed, complete or current content. Original check times are preserved.</p><div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>Result</th><th>HTTP</th><th>Checked at (UTC)</th></tr></thead><tbody>${checks.sources.map(row=>`<tr><td>${escape(d.config.sources.find(s=>s.id===row.sourceId)?.name??"Unknown source")}</td><td>${escape(typeof row.status==="string"?row.status:"unknown")}</td><td>${typeof row.httpStatus==="number"?row.httpStatus:"—"}</td><td>${escape(typeof row.checkedAt==="string"?row.checkedAt:"unknown")}</td></tr>`).join("")}</tbody></table></div></section>`:"";
    const code = d.config.sources.find(source => source.kind === "code");
    const staticCorpus = options.corpus ? `<p>${options.corpus.articleCount} articles · ${options.corpus.sectionCount} sections. Verification recorded ${escape(options.corpus.verifiedAt ?? "unknown")}.</p><p><a href="code.json" download>Download the verified municipal corpus</a></p><form id="code-search"><input name="q" aria-label="Search published municipal code" required><button>Search code</button></form><div id="code-results" aria-live="polite"></div><script>document.querySelector('#code-search').addEventListener('submit',async event=>{event.preventDefault();const target=document.querySelector('#code-results');try{const response=await fetch('code-index.json');if(!response.ok)throw Error('Published index unavailable');const index=await response.json(),terms=String(new FormData(event.target).get('q')).trim().toLowerCase().split(/\\s+/).filter(Boolean),text=new Map(index.shards.x.map(row=>[row.id,row.x]));const matches=index.shards.t.map(row=>({row,score:terms.length?(terms.every(term=>row.t.includes(term))?2:terms.every(term=>(text.get(row.id)||'').includes(term))?1:-1):-1})).filter(hit=>hit.score>=0).sort((a,b)=>b.score-a.score).slice(0,30);target.replaceChildren();if(!matches.length)target.textContent='No matching sections.';for(const hit of matches){const item=document.createElement('p'),anchor=document.createElement('a');anchor.textContent=hit.row.n+' '+hit.row.title;const url=new URL(hit.row.u);if(url.protocol==='https:'&&!url.username&&!url.password)anchor.href=url.href;item.append(anchor);target.append(item);}}catch(error){target.textContent=error.message;}})</script>` : "";
    const documents = options.corpus?.kind === "documents" ? `<p>${options.corpus.articleCount} physical PDF pages · ${options.corpus.sectionCount} nonempty extracted lines. Captured ${escape(options.corpus.verifiedAt ?? "unknown")}.</p><p>This is a retained document edition, not the complete municipal code or a statement of current law. PDF page numbers include front matter; tables and figures require the original PDF.</p><p><a href="documents.json" download>Download document text and provenance</a></p><form id="document-search"><label>Search retained PDF text <input name="q" required></label><button>Search pages</button></form><div id="document-results" aria-live="polite"></div><script>document.querySelector('#document-search').addEventListener('submit',async event=>{event.preventDefault();const target=document.querySelector('#document-results');try{const response=await fetch('document-search.json');if(!response.ok)throw Error('Document index unavailable');const rows=await response.json(),terms=String(new FormData(event.target).get('q')).trim().toLowerCase().split(/\\s+/).filter(Boolean),matches=rows.filter(row=>terms.length&&terms.every(term=>row.text.toLowerCase().includes(term)));target.replaceChildren();const count=document.createElement('p');count.textContent=matches.length+' matching PDF pages; showing up to 30.';target.append(count);for(const row of matches.slice(0,30)){const article=document.createElement('article'),a=document.createElement('a'),snippet=document.createElement('pre'),url=new URL(row.url,document.baseURI);a.textContent=row.title;if((url.origin===location.origin||url.protocol==='https:')&&!url.username&&!url.password)a.href=url.href;snippet.textContent=row.text.slice(0,700);article.append(a,snippet);target.append(article);}}catch(error){target.textContent=error.message;}})</script>` : "";
    const search = documents || (options.localApi ? `<form id="search"><input name="q" aria-label="Search municipal code" required><button>Search</button></form><pre id="result">Acquire the municipal corpus to search locally.</pre><script>document.querySelector('#search').addEventListener('submit',async e=>{e.preventDefault();const r=document.querySelector('#result');try{const response=await fetch('/api/search?q='+encodeURIComponent(new FormData(e.target).get('q')));if(!response.ok)throw new Error('Search unavailable: HTTP '+response.status);r.textContent=JSON.stringify(await response.json(),null,2)}catch(error){r.textContent=error.message}})</script>` : staticCorpus || `<p>${code ? link(code.url, "Read the official municipal code") : "No municipal-code provider configured."}</p><p>Local corpus search is available in the regional GUI after acquisition.</p>`);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(d.profile.publication.title)}</title><style>*{box-sizing:border-box}body{font:18px/1.6 system-ui;max-width:70rem;margin:2rem auto;padding:1rem;color:#16312f;background:#f4f6ef}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1}h2{margin-top:2rem}section{background:white;padding:1.5rem;border:1px solid #c9d8cd;border-radius:.6rem;margin:1rem 0}li{margin:.8rem 0}a{color:#136257;overflow-wrap:anywhere}small{display:block;color:#4b625b}th,td{text-align:left;padding:.65rem;border-bottom:1px solid #d4dfd8;font-size:.9rem}input{padding:.6rem;max-width:75%}button{padding:.6rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}header p{max-width:50rem}</style></head><body><header><h1>${escape(d.profile.publication.title)}</h1><p>${escape(d.profile.publication.description)}</p><p>${escape(d.profile.municipality)} · ${escape(d.profile.timeZone)}</p></header><main>${options.manuscriptTitle ? `<section><h2>Research manuscript</h2><p>${escape(options.manuscriptTitle)}</p><p><a href="manuscript/web/index.html">Read the complete HTML manuscript</a> · <a href="manuscript/manuscript.pdf">Download PDF</a> · <a href="manuscript/evidence.json">Evidence and input commitments</a></p><p>Review draft. Rendering and reproducibility checks are separate from scientific, legal and release approval.</p></section>` : ""}<section><h2>Latest collected news</h2>${news}</section><section><h2>Meeting documents</h2>${meetings ? `<ul>${meetings}</ul>` : "<p>No meeting documents collected for this edition.</p>"}<p>Links identify published documents; discovery does not establish meeting dates or complete archive coverage.</p></section>${sourceHealth}<section><h2>Collected observations</h2><p>Enabled monitors: ${escape(d.config.enabledMonitors.join(", ")) || "None configured"}.</p><details><summary>View observation evidence and availability</summary><pre>${escape(evidence === null ? "No observations collected for this edition." : JSON.stringify(evidence, null, 2))}</pre></details></section><section><h2>${documents ? "Retained public documents" : "Municipal code"}</h2>${search}</section><section><h2>Reviewed source catalog</h2><p>Configured sources need separate collection and freshness receipts.</p><ul>${d.config.sources.map(source => `<li>${link(source.url, source.name)}<small>${escape(source.kind)}</small></li>`).join("")}</ul></section></main></body></html>`;
}
export async function regionalObservations(d: LoadedDeployment, liveOnly = false): Promise<Record<string, unknown>> {
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
        const health = await read("alerts/source-health.json");
        if (health !== null && (!health || typeof health !== "object" || Array.isArray(health) || !Array.isArray((health as Record<string, unknown>).sources) || ((health as Record<string, unknown>).sources as unknown[]).length > MONITOR_KEYS.length)) throw new Error("Invalid monitor source health roster");
        const sources = health === null ? [] : (health as { sources: unknown[] }).sources;
        const monitors = d.config.enabledMonitors.map(value => {
            const key = value as MonitorKey;
            const row = available[key === "airquality" ? "airQuality" : key];
            const expected = monitorSourceName(key);
            const matches = sources.filter(value => value && typeof value === "object" && (value as Record<string, unknown>).source === expected);
            if (matches.length > 1) throw new Error("Duplicate monitor source health identity");
            const sourceHealth = publicMonitorHealth(key, matches[0] ?? null);
            return { key, level: row?.level ?? null, summary: typeof row?.summary === "string" ? row.summary : null, count: typeof row?.count === "number" ? row.count : null, availability: row && row.availability !== "unavailable" && usableMonitorHealth(key, sourceHealth) ? "available" : "unavailable", sourceHealth };
        });
        result.alerts = { assessedAt: alerts.assessedAt, eligibleMonitorCount: monitors.length, unavailableMonitorCount: monitors.filter(row => row.availability === "unavailable").length, coverage: "Only enabled monitors are represented. Source-health clocks and status are retained as originally assessed, not refreshed by publication; missing or stale clock evidence does not establish calm conditions", monitors };
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
    result.sourceChecks = await read("source-checks.json");
    if (!liveOnly && !alerts && !meetings && !items.length && !result.sourceChecks) {
      try {
        const { deploymentPath }=await import("./deployment.js");
        const bytes=await captureArtifactBytes(deploymentPath(d.root,d.config.seedDir+"/regional-observations.json"),4000000),seed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
        validateRegionalObservationInput(d,seed);
        return {...seed.observations,retainedAt:seed.capturedAt,coverage:"Retained observations; timestamps are not refreshed by publication"};
      }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    return result;
}

const MONITOR_HEALTH_FIELDS = ["source", "sourceId", "status", "checkedAt", "fetchedAt", "observedAt", "productDate", "validUntil", "timestampBasis", "observationAgeMs", "observationFreshness", "itemCount", "url", "provenance", "ageMs", "freshness", "freshnessWindowMs"] as const;
function monitorSourceName(key: MonitorKey): string { return ALERT_MONITOR_SOURCE_NAMES[MONITOR_KEYS.indexOf(key)]!; }
/** Preserve the producer's clocks verbatim; no publication-time reassessment. */
function publicMonitorHealth(key: MonitorKey, value: unknown): SourceHealth | null {
    if (value === null) return null;
    if (!isSourceHealthReceipt(value) || value.source !== monitorSourceName(key)) throw new Error("Invalid monitor source health identity or clocks");
    return Object.fromEntries(MONITOR_HEALTH_FIELDS.filter(field => value[field] !== undefined).map(field => [field, value[field]])) as unknown as SourceHealth;
}
function usableMonitorHealth(key: MonitorKey, health: SourceHealth | null): boolean {
    return health !== null && (health.status === "ok" || health.status === "empty") && health.timestampBasis === SOURCE_CLOCK_POLICIES[key].basis && health.observationFreshness !== "stale" && health.observationFreshness !== "unknown" && health.freshness !== "stale" && health.freshness !== "unknown" && assessSourceClock(key, health, Date.parse(health.checkedAt)).usable;
}

export function regionalObservationBinding(d:LoadedDeployment):string{return new Bun.CryptoHasher("sha256").update(JSON.stringify({config:d.config,profile:d.profile,policy:d.policy})).digest("hex");}

/** Validate a retained seed even when live output is also present. */
export function validateRegionalObservationInput(d:LoadedDeployment,value:unknown):void{
 const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid retained observation object");return value as Record<string,unknown>;};
 const seed=object(value),obs=object(seed.observations);
 if(Object.keys(seed).sort().join("|")!==["schemaVersion","profileId","configurationSha256","capturedAt","observations"].sort().join("|") || seed.schemaVersion!=="regional-observation-input/v1" || seed.profileId!==d.profile.id || seed.configurationSha256!==regionalObservationBinding(d) || typeof seed.capturedAt!=="string" || !Number.isFinite(Date.parse(seed.capturedAt)) || obs.profileId!==d.profile.id || !Array.isArray(obs.news) || obs.news.length>100)throw new Error("Retained observation identity differs");
 if(obs.meetings!==null && object(obs.meetings).profileId!==d.profile.id)throw new Error("Retained meeting identity differs");
 if(obs.alerts!==null){
  const alerts=object(obs.alerts);
  if(!Array.isArray(alerts.monitors)||alerts.monitors.length!==d.config.enabledMonitors.length||alerts.monitors.some((row:unknown,i:number)=>object(row).key!==d.config.enabledMonitors[i]))throw new Error("Retained monitor roster differs");
  for (const value of alerts.monitors) {
   const row=object(value),key=row.key as MonitorKey,health=publicMonitorHealth(key,row.sourceHealth);
   if (health && Object.keys(object(row.sourceHealth)).some(field=>!MONITOR_HEALTH_FIELDS.includes(field as typeof MONITOR_HEALTH_FIELDS[number]))) throw new Error("Unexpected retained monitor health field");
   if (!["available","unavailable"].includes(String(row.availability)) || row.availability==="available"&&!usableMonitorHealth(key,health)) throw new Error("Retained monitor availability lacks usable source clock evidence");
  }
 }
 if(obs.sourceChecks!==null){
  const checks=object(obs.sourceChecks),seen=new Set<string>();
  if(checks.profileId!==d.profile.id||checks.schemaVersion!=="regional-source-checks/v1"||!Array.isArray(checks.sources)||checks.sources.length!==d.config.sources.length)throw new Error("Retained source-check identity differs");
  for(const value of checks.sources){const row=object(value);if(typeof row.sourceId!=="string"||seen.has(row.sourceId)||!d.config.sources.some(source=>source.id===row.sourceId&&source.url===row.url)||!["reachable","unavailable"].includes(String(row.status))||typeof row.checkedAt!=="string"||!Number.isFinite(Date.parse(row.checkedAt))||!(row.httpStatus===null||typeof row.httpStatus==="number"&&Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599))throw new Error("Retained source-check roster differs");seen.add(row.sourceId);}
 }
}
