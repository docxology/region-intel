import {afterAll, expect, test} from 'bun:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventory, validateMembers, sameNames} from '../src/regional_manuscript_members';
import {publicationHash} from '../src/publication_bundle';
const roots:string[]=[];
async function fixture(){const root=await mkdtemp(join(tmpdir(),'regional-members-'));roots.push(root);return root;}
afterAll(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});

test('complete exact members pass and changed bytes or rehashed projections fail',async()=>{
 const root=await fixture();await writeFile(join(root,'a'),'source');
 const hashes={a:publicationHash('source')};
 await validateMembers(root,hashes,['a'],{a:'source'});
 await writeFile(join(root,'a'),'changed');
 await expect(validateMembers(root,hashes,['a'],{a:'source'})).rejects.toThrow('bytes differ');
 await expect(validateMembers(root,{a:publicationHash('changed')},['a'],{a:'source'})).rejects.toThrow('projection differs');
});
test('a comma-containing member cannot replace two required members',async()=>{
 const root=await fixture();await writeFile(join(root,'a,b'),'combined substitute');
 await expect(validateMembers(root,{'a,b':publicationHash('combined substitute')},['a','b'],{})).rejects.toThrow('member set differs');
});
test('an undeclared prototype-named file is counted and rejected',async()=>{
 const root=await fixture();await writeFile(join(root,'a'),'source');await writeFile(join(root,'__proto__'),'undeclared');
 expect(Object.keys(await inventory(root)).sort()).toEqual(['__proto__','a']);
 await expect(validateMembers(root,{a:publicationHash('source')},['a'],{a:'source'})).rejects.toThrow('member set differs');
});

test('field-name equality preserves boundaries and ignores ordering',()=>{
 expect(sameNames(['pandoc,pandoc-crossref'],['pandoc','pandoc-crossref'])).toBe(false);
 expect(sameNames(['b','a'],['a','b'])).toBe(true);
 expect(sameNames(['a','a'],['a','b'])).toBe(false);
});
