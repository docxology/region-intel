#!/usr/bin/env bun
import { resolve, join } from "node:path";
import { mkdir, writeFile, mkdtemp, readdir } from "node:fs/promises";
import { writeTextAtomic } from "./shared/source_health.js";
import { promotePublicationDirectory } from "./publication_bundle.js";
import { loadDeployment, deploymentPath } from "./deployment.js";
import { renderRegionalSurface, regionalObservations } from "./regional_surface.js";
export async function runRegionalCli(options: {
    root: string;
    args?: string[];
}): Promise<void> {
    const args = options.args ?? Bun.argv.slice(2), command = args[0] ?? "status", rest = args.slice(1);
    const d = loadDeployment(options.root, process.env.REGION_DEPLOYMENT ?? "region.json");
    process.env.CIVIC_PROFILE = join(d.root, d.config.civicProfile);
    process.env.REGION_CONFIG = join(d.root, d.config.regionConfig);
    process.env.CC_OUTPUT_DIR = d.output;
    process.env.REGION_ROOT = d.root;
    const packageRoot = resolve(import.meta.dir, "..");
    if (command === "publication:check") {
        if (rest.length && !(rest.length === 1 && rest[0] === "--staged")) throw new Error("Expected optional --staged");
        const { checkRegionalPublication } = await import("./regional_publication.js");
        console.log(JSON.stringify(await checkRegionalPublication(d, rest.length ? "index" : "HEAD", process.env.REGION_DEPLOYMENT ?? "region.json"), null, 2));
        return;
    }
    const localManuscript = await Bun.file(join(d.root,"docs/manuscript/config.json")).exists();
    if(command.startsWith("manuscript:") && (localManuscript || ["manuscript:render","manuscript:validate-render","manuscript:bundle"].includes(command))) {
      if(rest.length && !(command==="manuscript:validate-render"&&rest.length===1&&rest[0]==="--bundle"))throw new Error("Unexpected regional manuscript arguments");
      const methods=await import("./regional_manuscript.js");
      if(command==="manuscript:check")console.log(JSON.stringify(await methods.checkRegionalManuscript(d),null,2));
      else if(command==="manuscript:hydrate")console.log(await methods.buildRegionalManuscript(d));
      else if(command==="manuscript:render")console.log(await methods.buildRegionalManuscript(d,true));
      else if(command==="manuscript:bundle")console.log(await methods.packageRegionalManuscript(d));
      else if(command==="manuscript:validate-render"){await methods.validateRegionalRender(d,rest.includes("--bundle")?"bundle":undefined);console.log("Regional manuscript exact-byte/current-input validation passed");}
      else throw new Error("Unsupported regional manuscript command");
      return;
    }
    if(command === "cron-setup" || command === "lifeos:daily") {
      if(!(await import("./civic_profile.js")).isCrescentCityProfile(d.profile)) throw new Error("This compatibility integration is not configured for the selected region");
      if(command === "cron-setup") {
        const child=Bun.spawn([process.execPath,join(packageRoot,"scripts/scheduler-plan.ts"),...rest],{cwd:d.root,env:process.env,stdout:"inherit",stderr:"inherit",stdin:"inherit"});
        const exit=await waitForRegionalChild(child);if(exit!==0)throw new Error(`${command} failed with exit code ${exit}`);return;
      }
      let stopping=false;const stop=()=>{stopping=true;};const failed:string[]=[];
      process.once("SIGTERM",stop);process.once("SIGINT",stop);
      try {
        for(const step of ["news","gov-meetings","alerts","lifeos:bridge"]) {
          if(stopping)throw new Error("Daily integration cancelled");
          try {await runRegionalCli({root:d.root,args:[step]});} catch(error) {if(stopping)throw error;failed.push(step);console.error(`${step} failed: ${error instanceof Error?error.message:String(error)}`);}
        }
        if(failed.length)throw new Error(`Daily integration failed steps: ${failed.join(", ")}`);
      } finally {process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop);}
      return;
    }
    if(["corpus:check","corpus:promote"].includes(command) || command==="pages:seed" && !(await import("./civic_profile.js")).isCrescentCityProfile(d.profile)) {
      const position=rest.indexOf("--source"),source=position>=0?rest[position+1]:undefined;
      if(rest.length && (rest.length!==2||position!==0||!source||source.startsWith("--")))throw new Error("Expected --source <consumer-relative candidate root>");
      const corpus=await import("./regional_corpus.js");
      if(command==="corpus:promote"&&!source)throw new Error("corpus:promote requires --source");
      const result=command==="corpus:check"?await corpus.checkRegionalCorpus(d,source):command==="corpus:promote"?await corpus.promoteRegionalCorpus(d,source!):await corpus.seedRegionalCorpus(d,source);
      console.log(JSON.stringify(result,null,2));return;
    }
    if (command === "validate") {
        const manifest = await Bun.file(join(packageRoot, "package.json")).json();
        if (manifest.name !== "region-intel")
            throw new Error("Installed dependency is not region-intel");
        const { bindCivicOutputRoot, currentCivicProfile } = await import("./civic_profile.js");
        currentCivicProfile();
        await bindCivicOutputRoot(d.output);
        const { buildGeoIntel } = await import("./geo.js");
        const geo = buildGeoIntel();
        if (!geo)
            throw new Error("Shared geographic builder unavailable");
        console.log(JSON.stringify({ profileId: d.profile.id, package: manifest.name, version: manifest.version, outputIdentity: "bound", validation: "installed shared package, configuration and isolated output accepted; no live provider certification" }, null, 2));
        return;
    }
    if (command === "status" || command === "civic:profile" || command === "region:config") {
        console.log(JSON.stringify({ profile: d.profile, policy: d.policy.id, enabledMonitors: d.config.enabledMonitors, sources: d.config.sources.length, validation: "configuration accepted; live providers not certified" }, null, 2));
        return;
    }
    if (command === "all") {
        for (const step of ["scrape", "verify", "export"])
            await runRegionalCli({ root: d.root, args: [step, ...rest] });
        return;
    }
    const packageCommands = ["manuscript:check", "manuscript:hydrate", "docs:check", "docs:generate", "typecheck", "test:typecheck"];
    if ((await import("./civic_profile.js")).isCrescentCityProfile(d.profile) && !command.startsWith("alerts") || packageCommands.includes(command)) {
        const manifest = await Bun.file(join(packageRoot, "package.json")).json() as {
            scripts: Record<string, string>;
        };
        const invocation = manifest.scripts[command];
        const match = invocation?.match(/^bun run ((?:src|scripts|tests)\/[^ ]+\.ts)(.*)$/);
        if (match) {
            const child = Bun.spawn([process.execPath, join(packageRoot, match[1]!), ...match[2]!.trim().split(/\s+/).filter(Boolean), ...rest], { cwd: packageCommands.includes(command) || command.startsWith("test:") ? packageRoot : d.root, env: process.env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
            const exit = await waitForRegionalChild(child);
            if (exit !== 0)
                throw new Error(`${command} failed with exit code ${exit}`);
            return;
        }
    }
    const { bindCivicOutputRoot } = await import("./civic_profile.js");
    await bindCivicOutputRoot(d.output);
    if (command === "geo:intel") {
        const { buildGeoIntel } = await import("./geo.js");
        const { writeJsonAtomic } = await import("./shared/source_health.js");
        await writeJsonAtomic(join(d.output, "geo-intel.json"), buildGeoIntel());
        return;
    }
    if (command === "analytics" || command === "insights") {
        const observations = await regionalObservations(d);
        const { writeJsonAtomic } = await import("./shared/source_health.js");
        const report = { schemaVersion: "regional-observation-summary/v1", profileId: d.profile.id, generatedAt: new Date().toISOString(), newsItems: Array.isArray(observations.news) ? observations.news.length : 0, alerts: observations.alerts, meetings: observations.meetings, trendComparability: "No repeated comparable sampling windows established", sourceCount: d.config.sources.length };
        await writeJsonAtomic(join(d.output, `${command}.json`), report);
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    if (command === "weekly-check") {
        const steps = ["source-discovery", "news", "gov-meetings", ...(d.config.enabledMonitors.length ? ["alerts"] : []), "geo:intel", "analytics", "pages:export", "pages:validate"];
        const receipts = [];
        for (const step of steps) {
            try {
                await runRegionalCli({ root: d.root, args: [step] });
                receipts.push({ step, status: "completed" });
            }
            catch (error) {
                receipts.push({ step, status: "failed", error: error instanceof Error ? error.message : "Failed" });
            }
        }
        const { writeJsonAtomic } = await import("./shared/source_health.js");
        await writeJsonAtomic(join(d.output, "state", "latest-pipeline-run.json"), { schemaVersion: "regional-pipeline/v1", profileId: d.profile.id, completedAt: new Date().toISOString(), steps: receipts });
        if (receipts.some(r => r.status === "failed"))
            throw new Error("Regional pipeline has failed steps; see latest-pipeline-run.json");
        return;
    }
    if (command === "source-discovery") {
        const report = { schemaVersion: "regional-source-catalog/v1", profileId: d.profile.id, generatedAt: new Date().toISOString(), sources: d.config.sources.map(s => ({ ...s, status: "not-checked" })) };
        await writeTextAtomic(deploymentPath(d.root,d.config.outputDir+"/source-catalog.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
        return;
    }
    if (command === "alerts" || command === "alerts:all" || command.startsWith("alerts:")) {
        const selection = rest.find(arg => arg.startsWith("--only="));
        const selected = selection ? selection.slice(7).split(",") : command.includes(":") && command !== "alerts:all" ? [command.slice(7)] : d.config.enabledMonitors;
        if (!selected.length || new Set(selected).size !== selected.length || selected.some(k => !d.config.enabledMonitors.includes(k)))
            throw new Error("Monitor is not enabled for this deployment");
        const { withDeployment } = await import("./deployment.js");
        const { runAllAlertMonitors } = await import("./alerts/batch.js");
        await withDeployment(d, () => runAllAlertMonitors({ only: selected as import("./alerts/composite.js").MonitorKey[], notifications: false, outputDir: d.output }));
        return;
    }
    if (command === "gov-meetings") {
        const { boundedHttpFetch } = await import("./shared/transport.js");
        const { load } = await import("cheerio");
        const sources = [];
        for (const source of d.config.sources.filter(s => s.kind === "meetings")) {
            try {
                const response = await boundedHttpFetch(source.url, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const html = await response.text(), $ = load(html);
                const links = new Map<string, string>();
                $("a[href]").each((_i, a) => { const title = $(a).text().trim(), href = $(a).attr("href"); if (!href || !title || !/agenda|minutes|meeting/i.test(title + href))
                    return; const url = new URL(href, source.url); if (url.protocol !== "https:" || url.username || url.password)
                    return; links.set(url.href, title.slice(0, 500)); });
                sources.push({ sourceId: source.id, url: source.url, status: links.size ? "ok" : "empty", retrievedAt: new Date().toISOString(), documents: [...links].slice(0, 100).map(([url, title]) => ({ url, title, meetingDate: null })) });
            }
            catch (error) {
                sources.push({ sourceId: source.id, url: source.url, status: "unavailable", error: error instanceof Error ? error.message : "Collection failed" });
            }
        }
        await writeTextAtomic(deploymentPath(d.root,d.config.outputDir+"/regional-meetings.json"), JSON.stringify({ profileId: d.profile.id, sources }, null, 2));
        return;
    }
    if (command === "news") {
        const { monitorNews } = await import("./news_monitor.js");
        await monitorNews(undefined, { feeds: Object.fromEntries(d.config.sources.filter(s => s.feedUrl).map(s => [s.name, s.feedUrl!])), outputDir: d.output });
        return;
    }
    if (command === "pages:export") {
        const destination = deploymentPath(d.root, ".pages"), observations = await regionalObservations(d), corpus = await (await import("./regional_corpus.js")).regionalCorpusPublication(d), html = renderRegionalSurface(d, observations, {corpus:corpus.summary});
        const receipt = { schemaVersion: "regional-pages/v1", profile: d.profile, sources: d.config.sources, enabledMonitors: d.config.enabledMonitors, observations, corpus:corpus.summary, htmlSha256: new Bun.CryptoHasher("sha256").update(html).digest("hex") };
        const staging = await mkdtemp(join(d.root,".pages-build-"));
        await writeTextAtomic(join(staging,"index.html"),html);
        for(const [name,bytes] of Object.entries(corpus.files))await writeTextAtomic(join(staging,name),bytes);
        await writeTextAtomic(join(staging,"region.json"),JSON.stringify(receipt,null,2));
        await promotePublicationDirectory(staging,destination);
        return;
    }
    if (command === "pages:validate") {
        const target = deploymentPath(d.root, rest.find(a => !a.startsWith("--")) ?? ".pages"), observations = await regionalObservations(d), corpus=await (await import("./regional_corpus.js")).regionalCorpusPublication(d), expectedHtml = renderRegionalSurface(d, observations,{corpus:corpus.summary});
        const expected = { schemaVersion: "regional-pages/v1", profile: d.profile, sources: d.config.sources, enabledMonitors: d.config.enabledMonitors, observations, corpus:corpus.summary, htmlSha256: new Bun.CryptoHasher("sha256").update(expectedHtml).digest("hex") };
        const entries = await readdir(target,{withFileTypes:true});
        const expectedNames=["region.json","index.html",...Object.keys(corpus.files)];
        if(entries.length!==expectedNames.length || entries.some(entry=>!entry.isFile()||entry.isSymbolicLink()||!expectedNames.includes(entry.name))) throw new Error("Unexpected regional publication member");
        const {captureArtifactBytes}=await import("./artifact_custody.js");
        const decode=(bytes:Uint8Array)=>new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        const region=decode(await captureArtifactBytes(join(target,"region.json"),8*1024*1024)),html=decode(await captureArtifactBytes(join(target,"index.html"),8*1024*1024));
        for(const [name,bytes] of Object.entries(corpus.files))if(decode(await captureArtifactBytes(join(target,name),16_000_000))!==bytes)throw new Error("Published municipal corpus differs from verified source");
        if (region !== JSON.stringify(expected, null, 2) || html !== expectedHtml)
            throw new Error("Published regional bytes differ from configured source-derived edition");
        console.log("Regional Pages exact-byte source replay passed");
        return;
    }
    if (command === "gui") {
        const { handleApiRoute } = await import("./gui/routes.js");
        const { initSearch } = await import("./gui/search.js");
        await initSearch();
        const { applyMiddleware } = await import("./api/middleware.js");
        const server = Bun.serve({hostname:process.env.HOST??"127.0.0.1",port:Number(process.env.PORT??3000),async fetch(request,server){
          const url=new URL(request.url);
          if(url.pathname==="/") {
            if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
            return new Response(request.method==="HEAD"?null:renderRegionalSurface(d,await regionalObservations(d),{localApi:true}),{headers:{"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff"}});
          }
          if(!url.pathname.startsWith("/api/"))return new Response("Not found",{status:404});
          const blocked=await applyMiddleware(request,server.requestIP(request)?.address);if(blocked)return blocked;
          return handleApiRoute(url,request);
        }});
        console.log(`Regional GUI: ${server.url}`);
        return;
    }
    const commands: Record<string, string> = { scrape: "src/scrape.ts", verify: "src/verify.ts", export: "src/export.ts", events: "src/events.ts", "geo:intel": "src/geo.ts", analytics: "scripts/run-analytics.ts", insights: "scripts/run-insights.ts", readability: "scripts/run-readability.ts", query: "src/llm/index.ts", chat: "src/llm/index.ts", index: "src/llm/index.ts" };
    const script = commands[command];
    if (!script)
        throw new Error(`Unsupported regional command: ${command}`);
    const child = Bun.spawn([process.execPath, join(packageRoot, script), ...(["query", "chat", "index"].includes(command) ? [command] : []), ...rest], { cwd: d.root, env: process.env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    const exit = await waitForRegionalChild(child);
    if (exit !== 0)
        throw new Error(`${command} failed with exit code ${exit}`);
}

if (import.meta.main) await runRegionalCli({ root: process.env.REGION_ROOT ?? process.cwd() });

async function waitForRegionalChild(child: Pick<Bun.Subprocess,"exited"|"kill">): Promise<number> {
 const stop=()=>child.kill("SIGTERM"), interrupt=()=>child.kill("SIGINT");
 process.once("SIGTERM",stop);process.once("SIGINT",interrupt);
 try {return await child.exited;} finally {process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",interrupt);}
}
