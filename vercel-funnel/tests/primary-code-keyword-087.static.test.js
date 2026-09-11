import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');

test('087 keeps candidate keyword as post-primary-Zoom admission code', () => {
  assert.match(source, /const PRIMARY_CODE_AFTER_DAYS = 7;/);
  assert.ok(source.includes('const CANDIDATE_GROUP_KEYWORD'));
  assert.ok(source.includes('кандидат|кондидат'));
  assert.match(source, /hostCodeWindow = candidate\.status === 'interview_booked'/);
  assert.match(source, /Date\.now\(\) >= primaryStartedAt/);
  assert.match(source, /Date\.now\(\) <= primaryStartedAt \+ PRIMARY_CODE_AFTER_DAYS \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /if\(!hostCodeWindow&&!await requirePrimaryAccess\(candidate\)\)return true;/);
});

test('087 keeps chat id available for experienced-collaboration first reply', () => {
  assert.match(source, /RETURNING id,chat_id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status/);
  assert.match(source, /await sendExperiencedCollaborationOffer\(row\)/);
});
