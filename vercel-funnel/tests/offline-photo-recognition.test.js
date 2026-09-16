import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyOfflineCandidate, offlineDateEvidence, offlineCityEvidence} from '../lib/offline-photo-recognition.js';
import {offlineTaskId} from '../lib/offline-photo-task-id.js';

const candidates = [
  {id:1,fullName:'Афанасенко Екатерина Витальевна',phone:'+375296065907'},
  {id:2,fullName:'Лось Алексей Русланович',phone:'+375291234567'}
];

test('one handwritten form matches both a unique name and phone', () => {
  const text='Дата 14.09. 2026\nАфанасенко Екатерина Витальевна\nТелефон 375-29-6065907';
  assert.equal(offlineDateEvidence(text),'2026-09-14');
  assert.equal(identifyOfflineCandidate(text,candidates)?.id,1);
});

test('conflicting phone and ambiguous event evidence cannot assign a candidate', () => {
  assert.equal(identifyOfflineCandidate('Афанасенко Екатерина Витальевна\nТелефон 375-29-1234567',candidates),null);
  assert.equal(offlineDateEvidence('14.09.2026 и 15.09.2026'),null);
  assert.equal(offlineCityEvidence('Минск и Челябинск'),null);
});

test('numeric score columns do not masquerade as phone numbers', () => {
  const text='Евгения Ивановна Красовская\nДаты показанных тестов\n16.09.2026\n+100\n+90\n+80\n+70\n+60\n50\n40';
  const candidate=identifyOfflineCandidate(text,[
    {id:216,fullName:'Красовская Евгения Ивановна',phone:'+375291111111'},
    {id:114,fullName:'Телелюхина Яна',phone:'+79000000000'}
  ]);
  assert.equal(candidate?.id,216);
});

test('a scheduler task for the same Telegram album stays idempotent', () => {
  assert.equal(offlineTaskId('album','123:456'),offlineTaskId('album','123:456'));
  assert.notEqual(offlineTaskId('album','123:456'),offlineTaskId('album','123:789'));
});
