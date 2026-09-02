import {withGoals} from './goals-links.js';
export const ACTIONS = {
  primary_invite: { label: 'Пригласить на первичное Zoom-собеседование', status: null },
  invite: { label: 'После Теста 1 → интервью на продуктивность', status: 'productivity_invited' },
  test_passed: { label: 'Пригласить на продуктивность (прежнее действие)', status: 'productivity_invited' },
  finalist: { label: 'Прошёл в финал', status: 'finalist' },
  not_passed: { label: 'Не прошёл → предложить оставаться на связи', status: 'selection_closed' },
  contact: { label: 'Контакт Академии', status: 'academy_contact', remove: true },
  close: { label: 'Завершить отбор', status: 'rejected', remove: true },
  message: { label: 'Только сообщение', status: null }
};
export const DEFAULT_TEMPLATES = [
  { name: 'Первичное Zoom-собеседование', action: 'primary_invite', text: 'Спасибо за вашу анкету! Выберите удобное время собеседования по кнопке ниже.', buttons: [] },
  { name: 'Приглашение на проверку продуктивности', action: 'invite', text: 'Спасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на следующий этап — дальнейшее тестирование и собеседование в Академии Стратег.\n\nДата: {date}\n{location}\n\nВыберите доступное время по кнопке ниже.\n\nДо собеседования ознакомьтесь и изучите Цели Академии Стратег.', buttons: [] },
  { name: 'Финал отбора', action: 'finalist', text: '{name}, здравствуйте!\n\nПоздравляем — вы успешно прошли предварительное тестирование и вышли в финал отбора на позицию тренера Академии Стратег.\n\nНам понадобится немного времени, чтобы внимательно собрать и проанализировать все результаты пройденных вами этапов. Мы свяжемся с вами и сообщим о дальнейшем решении.\n\nСпасибо за ваше участие и проделанную работу. Пожалуйста, ожидайте нашего сообщения.', buttons: [{ text: 'Спасибо', choice: 'thanks' }] },
  { name: 'Завершение отбора — предложение связи', action: 'not_passed', text: '{name}, здравствуйте!\n\nСпасибо, что дошли до этого этапа отбора: заполнили тесты, уделили нам время и познакомились с Академией Стратег.\n\nНа этот раз мы не будем продолжать отбор с вами на позицию тренера. Это решение о соответствии нашей текущей задаче, а не оценка вас как человека.\n\nХотели бы вы оставаться с Академией на связи — узнавать о мероприятиях и рекомендовать их знакомым, коллегам и предпринимателям?\n\nРабочая группа кандидатов предназначена для продолжающих отбор. После вашего ответа мы завершим ваше участие в ней.', buttons: [{ text: 'Да', choice: 'yes' }, { text: 'Нет', choice: 'no' }] },
  { name: 'Контакт Академии', action: 'contact', text: 'Спасибо за готовность оставаться с Академией на связи! Ваше участие в отборе тренеров завершено, поэтому мы отключим вас от рабочей группы кандидатов. Позднее расскажем о возможностях взаимодействия.', buttons: [] },
  { name: 'Отбор завершён', action: 'close', text: 'Спасибо за участие в отборе и знакомство с Академией Стратег. Ваше участие в текущем отборе завершено, поэтому мы отключим вас от рабочей группы кандидатов. Желаем вам успехов и подходящей команды. До новых встреч!', buttons: [] }
];
export function assert(value, message) { if (!value) throw Object.assign(new Error(message), { status: 400 }); }
export function safeUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export function validateMessage(v) {
  assert(ACTIONS[v.action], 'Выберите действие');
  assert(typeof v.text === 'string' && v.text.trim() && v.text.length <= 3000, 'Текст: от 1 до 3000 символов');
  const buttons = v.buttons || [];
  assert(Array.isArray(buttons) && buttons.length <= 8, 'Не более 8 кнопок');
  for (const b of buttons) {
    assert(typeof b.text === 'string' && b.text.trim() && b.text.length <= 60, 'Укажите название кнопки');
    assert((safeUrl(b.url) && !b.choice) || (['yes', 'no', 'thanks'].includes(b.choice) && !b.url), 'Кнопка: HTTPS-ссылка или ответ Да/Нет/Спасибо');
  }
  if (v.action === 'not_passed') assert(buttons.some(b => b.choice === 'yes') && buttons.some(b => b.choice === 'no'), 'Для решения нужны кнопки Да и Нет');
  return { action: v.action, text: ['invite','test_passed'].includes(v.action)?withGoals(v.text.trim()):v.text.trim(), buttons, sessionId: v.sessionId ? Number(v.sessionId) : null };
}
export function validateSession(v, now = Date.now()) {
  assert(typeof v.name === 'string' && v.name.trim() && v.name.length < 100, 'Укажите название встречи');
  assert(['online', 'offline'].includes(v.format), 'Выберите формат');
  assert(typeof v.city === 'string' && v.city.trim(), 'Укажите город');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(v.date || ''), 'Укажите дату');
  const times = [v.start, v.end];
  assert(times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '')), 'Укажите время');
  const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const interval = Number(v.interval), capacity = Number(v.capacity), cutoff = Number(v.cutoff ?? 60), reminder = Number(v.reminder ?? 30);
  assert(Number.isInteger(interval) && interval >= 5 && interval <= 240, 'Интервал: 5–240 минут');
  assert(Number.isInteger(capacity) && capacity >= 1 && capacity <= 50, 'Мест: 1–50');
  assert(mins(v.end) >= mins(v.start) && (mins(v.end) - mins(v.start)) / interval < 40, 'Не более 40 слотов');
  assert(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 1440, 'Закрытие записи: 0–1440 минут');
  assert(Number.isInteger(reminder) && reminder >= 0 && reminder <= 1440, 'Напоминание: 0–1440 минут');
  assert(v.format === 'online' ? safeUrl(v.location) : typeof v.location === 'string' && v.location.trim(), 'Укажите адрес или HTTPS-ссылку');
  assert(String(v.location).length <= 1000, 'Слишком длинный адрес');
  const slots = [];
  for (let m = mins(v.start); m <= mins(v.end); m += interval) {
    const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const at = new Date(`${v.date}T${time}:00+03:00`);
    assert(Number.isFinite(+at) && +at - cutoff * 60000 > now, 'Дата или срок записи уже прошли');
    slots.push(at.toISOString());
  }
  return { name: v.name.trim(), city: v.city.trim(), format: v.format, date: v.date, location: v.location.trim(), interval, capacity, cutoff, reminder:30, slots,
    confirmation: String(v.confirmation || 'Вы записаны на встречу Академии Стратег.\nДата: {date}\nВремя: {time} МСК\n{location}').slice(0, 2000) };
}
export function renderText(text, candidate, session, at) {
  const actualDate=at?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric'}).format(new Date(at)):session?.date||'';
  const values = { name: candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || 'Здравствуйте', city: candidate.city || '',
    date: actualDate, location: session ? `${session.format === 'online' ? 'Ссылка' : 'Адрес'}: ${session.location}` : '',
    time: at ? new Date(at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) : '',
    local_time: at ? new Date(at).toLocaleTimeString('ru-RU',{timeZone:'Asia/Yekaterinburg',hour:'2-digit',minute:'2-digit'}) : '' };
  return text.replace(/\{(name|city|date|location|time|local_time)\}/g, (_, k) => values[k]);
}
export function eligibility(candidate, config, session) {
  if (!candidate.chat_id) return 'Нет Telegram';
  if(config.action==='primary_invite' && !['new','interview_booked'].includes(candidate.status))return 'Другой этап: первичное приглашение недоступно';
  if (['not_passed', 'close', 'contact'].includes(config.action) && (Number(candidate.id) === 45 || ['finalist', 'training', 'internship', 'hired'].includes(candidate.status))) return 'Защищённый кандидат: финалист / сотрудник';
  if (['invite', 'test_passed'].includes(config.action)) {
    if(candidate.consent===false)return 'Кандидат отказался от сообщений';
    if(['productivity_passed','test_1_passed','productivity_booked'].includes(candidate.status))return 'Продуктивность уже пройдена или назначена';
    if (!candidate.test_completed) return 'Тест 1 не завершён';
    if (!session || !session.active) return 'Нет активной встречи';
    if (session.config.city !== 'Все города' && candidate.city !== session.config.city) return 'Другой город';
    if (['test_1_incomplete_removed', 'finalist', 'training', 'internship', 'hired', 'rejected', 'cancelled', 'academy_contact', 'selection_closed', 'productivity_failed'].includes(candidate.status)) return 'Этап уже завершён';
    if (candidate.booked_session) return 'Уже есть запись на эту встречу';
    if (candidate.invited_session) return 'Приглашение на эту встречу уже отправлено';
  }
  return null;
}
