import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
await mock.module('../api/_core.js',{namedExports:{body:()=>{},init:()=>{},json:()=>{},operator:()=>{},sql:()=>{throw Error('no database expected');}}});
const {printableCard,testAnswersCsv}=await import('../api/drive.js');
test('native Test 1 export has 20 columns on every row including metadata',()=>{
 const text=testAnswersCsv({candidate:{id:1,city:'Тест'},application:{full_name:'Тест'},test:{submitted_at:'2026-08-31',answers:Array(200).fill('+')}});
 const rows=text.replace(/^\uFEFF/,'').split('\r\n');
 assert.equal(rows.length,47);for(const row of rows)assert.equal(row.split(';').length,20);
});
test('Drive card uses Zoom click, never application creation date',()=>{
 const f={candidate:{created_at:'2026-01-01'},test:{submitted_at:'2026-08-30T10:00:00Z'},application:{garcia_confirmed:true}};
 assert.match(printableCard(f),/Нет достоверного интервала/);assert.match(printableCard(f),/✓ Да/);
 f.candidate.primary_zoom_clicked_at='2026-08-30T09:00:00Z';assert.match(printableCard(f),/1 ч. 0 мин./);
 f.candidate.primary_zoom_clicked_at='2026-08-30T11:00:00Z';assert.match(printableCard(f),/Нет достоверного интервала/);
});
