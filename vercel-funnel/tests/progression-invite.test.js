import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
const calls=[];let replay=false;
await mock.module('../api/_core.js',{namedExports:{init:async()=>{},json:(res,status,data)=>{res.code=status;res.data=data},telegram:async()=>1,sql:async(s,...v)=>{const q=s.join('');if(q.includes('UPDATE candidate_tests t'))return {rows:replay?[]:[{id:8,candidate_id:17,chat_id:'117'}]};if(q.includes('SELECT candidate_id FROM candidate_tests'))return {rows:[{candidate_id:17}]};return {rows:[]};}}});
await mock.module('../api/drive.js',{namedExports:{syncDriveCandidate:async()=>{calls.push('drive');return {ok:true}}}});
await mock.module('../api/offline-interview.js',{namedExports:{sendOfflineInvites:async id=>{calls.push(id);return {sent:replay?0:1}}}});
await mock.module('../lib/funnel-store.js',{namedExports:{initFunnel:async()=>{},effect:async(_key,fn)=>fn()}});
const {default:handler}=await import('../api/progression.js');
test('valid completed-test event and replay invoke only that candidate before Drive',async()=>{
 for(const again of [false,true]){replay=again;calls.length=0;const res={setHeader(){}};await handler({method:'POST',body:{type:'test_1_completed',token:'a'.repeat(64)}},res);assert.equal(res.code,200);assert.deepEqual(calls,[17,'drive']);}
});
