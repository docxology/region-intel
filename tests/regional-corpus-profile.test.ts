import { test, expect } from "bun:test";
import { profileCorpus, profileCsv } from "../src/regional_corpus_profile.ts";
const article=(guid:string,sections:number,title="Recorded article")=>({guid,number:guid,title,sections:Array.from({length:sections},(_,i)=>({guid:String(i)}))});
test("complete finite profile agrees with a constructed arithmetic oracle, including zero and even medians",()=>{
    const p=profileCorpus({articles:[article("a",2),article("b",0),article("c",4)]});
    expect([p.totalArticles,p.totalSections,p.minSections,p.medianSections,p.maxSections,p.emptyArticles]).toEqual([3,6,0,2,4,1]);
    expect(profileCorpus({articles:[article("a",1),article("b",5)]}).medianSections).toBe(3);
    expect(profileCsv(profileCorpus({articles:[article("a",1,'A, "quoted" title')]}))).toBe('guid,article_number,title,section_records\n"a","a","A, ""quoted"" title",1\n');
});
test("empty, malformed and duplicate article identities cannot silently alter a profile denominator",()=>{
    for(const value of [null,{}, {articles:[]}, {articles:[article("a",1),article("a",2)]}, {articles:[{guid:"a",number:"1",title:"Broken",sections:"not an array"}]}]) expect(()=>profileCorpus(value)).toThrow();
});
