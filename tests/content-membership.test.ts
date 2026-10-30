import {test,expect} from "bun:test";
import {selectArticleSections,getSectionGuids} from "../src/content.ts";
import {bindArticleExtraction,validateArticleCustody} from "../src/corpus_editions.ts";
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
