import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {interviewPayload, splitJobs} from '../lib/interview-sheet.js';

test('all Q2 fields map directly, no invented decisions, dates, or formula values', () => {
  const answers = {goals:'Цель',achievements:'Достижения',income:'3000$ через год',strengths:'Навыки',development:'Развитие',hobbies:'Хобби',family:'Нет',children:'Нет',readiness:0,work_history:'Орг / Сфера / Роль / 2020-2025'};
  const p = interviewPayload({candidate:{id:1,username:'sample'},application:{full_name:'Имя',garcia_confirmed:false,motivation:'Мотивация'},questionnaireTwo:{answers},test:{submitted_at:'2026-08-31',answers:Array(200).fill('+')}});
  const get = (s,c) => p.cells.find(x => x.sheet === s && x.cell === c)?.text;
  assert.equal(get('Начало','B35'),'Цель');
  assert.equal(get('Начало','B38'),'Достижения');
  assert.equal(get('Итог','F16'),'3000$ через год');
  assert.equal(get('Итог','F59'),'0');
  assert.equal(get('Работа 1','F10'),'Роль');
  assert.match(get('Начало','B14'),/Не отмечено/);
  assert.equal(get('Начало','F9'),undefined);
  assert.equal(get('Итог','F17'),undefined);
  assert.equal(get('Начало','B70'),undefined);
  assert.equal(get('Начало','F76'),undefined);
  assert.ok(p.cells.every(c => !c.source.includes('Тест')));
  for (const value of Object.values(answers)) assert.ok(p.cells.some(c => c.text === String(value)));
});

test('interview takes only Q1 and Q2; Test 1 data cannot affect any field', () => {
  const input = {candidate:{id:2,username:'candidate',phone:'123'},application:{full_name:'ФИО',city:'Минск',age:32,motivation:'Ответ анкеты 1',garcia_confirmed:true},questionnaireTwo:{answers:{goals:'Ответ анкеты 2'}}};
  const expected = interviewPayload(input);
  assert.deepEqual(interviewPayload({...input,test:{submitted_at:'2026-08-31',answers:Array(200).fill('+'),score:100}}),expected);
  assert.deepEqual(interviewPayload({...input,test:{submitted_at:null,answers:[]}}),expected);
  assert.ok(expected.cells.some(c=>c.text==='Ответ анкеты 1'));
  assert.ok(expected.cells.some(c=>c.text==='Ответ анкеты 2'));
  assert.doesNotThrow(()=>interviewPayload({candidate:{id:3},application:null}));
});

test('ambiguous job descriptions preserved, not fabricated', () => {
  const raw = 'Работала на себя, потом руководителем';
  assert.deepEqual(splitJobs(raw),[{raw}]);
});

function fixture() {
  const cells = new Map([['Итог!B48',{value:'Дополнительные сведения кандидата • Анкета 2'}]]);
  const files = []; let copies=0;
  const file = {getId:()=> 'copy-id',getName:()=> 'Интервью на продуктивность — Имя',getUrl:()=> 'sheet-url',getMimeType:()=> 'sheet'};
  const iterator = () => {let i=0;return {hasNext:()=>i<files.length,next:()=>files[i++]};};
  const folder = {getFiles:iterator,getId:()=> 'folder-id'};
  const book={getSheetByName:sheet=>({getRange:address=>{
    const key=sheet+'!'+address;if(!cells.has(key))cells.set(key,{value:''});const c=cells.get(key);
    return {getValue:()=>c.value,getFormula:()=>c.formula||'',setRichTextValue:r=>{c.value=r.text;},setNote:n=>{c.note=n;},setWrap:()=>{},getRow:()=>Number(address.match(/\d+/)[0])};
  },getRowHeight:()=>30,setRowHeight:()=>{}})};
  const context={console,MimeType:{GOOGLE_SHEETS:'sheet'},DriveApp:{getFileById:()=>({makeCopy:()=>{copies++;files.push(file);return file;}})},SpreadsheetApp:{openById:()=>book,flush:()=>{},newRichTextValue:()=>({setText(text){this.text=text;return this;},build(){return {text:this.text};}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../google-drive-bridge/Code.gs',import.meta.url),'utf8'),context);
  return {cells,files,file,folder,context,copies:()=>copies};
}

test('bridge retry reuses same copy and preserves manual answers; text cannot become formula',()=>{
  const f=fixture(),p={version:47,templateId:'1BqxBeDOmNBzil3IECT-DRXGPhF4mbQDUQgZmnLCfzrs',candidateId:'1',name:'Имя',cells:[{sheet:'Начало',cell:'B35',text:'=IMPORTXML("x")',rows:2,source:'Анкета 2'}]};
  f.context.saveInterview047_(f.folder,p);
  assert.equal(f.cells.get('Начало!B35').value,p.cells[0].text);
  f.cells.get('Начало!B35').value='Ручная запись';
  f.context.saveInterview047_(f.folder,p);
  assert.equal(f.copies(),1);assert.equal(f.cells.get('Начало!B35').value,'Ручная запись');
});

test('duplicate files and checkbox writes fail closed',()=>{
  const f=fixture(),p={version:47,templateId:'1BqxBeDOmNBzil3IECT-DRXGPhF4mbQDUQgZmnLCfzrs',candidateId:'1',cells:[{sheet:'Начало',cell:'B70',rows:1,text:'Да'}]};
  assert.throws(()=>f.context.saveInterview047_(f.folder,p),/Unapproved/);
  f.files.push(f.file);assert.throws(()=>f.context.saveInterview047_(f.folder,p),/несколько/);
});

test('legacy interview sample remains untouched',()=>{
  const f=fixture();f.files.push(f.file);f.cells.get('Итог!B48').value='';
  const r=f.context.saveInterview047_(f.folder,{version:47,templateId:'1BqxBeDOmNBzil3IECT-DRXGPhF4mbQDUQgZmnLCfzrs',candidateId:'1',cells:[]});
  assert.equal(r.legacyTemplatePreserved,true);assert.equal(f.copies(),0);
});
