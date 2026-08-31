import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {timelineFields,readInterviewTimeline} from '../lib/interview-timeline.js';
import {PGlite} from '@electric-sql/pglite';
test('only saved timestamps, no invented start or end, booking is planned',()=>{
 const p=timelineFields({status:'productivity_passed',t_submitted:'2026-08-31T09:00Z'},null);
 assert.equal(p.B6,undefined);assert.equal(p.B17,undefined);assert.equal(p.B19,undefined);
 assert.equal(p.E17.text,'Продуктивность пройдена');assert.deepEqual(p.B16,{clear:true});
 const next=timelineFields({clicked_at:'2026-08-31T04:53:35Z',status:'productivity_booked'},{starts_at:'2026-09-01T08:15Z',updated_at:'2026-08-31T07:30:17Z'});
 assert.equal(next.B16.iso,'2026-09-01T08:15:00.000Z');assert.equal(next.B15.iso,'2026-08-31T07:30:17.000Z');
 assert.match(next.E16.text,/не считается/);
});
test('bridge timeline accepts only approved timestamps and status cells',()=>{
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../../google-drive-bridge/Code.gs',import.meta.url),'utf8'),c);
 assert.doesNotThrow(()=>c.validateTimeline049_({B6:{iso:'2026-08-31T07:00Z'},B16:{clear:true},E17:{text:'Ожидается'}}));
 assert.throws(()=>c.validateTimeline049_({B19:{iso:'2026-09-01'}}));
 assert.throws(()=>c.validateTimeline049_({B6:{iso:'invalid'}}));
 assert.throws(()=>c.validateTimeline049_({F9:{text:'bad'}}));
});

test('database timeline reads one candidate timestamps only',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE candidates(id int,status text,group_joined_at timestamptz);
 CREATE TABLE candidate_zoom_entries(candidate_id int,clicked_at timestamptz);
 CREATE TABLE candidate_questionnaire_two(candidate_id int,sent_at timestamptz,opened_at timestamptz,submitted_at timestamptz);
 CREATE TABLE candidate_tests(candidate_id int,sent_at timestamptz,opened_at timestamptz,submitted_at timestamptz,created_at timestamptz);
 CREATE TABLE offline_interview_invites(candidate_id int,status text,sent_at timestamptz);
 CREATE TABLE funnel_recipients(candidate_id int,job_id text,state text,updated_at timestamptz);
 CREATE TABLE funnel_jobs(id text,config jsonb);
 CREATE TABLE candidate_interview_result_events049(candidate_id int,status text,recorded_at timestamptz);
 INSERT INTO candidates VALUES(1,'productivity_passed',NULL),(2,'productivity_failed',NULL);
 INSERT INTO candidate_zoom_entries VALUES(1,'2026-08-31T04:00Z'),(2,'2026-08-30T04:00Z');
 INSERT INTO candidate_interview_result_events049 VALUES(1,'productivity_passed','2026-09-01T09:00Z');
 INSERT INTO offline_interview_invites VALUES(1,'booked','2026-08-31T08:00Z');`);
 const sql=(strings,...values)=>db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values);
 const p=await readInterviewTimeline(sql,1,null);
 assert.equal(p.B6.iso,'2026-08-31T04:00:00.000Z');assert.equal(p.B17.iso,'2026-09-01T09:00:00.000Z');
 assert.equal(p.B14.iso,'2026-08-31T08:00:00.000Z');
 assert.equal(p.B19,undefined);await db.close();
});

test('timeline retry preserves manual values and clears only the automatic planned date',()=>{
 const values=new Map([['E16',{value:'Ожидается'}],['E17',{value:'Ожидается'}]]);
 const sheet={getRange(address){if(!values.has(address))values.set(address,{value:'',note:''});const c=values.get(address);
   const cell={getValue:()=>c.value,getNote:()=>c.note||'',getFormula:()=>c.formula||'',setNote:n=>{c.note=n;return cell;},setValue:v=>{c.value=v;return cell;},setNumberFormat:()=>cell,setRichTextValue:r=>{c.value=r.text;return cell;}};return cell;}};
 const book={getSheetByName:()=>sheet};
 const context={Date,SpreadsheetApp:{newRichTextValue:()=>({setText(text){this.text=text;return this;},build(){return {text:this.text};}})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../google-drive-bridge/Code.gs',import.meta.url),'utf8'),context);
 const payload={candidateId:'1',timeline:timelineFields({clicked_at:'2026-08-31T04:00Z',status:'productivity_booked'},{starts_at:'2026-09-01T08:00Z'})};
 context.updateTimeline049_(book,payload);
 assert.equal(values.get('B6').value.toISOString(),'2026-08-31T04:00:00.000Z');
 assert.equal(context.updateTimeline049_(book,payload).changed.length,0);
 values.get('B6').value='Ручное уточнение';
 context.updateTimeline049_(book,{...payload,timeline:timelineFields({clicked_at:'2026-08-31T04:00Z',status:'productivity_booked'},null)});
 assert.equal(values.get('B6').value,'Ручное уточнение');assert.equal(values.get('B16').value,'');
});
