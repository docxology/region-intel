import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDeployment, deploymentPath, withDeployment, assertDeploymentMonitorSelection } from "../src/deployment.js";
import { renderRegionalSurface } from "../src/regional_surface.js";
import { defaultCivicProfile } from "../src/civic_profile.js";
import { readFileSync } from "node:fs";
test("real deployment accepts matching configuration and rejects cross-region policy", () => {
    const root = mkdtempSync(join(tmpdir(), "regional-deployment-"));
    try {
        const policy = JSON.parse(readFileSync(new URL("../configs/crescent-city-region.json", import.meta.url), "utf8"));
        writeFileSync(join(root, "civic.json"), JSON.stringify(defaultCivicProfile));
        writeFileSync(join(root, "policy.json"), JSON.stringify(policy));
        const config = { schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "output", seedDir: "seed", enabledMonitors: ["weather"], sources: [{ id: "city", name: "City <official>", url: "https://example.org", kind: "official" }] };
        writeFileSync(join(root, "region.json"), JSON.stringify(config));
        const d = loadDeployment(root);
        withDeployment(d, () => { expect(() => assertDeploymentMonitorSelection(["weather"])).not.toThrow(); expect(() => assertDeploymentMonitorSelection(["tides"])).toThrow(); expect(() => assertDeploymentMonitorSelection(undefined)).toThrow(); });
        expect(d.profile.id).toBe("crescent-city");
        expect(renderRegionalSurface(d)).toContain("City &lt;official&gt;");
        policy.profileId = "wrong-region";
        writeFileSync(join(root, "policy.json"), JSON.stringify(policy));
        expect(() => loadDeployment(root)).toThrow("differ");
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("consumer paths reject traversal and root adoption", () => { expect(() => deploymentPath("/tmp/test", "../foreign")).toThrow(); expect(() => deploymentPath("/tmp/test", ".")).toThrow(); });
test("actual CLI renders a configured second region and refuses a changed published identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "regional-cli-"));
    try {
        const profile = JSON.parse(readFileSync(new URL("../configs/example-civic.json", import.meta.url), "utf8"));
        const policy = JSON.parse(readFileSync(new URL("../configs/example-region.json", import.meta.url), "utf8"));
        writeFileSync(join(root, "civic.json"), JSON.stringify(profile));
        writeFileSync(join(root, "policy.json"), JSON.stringify(policy));
        writeFileSync(join(root, "region.json"), JSON.stringify({ schemaVersion: "region-deployment/v1", civicProfile: "civic.json", regionConfig: "policy.json", outputDir: "output", seedDir: "seed", enabledMonitors: ["weather"], sources: [{ id: "meetings", name: "Council", url: "https://example.invalid/meetings", kind: "meetings" }] }));
        const cli = new URL("../src/regional_cli.ts", import.meta.url).pathname;
        writeFileSync(join(root, "run.ts"), `import {runRegionalCli} from ${JSON.stringify(cli)};await runRegionalCli({root:import.meta.dir});`);
        const run = async (command: string) => { const p = Bun.spawn([process.execPath, join(root, "run.ts"), command], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, REGION_DEPLOYMENT: "region.json" } }); const stdout = await new Response(p.stdout).text(), stderr = await new Response(p.stderr).text(); return { code: await p.exited, stdout, stderr }; };
        expect((await run("validate")).code).toBe(0);
        expect((await run("geo:intel")).code).toBe(0);
        expect((await run("analytics")).code).toBe(0);
        const rendered = await run("pages:export");
        expect(rendered.stderr).toBe("");
        expect(rendered.code).toBe(0);
        expect((await run("pages:validate")).code).toBe(0);
        writeFileSync(join(root,".pages","private-extra.txt"),"must not publish");
        expect((await run("pages:validate")).code).not.toBe(0);
        rmSync(join(root,".pages","private-extra.txt"));
        writeFileSync(join(root,".pages","private-extra.txt"),"must not publish");
        expect((await run("pages:validate")).code).not.toBe(0);
        rmSync(join(root,".pages","private-extra.txt"));
        writeFileSync(join(root, ".pages", "region.json"), JSON.stringify({ profile: { id: "another-region" } }));
        expect((await run("pages:validate")).code).not.toBe(0);
        expect((await run("alerts:tides")).code).not.toBe(0);
        expect((await run("unknown-command")).code).not.toBe(0);
        const transport = new URL("../src/shared/transport.ts", import.meta.url).pathname;
        writeFileSync(join(root, "fixture.ts"), `import {runRegionalCli} from ${JSON.stringify(cli)};import {withTransportScope} from ${JSON.stringify(transport)};const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response('<a href="/agenda.pdf">Council agenda</a><a href="javascript:alert(1)">Meeting exploit</a>')}});try{await withTransportScope({fixture:{origin:server.url.origin,allowedOrigins:["https://example.invalid"]}},()=>runRegionalCli({root:import.meta.dir,args:["gov-meetings"]}));}finally{server.stop(true)}`);
        const fixture = Bun.spawn([process.execPath, join(root, "fixture.ts")], { cwd: root, stdout: "pipe", stderr: "pipe" });
        const errors = await new Response(fixture.stderr).text();
        expect(errors).toBe("");
        expect(await fixture.exited).toBe(0);
        const meetings = JSON.parse(readFileSync(join(root, "output", "regional-meetings.json"), "utf8"));
        expect(meetings.sources[0].documents).toEqual([{ url: "https://example.invalid/agenda.pdf", title: "Council agenda", meetingDate: null }]);
        meetings.sources[0].error = "/Users/operator/private failure";
        writeFileSync(join(root, "output", "regional-meetings.json"), JSON.stringify(meetings));
        mkdirSync(join(root, "output", "news"));
        writeFileSync(join(root, "output", "news", "fixture.json"), JSON.stringify({ items: [{ title: "Recorded news", link: "https://example.invalid/news", pubDate: "2026-10-30T00:00:00Z", source: "City" }] }));
        expect((await run("pages:export")).code).toBe(0);
        const html = readFileSync(join(root, ".pages", "index.html"), "utf8");
        expect(html).toContain("https://example.invalid/news");
        expect(html).toContain("2026-10-30T00:00:00Z");
        expect(html).not.toContain("/Users/operator");
        writeFileSync(join(root, ".pages", "index.html"), html + "<script>bad()</script>");
        expect((await run("pages:validate")).code).not.toBe(0);
        const regionalConfig=JSON.parse(readFileSync(join(root,"region.json"),"utf8"));regionalConfig.outputDir="crescent-output";writeFileSync(join(root,"region.json"),JSON.stringify(regionalConfig));writeFileSync(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));writeFileSync(join(root,"policy.json"),readFileSync(new URL("../configs/crescent-city-region.json",import.meta.url)));
        const disabled=await run("alerts:tides");expect(disabled.code).not.toBe(0);expect(disabled.stderr).toContain("not enabled");
        writeFileSync(join(root,"civic.json"),JSON.stringify({...defaultCivicProfile,name:"Forged city"}));const forged=await run("validate");expect(forged.code).not.toBe(0);expect(forged.stderr).toContain("Alternate civic profile");

    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("regional publication preserves healthy and unavailable evaluator results", async () => {
 const root=mkdtempSync(join(tmpdir(),"regional-health-"));
 try {
  writeFileSync(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));
  writeFileSync(join(root,"policy.json"),readFileSync(new URL("../configs/crescent-city-region.json",import.meta.url)));
  writeFileSync(join(root,"region.json"),JSON.stringify({schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:["weather"],sources:[]}));
  mkdirSync(join(root,"output","alerts","composite"),{recursive:true});
  const {computeAlertSeverity}=await import("../src/alerts/severity.ts");
  const {regionalObservations}=await import("../src/regional_surface.ts");
  for(const available of [true,false]){
   const report=computeAlertSeverity({warningCount:0,watchCount:0},{events:[]},{severities:[],count:0,available},{waterLevelFt:null,available:false},{closureActive:false,available:false});
   writeFileSync(join(root,"output","alerts","composite","current.json"),JSON.stringify(report));
   const observation=await regionalObservations(loadDeployment(root));
   expect(observation.alerts).toMatchObject({eligibleMonitorCount:1,unavailableMonitorCount:available?0:1,monitors:[{key:"weather",availability:available?"available":"unavailable"}]});
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});

test("terminating a compatibility runner also terminates its GUI child", async () => {
 const root=mkdtempSync(join(tmpdir(),"regional-shutdown-"));const abort=new AbortController();
 try {
  writeFileSync(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));
  writeFileSync(join(root,"policy.json"),readFileSync(new URL("../configs/crescent-city-region.json",import.meta.url)));
  writeFileSync(join(root,"region.json"),JSON.stringify({schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:[],sources:[]}));
  const reserve=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response("reserved")}}),port=reserve.port;reserve.stop(true);
  const cli=new URL("../src/regional_cli.ts",import.meta.url).pathname;
  writeFileSync(join(root,"entry.ts"),`import {writeFileSync} from "node:fs";import {runRegionalCli} from ${JSON.stringify(cli)};process.env.PORT=${JSON.stringify(String(port))};writeFileSync(new URL("pid",import.meta.url),String(process.pid));try{await runRegionalCli({root:import.meta.dir,args:["gui"]});}finally{writeFileSync(new URL("settled",import.meta.url),"settled");}`);
  const {runBoundedChild}=await import("../src/shared/subprocess.ts");
  const pending=runBoundedChild([process.execPath,join(root,"entry.ts")],{cwd:root,timeoutMs:15000,signal:abort.signal});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){ready=true;break;}}catch{}await Bun.sleep(50);}
  expect(ready).toBe(true);process.kill(Number(readFileSync(join(root,"pid"),"utf8")),"SIGTERM");
  const receipt=await pending;expect(receipt.status).toBe("failed");expect(receipt.reaped).toBe(true);expect(readFileSync(join(root,"settled"),"utf8")).toBe("settled");
  await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
 } finally {abort.abort();rmSync(root,{recursive:true,force:true});}
},20000);

test("alternate regional GUI serves HTML separately from API admission",async()=>{
 const root=mkdtempSync(join(tmpdir(),"regional-http-")),abort=new AbortController();
 try{
  writeFileSync(join(root,"civic.json"),readFileSync(new URL("../configs/example-civic.json",import.meta.url)));
  writeFileSync(join(root,"policy.json"),readFileSync(new URL("../configs/example-region.json",import.meta.url)));
  writeFileSync(join(root,"region.json"),JSON.stringify({schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:[],sources:[]}));
  const reserve=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response("reserved")}}),port=reserve.port;reserve.stop(true);
  const cli=new URL("../src/regional_cli.ts",import.meta.url).pathname;
  writeFileSync(join(root,"entry.ts"),`import {runRegionalCli} from ${JSON.stringify(cli)};process.env.PORT=${JSON.stringify(String(port))};await runRegionalCli({root:import.meta.dir,args:["gui"]});`);
  const {runBoundedChild}=await import("../src/shared/subprocess.ts");
  const pending=runBoundedChild([process.execPath,join(root,"entry.ts")],{cwd:root,timeoutMs:10000,signal:abort.signal});
  let response:Response|undefined;for(let i=0;i<100;i++){try{response=await fetch(`http://127.0.0.1:${port}/`);break;}catch{/* Await the real server binding. */}await Bun.sleep(25);}
  expect(response?.status).toBe(200);expect(await response!.text()).toContain("<title>Example Civic Platform</title>");
  expect((await fetch(`http://127.0.0.1:${port}/`,{method:"POST"})).status).toBe(405);
  expect((await fetch(`http://127.0.0.1:${port}/unknown`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${port}/api/openapi.yaml`)).status).toBe(200);
  abort.abort();expect((await pending).reaped).toBe(true);
 }finally{abort.abort();rmSync(root,{recursive:true,force:true});}
},15000);


test("long regional lists preserve every item behind expandable summaries", async()=>{
 const {renderRegionalSurface}=await import("../src/regional_surface.ts");
 const {load}=await import("cheerio");
 const root=mkdtempSync(join(tmpdir(),"region-list-surface-"));
 try{
  writeFileSync(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));
  writeFileSync(join(root,"policy.json"),readFileSync(new URL("../configs/crescent-city-region.json",import.meta.url)));
  writeFileSync(join(root,"region.json"),JSON.stringify({schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:[],sources:[]}));
  const d=loadDeployment(root);
  const news=Array.from({length:26},(_,i)=>({title:`News ${i}`,url:`https://example.org/news/${i}`}));
  const documents=Array.from({length:100},(_,i)=>({title:`Agenda ${i}`,url:`https://example.org/agenda/${i}`}));
  const $=load(renderRegionalSurface(d,{news,meetings:{sources:[{sourceId:"official",status:"ok",documents}]}}));
  const sections=$("main > section"),newsSection=sections.eq(0),meetings=sections.eq(1);
  expect(newsSection.children("ul").find("li").length).toBe(6);
  expect(newsSection.find("details li").length).toBe(20);
  expect(newsSection.find("details").attr("open")).toBeUndefined();
  expect(newsSection.find("a").length).toBe(26);
  expect(meetings.find("details a").length).toBe(100);
  expect(meetings.find("details").attr("open")).toBeUndefined();
 }finally{rmSync(root,{recursive:true,force:true});}
});
