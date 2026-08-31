import {test} from 'node:test';import assert from 'node:assert/strict';import {routeStaffMessage} from '../lib/staff-topic-routing.js';
test('actual Telegram transport routes payload; no DB lookup or body mutation',async()=>{
 const previous=globalThis.fetch,token=process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN='test-only';const bodies=[];
 globalThis.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {json:async()=>({ok:true,result:{message_id:1}})};};
 try{const {telegram,telegramApi}=await import('../api/_core.js');await telegram('-1004397133749','brief',{message_thread_id:30});await telegram('-1004397133749','primary',{message_thread_id:2});await telegramApi('editMessageText',{chat_id:'-1004397133749',message_thread_id:30,message_id:598,text:'old'});assert.deepEqual(bodies.map(b=>b.message_thread_id),[619,2,30]);}
 finally{globalThis.fetch=previous;if(token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=token;}
});
test('new coordination sends route to Logs619; other groups/topics/private and historical edits unchanged',()=>{
 const old={chat_id:'-1004397133749',message_thread_id:30,text:'brief',reply_markup:{inline_keyboard:[]}};
 for(const method of ['sendMessage','sendDocument','sendPhoto','sendVideo','sendAudio','sendVoice','sendMediaGroup']){const n=routeStaffMessage(method,old);assert.equal(n.message_thread_id,619);assert.equal(n.text,old.text);assert.equal(n.reply_markup,old.reply_markup);}
 assert.equal(old.message_thread_id,30);
 for(const m of ['editMessageText','editMessageReplyMarkup','deleteMessage','getChatMember'])assert.equal(routeStaffMessage(m,old),old);
 for(const p of [{...old,message_thread_id:2},{...old,message_thread_id:619},{...old,chat_id:'123'},{...old,chat_id:'-999'},{chat_id:old.chat_id,text:'general'}])assert.equal(routeStaffMessage('sendMessage',p),p);
});
