import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const copies = {
  html: ['questionnaire-2.html', 'vercel-funnel/public/questionnaire-2.html', 'cloudflare-worker/public/questionnaire-2.html'],
  css: ['questionnaire-2.css', 'vercel-funnel/public/questionnaire-2.css', 'cloudflare-worker/public/questionnaire-2.css'],
  js: ['questionnaire-2.js', 'vercel-funnel/public/questionnaire-2.js', 'cloudflare-worker/public/questionnaire-2.js']
};

test('Form 2 has no intermediary completion page and keeps the same Trainer bot route', () => {
  const html = read(copies.html[0]);
  const script = read(copies.js[0]);
  assert.doesNotMatch(html, /id="done"|Анкета получена|Вернуться в бот/);
  assert.match(html, /questionnaire-2\.css\?v=20261002-1/);
  assert.match(html, /questionnaire-2\.js\?v=20261004-direct-bot-2/);
  assert.match(script, /botUrl='https:\/\/t\.me\/stazherskaya_bot'/);
  assert.match(script, /botFallbackUrl=botUrl\+'\?start=questionnaire_done'/);
  assert.match(read('vercel-funnel/api/telegram.js'), /if \(\/\^\\\/start\\s\+questionnaire_done\$\/i\.test\(message\.text \|\| ''\)\)/);
});

test('a saved Form 2 waits for the bot confirmation event and then redirects directly', () => {
  const script = read(copies.js[0]);
  const submit = script.match(/form\.addEventListener\('submit',[\s\S]*?\);load\(\);/u)?.[0];
  assert.ok(submit, 'Form 2 submit handler is present');
  const saveIndex = submit.indexOf("rpc('submit_candidate_questionnaire_two'");
  const progressIndex = submit.indexOf("await progress('questionnaire_2_completed')");
  const redirectIndex = submit.indexOf('redirectToBot()', progressIndex);
  assert.ok(saveIndex >= 0 && progressIndex > saveIndex, 'answers are saved before the bot event');
  assert.ok(redirectIndex > progressIndex, 'Telegram opens after the bot event succeeds');
  assert.match(submit, /redirectToBot\(true\)/, 'failed bot event falls back to the verified start route');
  assert.doesNotMatch(submit, /show\('done'\)/);
});

test('an already submitted personal link opens the Trainer bot without a success page', () => {
  const script = read(copies.js[0]);
  assert.match(script, /if\(data\.submitted_at\)\{redirectToBot\(\);return\}/);
});

test('the bot owns the confirmation message and next instruction', () => {
  const progression = read('vercel-funnel/api/progression.js');
  assert.match(progression, /const QUESTIONNAIRE_COMPLETED = '✅ <b>Анкета 2 получена<\/b>/);
  assert.match(progression, /telegram\(item\.chat_id, message\)/);
});

test('GitHub Pages, Vercel and Cloudflare questionnaire assets stay in parity', () => {
  for (const paths of Object.values(copies)) {
    const expected = read(paths[0]).replace(/\r\n/g, '\n');
    for (const path of paths.slice(1)) assert.equal(read(path).replace(/\r\n/g, '\n'), expected, `${path} must match ${paths[0]}`);
  }
});

test('Trainer post-Zoom keyword still routes to the group and immediate Form 2', () => {
  const source = read('vercel-funnel/api/telegram.js');
  const start = source.indexOf('async function handleCandidateGroupKeyword');
  const end = source.indexOf('async function handleCandidateTestKeyword', start);
  const handler = source.slice(start, end);
  assert.match(handler, /CANDIDATE_GROUP_KEYWORD\.test\(message\.text/);
  assert.match(handler, /text: 'Перейти в группу кандидатов'/);
  assert.match(handler, /text: 'Заполнить Анкету 2'/);
  assert.doesNotMatch(handler, /two training days|первых двух учебных дней|тренировочных дней/i);
});
