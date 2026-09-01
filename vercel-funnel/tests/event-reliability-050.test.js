import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isCandidateTestKeyword,isClosedCandidateStatus} from '../lib/telegram-event-policy.js';

test('all normal Test 1 keyword spellings trigger the same event',()=>{
  for(const text of ['тест','ТЕСТ','Тест 1','Тест-1','Тест — 1','«ТЕСТ»',' тест. '])assert.equal(isCandidateTestKeyword(text),true,text);
  for(const text of ['тестирование','тест 2','протестировать',''])assert.equal(isCandidateTestKeyword(text),false,text);
});

test('closed stages stay closed instead of silently advancing',()=>{
  for(const status of ['test_1_incomplete_removed','rejected','cancelled','selection_closed','academy_contact'])assert.equal(isClosedCandidateStatus(status),true,status);
  for(const status of ['questionnaire','interviewed','test_1_completed'])assert.equal(isClosedCandidateStatus(status),false,status);
});
