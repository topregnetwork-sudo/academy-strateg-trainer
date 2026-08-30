import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
const calls=[];
await mock.module('../api/_core.js',{namedExports:{init:async()=>{},json:()=>{},operator:()=>false,sql:()=>{throw Error('Must not query or change bookings')},telegram:()=>{throw Error('Must not send')},telegramApi:async(method,v)=>calls.push({method,v})}});
await mock.module('../api/drive.js',{namedExports:{syncDriveCandidate:async()=>{}}});
const {confirmationText,bookingKeyboard,invitationText,handleOfflineInterviewChoice,MINSK_ZOOM}=await import('../api/offline-interview.js');
test('Sep1 online invitation and confirmation preserve time, only Zoom button',()=>{
 assert.match(invitationText(),/онлайн в Zoom/);assert.doesNotMatch(invitationText(),/как пройти|Площадь Свободы/);
 assert.match(confirmationText('1245'),/12:45/);assert.doesNotMatch(confirmationText('1245'),/Адрес:|как пройти/);
 assert.deepEqual(bookingKeyboard(),{inline_keyboard:[[{text:'Подключиться к Zoom',url:MINSK_ZOOM}]]});
});
test('old change and move callbacks never change a booking',async()=>{
 for(const data of ['offline_change_20260901','offline_move_20260901_1330','offline_keep_20260901','offline_preview_change'])assert.equal(await handleOfflineInterviewChoice({id:'test',data}),true);
 assert.equal(calls.length,4);assert.ok(calls.every(c=>c.method==='answerCallbackQuery'&&c.v.text.includes('перенос закрыт')));
});
