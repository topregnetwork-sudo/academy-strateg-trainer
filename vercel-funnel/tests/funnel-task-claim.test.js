import test from 'node:test';
import assert from 'node:assert/strict';
import {claimFunnelTask,failFunnelTask,finishFunnelTask} from '../lib/funnel-task-claim.js';

function recorder(results = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '');
    calls.push({text, values});
    const next = results.shift();
    if (next instanceof Error) throw next;
    return {rows: next ? [next] : []};
  };
  return {sql,calls};
}

test('claim uses a per-attempt lease token and treats a concurrent tuple update as busy', async () => {
  const error = Object.assign(new Error('tuple concurrently updated'), {code:'40001'});
  const {sql,calls} = recorder([error]);
  assert.equal(await claimFunnelTask(sql,'task-1','lease-a'),false);
  assert.match(calls[0].text,/lease_token=\$1/);
  assert.match(calls[0].text,/state='running' AND updated_at<NOW\(\)-INTERVAL '2 minutes'/);
  assert.deepEqual(calls[0].values,['lease-a','task-1']);
});

test('only the first concurrent claim receives a lease', async () => {
  let state='pending';
  const sql=async(strings,...values)=>{
    if(state!=='pending')return {rows:[]};
    state='running';
    return {rows:[{id:'task-1',leaseToken:values[0]}]};
  };
  const claims=await Promise.all([
    claimFunnelTask(sql,'task-1','lease-a'),
    claimFunnelTask(sql,'task-1','lease-b')
  ]);
  assert.equal(claims.filter(Boolean).length,1);
});

test('completion is fenced to its lease token and releases the lease', async () => {
  const {sql,calls}=recorder([{id:'task-1'}]);
  assert.equal(await finishFunnelTask(sql,'task-1','lease-a',{done:true}),true);
  assert.match(calls[0].text,/lease_token=NULL/);
  assert.match(calls[0].text,/WHERE id=\$2 AND state='running' AND lease_token=\$3/);
  assert.deepEqual(calls[0].values,['done','task-1','lease-a']);
});

test('a stale lease cannot complete or fail a task after a newer claim', async () => {
  const finish=recorder([]);
  const fail=recorder([]);
  assert.equal(await finishFunnelTask(finish.sql,'task-1','old-lease',{done:true}),false);
  assert.equal(await failFunnelTask(fail.sql,'task-1','old-lease',new Error('late failure')),false);
  assert.match(finish.calls[0].text,/lease_token=\$3/);
  assert.match(fail.calls[0].text,/lease_token=\$3/);
});

test('completion retries a transient tuple serialization conflict', async () => {
  const {sql,calls}=recorder([Object.assign(new Error('tuple concurrently updated'),{code:'40001'}),{id:'task-1'}]);
  assert.equal(await finishFunnelTask(sql,'task-1','lease-a',{done:false}),true);
  assert.equal(calls.length,2);
});
