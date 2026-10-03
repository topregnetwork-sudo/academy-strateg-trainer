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

test('Form 2 saved state exposes a prominent deep link to the same Trainer bot', () => {
  const html = read(copies.html[0]);
  assert.match(html, /<section id="done"[^>]*hidden[\s\S]*?<a class="return-button" href="https:\/\/t\.me\/stazherskaya_bot\?start=questionnaire_done">Вернуться в бот<\/a>/);
  assert.match(html, /questionnaire-2\.css\?v=20261002-1/);
  assert.match(html, /questionnaire-2\.js\?v=20261004-preview-config-1/);
  assert.match(read(copies.css[0]), /\.return-button\{[^}]*display:inline-flex[^}]*background:var\(--brand\)[^}]*\}/);
  assert.match(read('vercel-funnel/api/telegram.js'), /if \(\/\^\\\/start\\s\+questionnaire_done\$\/i\.test\(message\.text \|\| ''\)\)/);
});

test('a saved Form 2 reveals the return button before the completion-notice request settles', () => {
  const script = read(copies.js[0]);
  const submit = script.match(/form\.addEventListener\('submit',[\s\S]*?\);load\(\);/u)?.[0];
  assert.ok(submit, 'Form 2 submit handler is present');
  const saveIndex = submit.indexOf("rpc('submit_candidate_questionnaire_two'");
  const doneIndex = submit.indexOf("show('done')");
  const progressIndex = submit.indexOf("progress('questionnaire_2_completed')");
  assert.ok(saveIndex >= 0 && doneIndex > saveIndex, 'done state follows a successful answer save');
  assert.ok(progressIndex > doneIndex, 'the Telegram completion notice is attempted after the return CTA is exposed');
  assert.match(submit, /void progress\('questionnaire_2_completed'\)\.catch\(/);
  assert.doesNotMatch(submit, /await progress\('questionnaire_2_completed'\)/);
});

test('GitHub Pages, Vercel and Cloudflare questionnaire assets stay in parity', () => {
  for (const paths of Object.entries(copies).filter(([kind]) => kind !== 'html').map(([,paths])=>paths)) {
    const expected = read(paths[0]);
    for (const path of paths.slice(1)) assert.equal(read(path), expected, `${path} must match ${paths[0]}`);
  }
  const html= copies.html.map(path=>read(path).replace(/(<meta name="trainer-api-origin" content=")[^"]*(">)/,'$1$2'));
  assert.equal(html[1],html[0],'Vercel Preview copy must match the static copy apart from its API origin');
  assert.equal(html[2],html[0],'Cloudflare copy must match the static copy apart from its API origin');
  assert.match(read(copies.html[0]),/<meta name="trainer-api-origin" content="https:\/\/academy-strateg-trainer\.vercel\.app">/);
  assert.match(read(copies.html[1]),/<meta name="trainer-api-origin" content="">/);
  assert.match(read(copies.html[2]),/<meta name="trainer-api-origin" content="">/);
});

test('Preview Form 2 contains no literal production backend and uses same-origin config and progression', () => {
  for (const path of copies.js) {
    const source=read(path);
    assert.doesNotMatch(source,/https?:\/\/[^'"\s]+\.supabase\.co/i,`${path} must not embed a Supabase host`);
    assert.doesNotMatch(source,/https?:\/\/academy-strateg-trainer\.vercel\.app\/api\/(?:public-config|progression)/i,`${path} must not embed a production API`);
    assert.doesNotMatch(source,/\bSUPABASE_URL\s*=/,`${path} must not define a backend fallback`);
    assert.match(source,/fetch\(apiOrigin\+'\/api\/public-config'/);
    assert.match(source,/fetch\(apiOrigin\+'\/api\/progression'/);
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
