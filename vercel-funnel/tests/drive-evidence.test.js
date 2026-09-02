import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
await mock.module('../api/_core.js',{namedExports:{body:()=>{},init:()=>{},json:()=>{},operator:()=>{},sql:()=>{throw Error('no database expected');}}});
const {printableCard,existingDriveResult}=await import('../api/drive.js');
test('Drive card uses Zoom click, never application creation date',()=>{
 const f={candidate:{created_at:'2026-01-01'},test:{submitted_at:'2026-08-30T10:00:00Z'},application:{garcia_confirmed:true}};
 assert.match(printableCard(f),/Нет достоверного интервала/);assert.match(printableCard(f),/✓ Да/);
 f.candidate.primary_zoom_clicked_at='2026-08-30T09:00:00Z';assert.match(printableCard(f),/1 ч. 0 мин./);
 f.candidate.primary_zoom_clicked_at='2026-08-30T11:00:00Z';assert.match(printableCard(f),/Нет достоверного интервала/);
});

test('existing candidate Drive artifact is returned unchanged',()=>{
 const result=existingDriveResult({folder_id:'folder-1',folder_url:'https://drive.google.com/folder-1',folder_name:'Кандидат'});
 assert.deepEqual(result,{existing:true,unchanged:true,folder:{id:'folder-1',url:'https://drive.google.com/folder-1',name:'Кандидат'},files:[]});
 assert.equal(existingDriveResult(null),null);
});
