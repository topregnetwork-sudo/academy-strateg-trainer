import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../google-drive-bridge/Code.gs',import.meta.url),'utf8');
test('complete bridge file compiles as one Apps Script V8 script',()=>{
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'Код.gs'}));
 assert.equal((source.match(/function doPost\(/g)||[]).length,1);
 assert.equal((source.match(/function updateInterviewAppointment048_\(/g)||[]).length,1);
});
test('real entrypoint validates authorization and identifies the exact release without touching Drive',()=>{
 const c={PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-only-secret'})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})}};
 vm.createContext(c);vm.runInContext(source,c);
 const request=p=>c.doPost({postData:{contents:JSON.stringify(p)}});
 assert.equal(request({action:'capabilities',secret:'wrong'}).ok,false);
 const result=request({action:'capabilities',secret:'test-only-secret'});
 assert.equal(result.bridgeVersion,'052-tuning-1');assert.equal(result.timeline049,true);assert.equal(result.migration052,true);
 assert.equal(request({secret:'test-only-secret'}).error,'Folder is not specified');
 assert.equal(c.doPost({postData:{contents:'not JSON'}}).ok,false);
});
