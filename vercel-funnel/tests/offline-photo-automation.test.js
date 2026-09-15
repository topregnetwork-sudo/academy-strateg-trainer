import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const scheduled = [], telegramCalls = [], bridgeCalls = [];
const sql = async (strings,...values) => {
  const query = strings.reduce((result,part,index) => result + (index ? `$${index}` : '') + part, '');
  return {rows:(await db.query(query,values)).rows};
};
mock.module('../api/_core.js',{namedExports:{sql,telegramApi:async(method,payload) => {
  telegramCalls.push({method,payload});
  return method === 'sendMessage' ? {message_id:777} : true;
}}});
mock.module('../lib/funnel-store.js',{namedExports:{createTask:async(kind,payload,dueAt,id) => {
  scheduled.push({kind,payload,dueAt,id});return id;
}}});
const {runOfflinePhotoProcess001,runOfflinePhotoBrief001} = await import('../lib/offline-photo-automation-001.js');

test('verified handwritten form moves once and publishes one editable date/city brief', async () => {
  await db.exec(`CREATE TABLE candidates(id BIGINT PRIMARY KEY,city TEXT,status TEXT,first_name TEXT,last_name TEXT,phone TEXT,consent BOOLEAN);
    CREATE TABLE applications(id BIGSERIAL PRIMARY KEY,candidate_id BIGINT,full_name TEXT,phone TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE candidate_drive(candidate_id BIGINT PRIMARY KEY,folder_id TEXT,folder_url TEXT);
    CREATE TABLE offline_photo_intake_001(chat_id TEXT,thread_id TEXT,message_id TEXT PRIMARY KEY,sender_id TEXT,media_group_id TEXT,
      state TEXT,drive_file_id TEXT,error TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);`);
  await db.exec(`INSERT INTO candidates VALUES (1,'Минск','offline_testing','Екатерина','Афанасенко','+375296065907',true);
    INSERT INTO applications(candidate_id,full_name,phone) VALUES (1,'Афанасенко Екатерина Витальевна','+375296065907');
    INSERT INTO candidate_drive VALUES (1,'folder-1','https://drive.google.com/drive/folders/1hAzcIEWkZm1bAhvEvZonSJIqDw7ujTuZ');
    INSERT INTO offline_photo_intake_001(chat_id,thread_id,message_id,sender_id,media_group_id,state,drive_file_id,created_at,updated_at)
      VALUES ('-1004397133749','1071','9999','222','album-1','staged','image-1',NOW()-INTERVAL '2 hours',NOW());`);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url,request) => {
    const action = JSON.parse(request.body).action;
    bridgeCalls.push(action);
    const value = action === 'ocr_offline_photo_001' ?
      {ok:true,text:'Дата 14.09. 2026\nАфанасенко Екатерина Витальевна\nТелефон 375-29-6065907'} :
      {ok:true,fileId:'image-1',folderId:'folder-1'};
    return {ok:true,json:async()=>value};
  };
  const priorSecret=process.env.GOOGLE_DRIVE_BRIDGE_SECRET;
  process.env.GOOGLE_DRIVE_BRIDGE_SECRET='synthetic-test-only';
  try {
    const result = await runOfflinePhotoProcess001('9999');
    assert.equal(result.assigned,true);
    assert.deepEqual(bridgeCalls,['ocr_offline_photo_001','assign_offline_photo_001']);
    const photo=(await db.query('SELECT state,candidate_id,test_date,test_city FROM offline_photo_intake_001 WHERE message_id=$1',['9999'])).rows[0];
    assert.equal(photo.state,'assigned');
    assert.equal(Number(photo.candidate_id),1);
    assert.equal(new Date(photo.test_date).toISOString().slice(0,10),'2026-09-14');
    assert.equal(photo.test_city,'Минск');
    assert.equal(scheduled.length,1);
    assert.equal(scheduled[0].kind,'offline_photo_brief_001');
    assert.equal((await db.query('SELECT status FROM candidates WHERE id=1')).rows[0].status,'offline_testing');
    const first=await runOfflinePhotoBrief001('2026-09-14','Минск');
    assert.equal(first.sent,true);
    assert.equal(telegramCalls.length,1);
    assert.equal(telegramCalls[0].payload.message_thread_id,1071);
    assert.match(telegramCalls[0].payload.text,/Афанасенко Екатерина Витальевна\nhttps:\/\/drive\.google\.com\/drive\/folders\//);
    const second=await runOfflinePhotoBrief001('2026-09-14','Минск');
    assert.equal(second.unchanged,true);
    assert.equal(telegramCalls.length,1);
    await db.exec(`INSERT INTO candidates VALUES (2,'Минск','offline_testing','Алексей','Лось','+375291234567',true);
      INSERT INTO applications(candidate_id,full_name,phone) VALUES (2,'Лось Алексей Русланович','+375291234567');
      INSERT INTO candidate_drive VALUES (2,'folder-2','https://drive.google.com/drive/folders/1PN6WTy6xlWg_qLIvlV7wquDFco8QbogH');
      INSERT INTO offline_photo_intake_001(chat_id,thread_id,message_id,sender_id,state,drive_file_id,created_at,updated_at,candidate_id,test_date,test_city)
        VALUES ('-1004397133749','1071','10000','333','assigned','image-2',NOW()-INTERVAL '2 hours',NOW(),2,'2026-09-14','Минск');`);
    const late=await runOfflinePhotoBrief001('2026-09-14','Минск');
    assert.equal(late.edited,true);
    assert.equal(telegramCalls[1].method,'editMessageText');
    assert.equal(telegramCalls[1].payload.message_id,777);
    assert.match(telegramCalls[1].payload.text,/Лось Алексей Русланович/);
    await db.exec(`INSERT INTO candidates VALUES (3,'Челябинск','offline_testing','Мария','Фалейчик','+79991234567',true);
      INSERT INTO applications(candidate_id,full_name,phone) VALUES (3,'Фалейчик Мария Александровна','+79991234567');
      INSERT INTO candidate_drive VALUES (3,'folder-3','https://drive.google.com/drive/folders/1jAzcIEWkZm1bAhvEvZonSJIqDw7ujTuZ');
      INSERT INTO offline_photo_intake_001(chat_id,thread_id,message_id,sender_id,state,drive_file_id,created_at,updated_at,candidate_id,test_date,test_city)
        VALUES ('-1004397133749','1071','10001','444','assigned','image-3',NOW()-INTERVAL '2 hours',NOW(),3,'2026-09-14','Челябинск');`);
    const anotherCity=await runOfflinePhotoBrief001('2026-09-14','Челябинск');
    assert.equal(anotherCity.sent,true);
    assert.equal(telegramCalls[2].method,'sendMessage');
    assert.doesNotMatch(telegramCalls[2].payload.text,/Афанасенко|Лось/);
  } finally {
    globalThis.fetch=originalFetch;
    if(priorSecret===undefined)delete process.env.GOOGLE_DRIVE_BRIDGE_SECRET;
    else process.env.GOOGLE_DRIVE_BRIDGE_SECRET=priorSecret;
  }
});
