import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('progress distinguishes completed test, delivered invitation, draft and missing data without writes',async()=>{
 const markup=(await readFile(new URL('../../operator.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(markup,{url:'https://test.invalid',runScripts:'dangerously'}),w=dom.window;
 const fixture={candidate:{id:1,first_name:'Ульяна',city:'Челябинск',status:'test_1_completed'},messages:[{direction:'out',delivery_status:'delivered',kind:'candidate_test_already_completed',text:'Тест уже заполнен',created_at:'2026-08-29T20:00:00Z'},{direction:'in',delivery_status:'received',text:'Время',created_at:'2026-08-30T06:00:00Z'}],test:{submitted_at:'2026-08-29T19:00:00Z',answers:[]},questionnaireTwo:{submitted_at:'2026-08-29T18:00:00Z'},drive:{folder_url:'https://drive.google.com/test'},progress:{campaigns:[],bookings:[],offlineBookings:[],offlineInvites:[],errors:[]}};
 w.fetch=()=>{throw Error('No network expected')};
 for(const file of ['operator.js','operator-progress.js']){const s=w.document.createElement('script');s.textContent=await readFile(new URL('../../'+file,import.meta.url),'utf8');w.document.body.append(s);}
 const show=()=>{w.fixture=fixture;w.eval('applyCandidateData(fixture);renderDetail()');return w.document.querySelector('.candidate-progress').textContent;};
 assert.match(show(),/Подтверждённой отправки нет/);assert.match(show(),/Есть входящее/);
 assert.ok(w.document.querySelector('#replyText'));assert.ok(w.document.querySelector('#broadcastText'));
 fixture.progress.campaigns=[{state:'pending',job_state:'draft',config:{action:'invite'},updated_at:'2026-08-30T07:00:00Z'}];
 assert.match(show(),/только черновик/);assert.match(show(),/Подтверждённой отправки нет/);
 fixture.progress.campaigns[0].state='sent';assert.match(show(),/Отправлено/);
 fixture.progress.errors=['bookings'];assert.match(show(),/Данные неполные/);
 assert.equal(w.document.querySelector('#status').value,'test_1_completed');
 assert.match(w.document.querySelector('.message-purpose').textContent,/не приглашение/);
 fixture.candidate.status='productivity_passed';assert.match(show(),/Теперь расшифруйте Тест 1/);
 assert.equal(w.document.querySelector('#status').value,'productivity_passed');
 dom.window.close();
});
