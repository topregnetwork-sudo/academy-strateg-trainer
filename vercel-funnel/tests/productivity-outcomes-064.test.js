import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTIVITY_PASS_MESSAGE,
  PRODUCTIVITY_RESERVE_BUTTONS,
  PRODUCTIVITY_RESERVE_CONFIRMATION,
  PRODUCTIVITY_RESERVE_DECLINED,
  PRODUCTIVITY_RESERVE_NO_RESPONSE_MESSAGE,
  PRODUCTIVITY_RESERVE_REMINDER_MESSAGE,
  PRODUCTIVITY_RESERVE_MESSAGE,
  PRODUCTIVITY_TOPICS,
  productivityStaffText,
} from '../lib/productivity-outcomes-064.js';

test('productivity outcome uses the approved staff topics and candidate wording', () => {
  assert.deepEqual(PRODUCTIVITY_TOPICS, { passed: 1071, reserve: 1073 });
  assert.match(PRODUCTIVITY_PASS_MESSAGE, /следующий этап отбора/iu);
  assert.match(PRODUCTIVITY_PASS_MESSAGE, /Пожалуйста, ожидайте нашего сообщения/iu);
  assert.match(PRODUCTIVITY_RESERVE_MESSAGE, /проявили интерес к Академии Стратег/iu);
  assert.match(PRODUCTIVITY_RESERVE_MESSAGE, /в первую очередь вернёмся/iu);
  assert.match(PRODUCTIVITY_RESERVE_MESSAGE, /кадровом резерве Академии Стратег/iu);
  assert.match(PRODUCTIVITY_RESERVE_CONFIRMATION, /в первую очередь вернёмся/iu);
  assert.match(PRODUCTIVITY_RESERVE_CONFIRMATION, /группа кандидатов предназначена для активного потока отбора/iu);
  assert.match(PRODUCTIVITY_RESERVE_DECLINED, /Благодарим за интерес/iu);
  assert.match(PRODUCTIVITY_RESERVE_REMINDER_MESSAGE, /бережно напоминаем/iu);
  assert.match(PRODUCTIVITY_RESERVE_NO_RESPONSE_MESSAGE, /не получили ваш ответ/iu);
  assert.deepEqual(PRODUCTIVITY_RESERVE_BUTTONS.inline_keyboard[0].map(button => button.callback_data), [
    'productivity_reserve_yes',
    'productivity_reserve_no',
  ]);
});

test('staff outcome notice is distinct for passed and reserve invitation', () => {
  const candidate = { id: 7, full_name: 'Тестовый кандидат', city: 'Минск', username: 'test_candidate' };
  assert.match(productivityStaffText(candidate, 'productivity_passed'), /ПРОШЁЛ ИНТЕРВЬЮ НА ПРОДУКТИВНОСТЬ/iu);
  assert.match(productivityStaffText(candidate, 'productivity_failed'), /КАДРОВЫЙ РЕЗЕРВ/iu);
  assert.match(productivityStaffText(candidate, 'productivity_failed'), /после его согласия/iu);
});
