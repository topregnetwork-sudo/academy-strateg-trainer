// INTERVIEW-SHEET-047: deterministic source-to-field mapping; no LLM or scoring.
export const INTERVIEW_TEMPLATE_ID = '1BqxBeDOmNBzil3IECT-DRXGPhF4mbQDUQgZmnLCfzrs';

export function splitJobs(raw = '') {
  const text = String(raw).trim();
  if (!text) return [];
  const numbered = text.split(/(?:^|\n)\s*\d+[.)]\s*/).filter(x => x.trim());
  const entries = numbered.length > 1 ? numbered : text.split(/\n\s*\n/).filter(x => x.trim());
  return entries.slice(0, 3).map(entry => {
    const value = entry.trim();
    // Only the explicit four-field convention is automatically decomposed.
    // Free prose remains verbatim in the source-history field for clarification.
    const parts = value.split('/').map(x => x.trim());
    if (parts.length !== 4) return { raw: value };
    const match = parts[3].match(/^(\d{4})\s*[-–—]\s*(\d{4}|по настоящее время|настоящее время|н\.?\s*в\.?)\s*[.;]?$/i);
    if (!match) return { raw: value };
    return { raw: value, organization: parts[0], sector: parts[1], role: parts[2], start: match[1], end: match[2], period: parts[3] };
  });
}

export function interviewPayload({ candidate, application = {}, questionnaireTwo, test }) {
  const q = questionnaireTwo?.answers || {};
  const cells = [];
  const add = (sheet, cell, value, rows = 1, source = 'Анкета 2') => {
    if (value === undefined || value === null || value === '') return;
    cells.push({ sheet, cell, text: String(value), rows, source });
  };
  const name = application.full_name || candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`;
  const garcia = application.garcia_confirmed === true || application.test_answer === 'Послание к Гарсии: да' ? 'Да' : application.test_answer === 'Послание к Гарсии: нет' ? 'Нет' : 'Не отмечено';
  add('Начало', 'F6', name, 1, 'Анкета 1');
  add('Начало', 'F7', application.city || candidate.city, 1, 'Анкета 1');
  add('Начало', 'B14', `Телефон: ${candidate.phone || application.phone || 'не указан'} • Telegram: ${candidate.username ? '@' + candidate.username : 'не указан'} • Возраст: ${application.age || 'не указан'}\nОпыт бизнес-тренера: ${application.trainer_experience_level || candidate.trainer_experience_level || 'не указан'} • «Вы такой человек?» — ${garcia}`, 2, 'Анкета 1 и бот');
  add('Начало', 'B35', q.goals, 2);
  add('Начало', 'B38', q.achievements, 3);
  if (test?.submitted_at) add('Начало', 'F76', `Тест 1 заполнен; ответов: ${Array.isArray(test.answers) ? test.answers.length : 'нет данных'}. Расшифровка здесь не указана.`, 1, 'Тест 1');
  add('Итог', 'B14', application.motivation, 2, 'Анкета 1');
  add('Итог', 'F16', q.income);
  for (const [cell, key, rows] of [['F49','strengths',3],['F52','development',3],['F55','hobbies',2],['F57','family',1],['F58','children',1],['F59','readiness',1],['F60','work_history',5]]) add('Итог', cell, q[key], rows);
  splitJobs(q.work_history).forEach((job, index) => {
    const sheet = `Работа ${index + 1}`;
    if (!job.organization) return;
    add(sheet, 'F7', `Место ${index + 1} в исходном ответе; хронологию уточнить`);
    for (const [cell,key] of [['F8','organization'],['F9','sector'],['F10','role'],['F11','start'],['F12','end'],['F13','period']]) add(sheet,cell,job[key]);
  });
  return { version: 47, templateId: INTERVIEW_TEMPLATE_ID, candidateId: String(candidate.id), name: `Интервью на продуктивность — ${name}`, cells };
}
