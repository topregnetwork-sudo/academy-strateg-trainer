import {test} from 'node:test';import assert from 'node:assert/strict';
import {withGoals,withGoalsHtml,withGoalsKeyboard,GOALS_URL,PDF_URL} from '../lib/goals-links.js';
import {validateMessage} from '../lib/funnel-model.js';
test('goals append only, repeat stable, Zoom unchanged, both material buttons',()=>{
 const original='Имя, здравствуйте! 1 сентября 12:45';const text=withGoalsHtml(original);assert.ok(text.startsWith(original));assert.ok(text.includes(GOALS_URL));assert.ok(text.includes(PDF_URL));assert.equal(withGoalsHtml(text),text);
 const zoom={inline_keyboard:[[{text:'Подключиться к Zoom',url:'https://zoom.us/j/123'}]]};const k=withGoalsKeyboard(zoom);assert.deepEqual(k.inline_keyboard[0],zoom.inline_keyboard[0]);assert.equal(zoom.inline_keyboard.length,1);assert.equal(k.inline_keyboard[1][0].url,GOALS_URL);
 for(const action of ['invite','test_passed'])assert.equal(validateMessage({action,text:original}).text,withGoals(original));assert.equal(validateMessage({action:'message',text:original}).text,original);
});
