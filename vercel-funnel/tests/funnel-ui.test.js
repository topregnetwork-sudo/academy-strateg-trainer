import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {ACTIONS,DEFAULT_TEMPLATES} from '../lib/funnel-model.js';
test('operator console selects people and previews without touching chat or sending',async()=>{
  const markup=(await readFile(new URL('../../operator.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
  const dom=new JSDOM(markup,{url:'https://test.invalid/operator.html',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,requests=[],errors=[];w.addEventListener('error',e=>errors.push(e.error));
  w.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;requests.push({url,body});
    let data={};
    if(url==='/api/operator')data={candidates:[{id:1,first_name:'Ирина',city:'Минск',username:'ira',status:'test_1_completed'}],analytics:{}};
    if(url==='/api/funnel')data=body?.action==='preview'?{jobId:'test',recipients:[{id:1,name:'Ирина',city:'Минск',text:'Проверка'}],excluded:[]}:body?{ok:true}:{actions:ACTIONS,defaults:DEFAULT_TEMPLATES,templates:[],sessions:[],jobs:[],tasks:[]};
    return {ok:true,json:async()=>data};
  };
  for(const file of ['operator.js','funnel-console.js']){const s=w.document.createElement('script');s.textContent=await readFile(new URL('../../'+file,import.meta.url),'utf8');w.document.body.append(s);}
  await w.eval("login('test-only')");
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(w.document.querySelector('#candidates input[type=checkbox]'));
  w.document.querySelector('#fcLoad').click();await new Promise(r=>setTimeout(r,30));
  w.document.querySelector('#fcSelect').click();assert.match(w.document.querySelector('#fcCount').textContent,/1/);
  w.document.querySelector('#fcAction').value='message';w.document.querySelector('#fcText').value='Проверка';
  w.document.querySelector('#fcPreview').click();await new Promise(r=>setTimeout(r,30));
  assert.equal(w.document.querySelector('#fcPreviewBox').hidden,false);
  assert.ok(w.document.querySelector('#fcSend'));
  assert.equal(requests.some(r=>r.body?.action==='send'),false);
  assert.ok(w.document.querySelector('#detail'));assert.ok(w.document.querySelector('#broadcastText'));
  w.document.querySelector('#fcText').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.document.querySelector('#fcPreviewBox').hidden,true);
  dom.window.close();
});
