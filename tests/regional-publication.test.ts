import {test,expect} from "bun:test";
import {mkdtemp,writeFile,mkdir,rm,symlink,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyGitPublication,checkRegionalPublication} from "../src/regional_publication";
async function git(root:string,...args:string[]){const c=Bun.spawn(["git","-c","core.fsmonitor=false",...args],{cwd:root,stdin:"ignore",stdout:"pipe",stderr:"pipe"});const out=new Response(c.stdout).text(),err=new Response(c.stderr).text();if(await c.exited!==0)throw new Error(await err);return(await out).trim();}
async function fixture(){const root=await mkdtemp(join(tmpdir(),"publication-git-"));await git(root,"init");await git(root,"config","user.name","Local test");await git(root,"config","user.email","test@example.invalid");await writeFile(join(root,"source.md"),"Accepted source\n");await writeFile(join(root,"binary.dat"),new Uint8Array([0,255,128,65]));await git(root,"add",".");await git(root,"commit","-m","Synthetic baseline");return root;}
test("HEAD and index verify actual text/binary Git blobs; dirty bytes fail until staged",async()=>{
 const root=await fixture();try{
  const baseline=await verifyGitPublication(root,["source.md","binary.dat"]);
  expect(baseline.files).toBe(2);expect(baseline.bytes).toBe(20);
  expect((await verifyGitPublication(root,["binary.dat","source.md"],"index")).fileSetSha256).toBe(baseline.fileSetSha256);
  await writeFile(join(root,"source.md"),"Changed source\n");
  await expect(verifyGitPublication(root,["source.md"])).rejects.toThrow("differ from HEAD");
  await expect(verifyGitPublication(root,["source.md"],"index")).rejects.toThrow("differ from index");
  await git(root,"add","source.md");
  expect((await verifyGitPublication(root,["source.md"],"index")).files).toBe(1);
  await expect(verifyGitPublication(root,["source.md"])).rejects.toThrow("differ from HEAD");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("ignored required nested output assets and absent files cannot pass publication",async()=>{
 const root=await fixture();try{
  await writeFile(join(root,".gitignore"),"output/\n");
  await mkdir(join(root,"web/output"),{recursive:true});await writeFile(join(root,"web/output/module.js"),"export const ready=true;\n");
  await git(root,"add",".gitignore");
  await expect(verifyGitPublication(root,["web/output/module.js"],"index")).rejects.toThrow("not a tracked");
  await writeFile(join(root,".gitignore"),"/output/\n");await git(root,"add",".gitignore","web/output/module.js");
  expect((await verifyGitPublication(root,["web/output/module.js"],"index")).files).toBe(1);
  await expect(verifyGitPublication(root,["missing.bin"],"index")).rejects.toThrow("not a tracked");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("symlink entries, noncanonical/duplicate paths and nested checkouts fail closed",async()=>{
 const root=await fixture();try{
  await symlink("source.md",join(root,"alias"));await git(root,"add","alias");
  await expect(verifyGitPublication(root,["alias"],"index")).rejects.toThrow("symlinks");
  await expect(verifyGitPublication(root,["source.md","source.md"])).rejects.toThrow("path set");
  await expect(verifyGitPublication(root,["../source.md"])).rejects.toThrow();
  await expect(verifyGitPublication(root,["./source.md"])).rejects.toThrow("canonical");
  await expect(verifyGitPublication(root,["source.md"],"bogus" as "HEAD")).rejects.toThrow("reference");
  await mkdir(join(root,"nested"));
  await expect(verifyGitPublication(join(root,"nested"),["file"])).rejects.toThrow("own Git checkout");
 }finally{await rm(root,{recursive:true,force:true});}
});

import {loadDeployment} from "../src/deployment";
import {defaultCivicProfile} from "../src/civic_profile";
import {publicationCoreFiles,PUBLICATION_OPTIONAL_FILES} from "../src/publication_bundle";
import {readFile} from "node:fs/promises";
test("regional closure captures the actual selected deployment without asserting semantic acceptance",async()=>{
 const root=await fixture();try{
  await writeFile(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));
  await writeFile(join(root,"policy.json"),await readFile(join(import.meta.dir,"../configs/crescent-city-region.json")));
  const config={schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:["weather"],sources:[]};
  await writeFile(join(root,"alternate.json"),JSON.stringify(config));
  await mkdir(join(root,"seed"));for(const name of [...publicationCoreFiles(),"publication-input.json"])await writeFile(join(root,"seed",name),"{}");
  await mkdir(join(root,"scripts"));await writeFile(join(root,"scripts/region.ts"),"// Synthetic command entry\n");
  await writeFile(join(root,"package.json"),"{}");await writeFile(join(root,"bun.lock"),"fixture");
  await git(root,"add",".");await git(root,"commit","-m","Synthetic selected closure");
  const d=loadDeployment(root,"alternate.json");
  const result=await checkRegionalPublication(d,"HEAD","alternate.json") as {manuscript:unknown;files:number};
  expect(result.manuscript).toBeNull();expect(result.files).toBeGreaterThan(7);
  await writeFile(join(root,"alternate.json"),JSON.stringify({...config,enabledMonitors:[]}));
  await expect(checkRegionalPublication(d,"HEAD","alternate.json")).rejects.toThrow("deployment differs");
  await expect(verifyGitPublication(root,["alternate.json"],"HEAD")).rejects.toThrow("differ from HEAD");
 }finally{await rm(root,{recursive:true,force:true});}
});

async function optionalClosureFixture(target: string) {
 const root=await fixture();
 await writeFile(join(root,"civic.json"),JSON.stringify(defaultCivicProfile));
 await writeFile(join(root,"policy.json"),await readFile(join(import.meta.dir,"../configs/crescent-city-region.json")));
 await writeFile(join(root,"region.json"),JSON.stringify({schemaVersion:"region-deployment/v1",civicProfile:"civic.json",regionConfig:"policy.json",outputDir:"output",seedDir:"seed",enabledMonitors:["weather"],sources:[]}));
 await mkdir(join(root,"seed"));for(const name of [...publicationCoreFiles(),"publication-input.json"])await writeFile(join(root,"seed",name),"{}");
 await mkdir(join(root,"scripts"));await writeFile(join(root,"scripts/region.ts"),"// Synthetic entry\n");
 await writeFile(join(root,"package.json"),"{}");await writeFile(join(root,"bun.lock"),"fixture");
 await mkdir(join(root,"docs/manuscript"),{recursive:true});await writeFile(join(root,target),"{}");
 await git(root,"add",".");await git(root,"commit","-m","Synthetic optional closure");
 return {root,d:loadDeployment(root)};
}
const seedOptional=PUBLICATION_OPTIONAL_FILES[0];
if(!seedOptional)throw new Error("Optional public seed required for this control");
for(const target of ["seed/"+seedOptional,"docs/manuscript/config.json"]){
 test("tracked optional deletion must match selected HEAD/index: "+target,async()=>{
  const {root,d}=await optionalClosureFixture(target);try{
   if(target.startsWith("seed/"))await checkRegionalPublication(d);
   await unlink(join(root,target));
   await expect(checkRegionalPublication(d)).rejects.toThrow();
   await expect(checkRegionalPublication(d,"index")).rejects.toThrow();
   await git(root,"add","-u");
   expect(await checkRegionalPublication(d,"index")).toHaveProperty("reference","index");
   await expect(checkRegionalPublication(d)).rejects.toThrow();
  }finally{await rm(root,{recursive:true,force:true});}
 });
}
