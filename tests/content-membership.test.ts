import {test,expect} from "bun:test";
import {selectArticleSections,getSectionGuids} from "../src/content.ts";
import {bindArticleExtraction,validateArticleCustody,custodyHash} from "../src/corpus_editions.ts";
import {isArticleArtifactShapeValid} from "../src/scraper_utils.ts";
import type {ArticlePage,TocNode} from "../src/types.ts";
const captured=await Bun.file(new URL("fixtures/davis-content/article-before.json",import.meta.url)).json() as ArticlePage;
const article=await Bun.file(new URL("fixtures/davis-content/toc-44632455.json",import.meta.url)).json() as TocNode;
const expected=getSectionGuids(article).map(section=>section.guid);
test("captured Davis combined page scopes exact article membership without losing custody",()=>{
 expect(expected.length).toBe(14);expect(captured.sections.length).toBe(37);
 expect(isArticleArtifactShapeValid(captured,expected,true)).toBe(false);
 const selected=bindArticleExtraction({...captured,sections:selectArticleSections(article,captured.sections)});
 expect(selected.rawHtml).toBe(captured.rawHtml);
 expect(selected.sections.map(section=>section.guid)).toEqual(expected);
 expect(isArticleArtifactShapeValid(selected,expected,true)).toBe(true);
 expect(validateArticleCustody(selected,expected,true)).toEqual([]);
});
test("scoping cannot turn a missing section or changed source content into complete evidence",()=>{
 const selected=selectArticleSections(article,captured.sections);
 const missing=bindArticleExtraction({...captured,sections:selected.slice(1)});
 expect(isArticleArtifactShapeValid(missing,expected,true)).toBe(false);
 expect(validateArticleCustody(missing,expected,true).length).toBeGreaterThan(0);
 const changed=bindArticleExtraction({...captured,sections:selected.map((section,index)=>index?section:{...section,text:"tampered section"})});
 expect(validateArticleCustody(changed,expected,true).length).toBeGreaterThan(0);
});


const inactiveCaptures = await Bun.file(new URL("fixtures/davis-content/inactive-sections.json", import.meta.url)).json() as ArticlePage[];
test("captured source-marked inactive sections retain empty bodies with exact heading custody", () => {
 for (const captured of inactiveCaptures) {
  const expected = captured.sections.map(section=>section.guid);
  const bound = bindArticleExtraction(captured);
  expect(isArticleArtifactShapeValid(bound,expected,true)).toBe(true);
  expect(validateArticleCustody(bound,expected,true)).toEqual([]);
  const missingMarker = bindArticleExtraction({...captured, sections:captured.sections.map(section=>({...section,title:"Active requirements"}))});
  expect(isArticleArtifactShapeValid(missingMarker,expected,true)).toBe(false);
  const changedSource = captured.rawHtml.replace(/Reserved|Repealed/gi,"Active");
  const falseMarker = bindArticleExtraction({...captured,rawHtml:changedSource,sha256:custodyHash(changedSource)});
  expect(validateArticleCustody(falseMarker,expected,true).length).toBeGreaterThan(0);
 }
});

test("inactive markers cannot be inferred from prose or changed between reserved and repealed", async()=>{
 const {inactiveSectionStatus}=await import("../src/scraper_utils.ts");
 for(const text of ["All rights reserved", "Repealed requirements", "Preserved", "Requirements. (Repealed by unknown)", "Reserved procedures."]) expect(inactiveSectionStatus(text)).toBeNull();
 for(const captured of inactiveCaptures){
  const opposite=inactiveSectionStatus(captured.sections[0]!.title)==="reserved"?"Requirements. (Repealed by Ord. 1.)":"Requirements. (Reserved)";
  const changed=bindArticleExtraction({...captured,sections:captured.sections.map(section=>({...section,title:opposite}))});
  expect(validateArticleCustody(changed,captured.sections.map(section=>section.guid),true).length).toBeGreaterThan(0);
 }
});

test("deep inactive sections require the same source marker and exact fragment bytes",()=>{
 for(const captured of inactiveCaptures){
  const guid=captured.sections[0]!.guid,expected=[guid];
  const source={guid,url:`https://ecode360.com/${guid}`,html:captured.rawHtml,sha256:custodyHash(captured.rawHtml)};
  const deep=bindArticleExtraction(captured,"section-pages",[source]);
  expect(validateArticleCustody(deep,expected,true)).toEqual([]);
  const changed=source.html.replace(/Reserved|Repealed/gi,"Active");
  const invalid=bindArticleExtraction(captured,"section-pages",[{...source,html:changed,sha256:custodyHash(changed)}]);
  expect(validateArticleCustody(invalid,expected,true).length).toBeGreaterThan(0);
 }
});
