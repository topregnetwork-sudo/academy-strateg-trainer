import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {appointmentFields,readProductivityAppointment} from '../lib/interview-appointment.js';

test('saved database slot is used; rescheduling reads the changed slot, not a cached screenshot',async()=>{
  const db=new PGlite();
  await db.exec(`CREATE TABLE funnel_sessions(id int,config jsonb);CREATE TABLE funnel_slots(id int,starts_at timestamptz);
    CREATE TABLE funnel_bookings(id int,version int,updated_at timestamptz,slot_id int,session_id int,candidate_id int);
    CREATE TABLE offline_interview_bookings(candidate_id int,event_date date,slot_time text,status text);
    INSERT INTO offline_interview_bookings VALUES(77,'2026-09-01','1115','booked');`);
  const sql=(strings,...values)=>db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values);
  const first=await readProductivityAppointment(sql,77);
  assert.equal(first.source,'offline_interview_bookings');
  assert.equal(appointmentFields(first).F10,'11:15 — МСК (UTC+3)');
  assert.equal(appointmentFields(first).F12,'Шипунов Максим');
  await db.exec(`UPDATE offline_interview_bookings SET slot_time='1230' WHERE candidate_id=77`);
  assert.equal(appointmentFields(await readProductivityAppointment(sql,77)).F10,'12:30 — МСК (UTC+3)');
  await db.exec(`DELETE FROM offline_interview_bookings;
    INSERT INTO funnel_sessions VALUES(1,'{"city":"Челябинск","date":"2026-09-01","format":"online","location":"https://us04web.zoom.us/j/74249951606?pwd=x"}');
    INSERT INTO funnel_slots VALUES(1,'2026-09-01T11:20:00Z');
    INSERT INTO funnel_bookings VALUES(10,2,NOW(),1,1,77);`);
  const second=await readProductivityAppointment(sql,77);
  assert.equal(appointmentFields(second).F10,'14:20 — МСК (UTC+3)');
  assert.equal(second.key,'funnel:10:2');
  await db.exec('DELETE FROM funnel_bookings');
  assert.deepEqual(appointmentFields(await readProductivityAppointment(sql,77)),{F9:'',F10:'',F11:'',F12:''});
  await db.close();
});

function bridgeFixture(){
  const cells=new Map([['B9',{value:'Дата интервью'}],['B10',{value:'Время интервью'}]]);
  const sheet={getRange(address){if(!cells.has(address))cells.set(address,{value:'',note:''});const c=cells.get(address);
    return {getValue:()=>c.value,getFormula:()=>c.formula||'',getNote:()=>c.note||'',setNote:n=>c.note=n,setRichTextValue:r=>c.value=r.text};}};
  const file={getName:()=> 'Интервью на продуктивность — Проверка',getId:()=> 'existing-id',getUrl:()=> 'existing-url',getMimeType:()=> 'sheet'};
  const context={MimeType:{GOOGLE_SHEETS:'sheet'},DriveApp:{getFolderById(){let i=0;return {getFiles:()=>({hasNext:()=>i<1,next:()=>{i++;return file;}})};}},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){},newRichTextValue:()=>({setText(text){this.text=text;return this;},build(){return {text:this.text};}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../google-drive-bridge/Code.gs',import.meta.url),'utf8'),context);
  return {cells,run:p=>context.updateInterviewAppointment048_(p)};
}
test('only four fields change, repeated delivery is harmless, manual edits and formulas survive',()=>{
  const f=bridgeFixture();
  const p={existingFolderId:'folder',candidateId:'77',bookingKey:'v1',fields:{F9:'1 сентября',F10:'11:15',F11:'Онлайн',F12:'Шипунов Максим'}};
  assert.equal(f.run(p).id,'existing-id');assert.equal(f.run(p).changed.length,0);
  f.cells.get('F12').value='Другой интервьюер — ручная правка';
  f.cells.set('F11',{value:'Онлайн',formula:'="Онлайн"'});
  const next={...p,bookingKey:'v2',fields:{...p.fields,F10:'12:00'}};
  const result=f.run(next);
  assert.equal(f.cells.get('F10').value,'12:00');
  assert.equal(f.cells.get('F12').value,'Другой интервьюер — ручная правка');
  assert.deepEqual(Array.from(result.preserved),['F11','F12']);
  f.run({...p,bookingKey:'cancelled',fields:appointmentFields(null)});
  assert.equal(f.cells.get('F10').value,'');
  assert.equal(f.cells.get('F12').value,'Другой интервьюер — ручная правка');
  assert.throws(()=>f.run({...p,fields:{...p.fields,B38:'bad'}}),/Unapproved/);
});

test('date format validates input and does not invent missing interviewer',()=>{
  assert.throws(()=>appointmentFields({starts_at:'bad'}),/Некорректное/);
  assert.equal(appointmentFields({starts_at:'2026-09-01T11:00Z',format:'offline'}).F12,'');
});
