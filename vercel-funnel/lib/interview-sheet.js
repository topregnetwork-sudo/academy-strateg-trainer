// INTERVIEW-SHEET-047: deterministic source-to-field mapping; no LLM or scoring.
export const INTERVIEW_TEMPLATE_ID = '1t9lAc_Pc5EtJaR641EjbJTqqLdb103riF0yslSl3rNE';
export function experienceLabel(value) {
  return {none:'Нет опыта бизнес-тренером',occasional:'Отдельные занятия',under_one_year:'Менее одного года',professional:'Один год или больше'}[value] || 'Не указан';
}

export function splitJobs(raw = '') {
  const text = String(raw).trim();
  if (!text) return [];
  const numbered = text.split(/(?:^|\n)\s*\d+[.)]\s*/).filter(x => x.trim());
  const entries = numbered.length > 1 ? numbered : text.split(/\n\s*\n/).filter(x => x.trim());
  return entries.slice(0, 3).map(entry => {
    const value = entry.trim();
    const parts = value.split('/').map(x => x.trim()).filter(Boolean);
    if (parts.length < 4) return { raw: value };
    const period = parts.slice(3).join(' / ');
    const years = period.match(/\d{4}/g) || [];
    const ongoing = /наст|н\.?\s*в|сейчас|по\s+настоя/i.test(period);
    return {
      raw: value,
      organization: parts[0],
      sector: parts[1],
      role: parts[2],
      start: years[0] || '',
      end: ongoing ? 'по настоящее время' : years[1] || '',
      period
    };
  });
}

export function interviewPayload({ candidate, application, questionnaireTwo }) {
  application = application || {};
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
  add('Начало', 'F14', candidate.phone || application.phone, 1, 'Анкета 1 и бот');
  add('Начало', 'F15', candidate.username ? '@'+candidate.username.replace(/^@/,'') : '', 1, 'Бот');
  add('Начало', 'F16', application.age, 1, 'Анкета 1');
  add('Начало', 'F17', experienceLabel(application.trainer_experience_level || candidate.trainer_experience_level), 1, 'Анкета 1');
  add('Начало', 'F18', garcia, 1, 'Анкета 1');
  add('Начало', 'B38', q.goals, 2);
  add('Начало', 'B41', q.achievements, 3);
  add('Итог', 'B14', application.motivation, 2, 'Анкета 1');
  add('Итог', 'F16', q.income);
  for (const [cell, key, rows] of [['F6','strengths',3],['F9','development',3],['F12','hobbies',2],['F14','family',1],['F15','children',1],['F16','readiness',1],['F17','work_history',5]]) add('Анкета 2 — сведения', cell, q[key], rows);
  splitJobs(q.work_history).forEach((job, index) => {
    const sheet = `Работа ${index + 1}`;
    add(sheet, 'F7', `Место ${index + 1} в исходном ответе; хронологию уточнить`);
    if (!job.organization) {
      add(sheet, 'F8', job.raw);
      return;
    }
    for (const [cell,key] of [['F8','organization'],['F9','sector'],['F10','role'],['F11','start'],['F12','end'],['F13','period']]) add(sheet,cell,job[key]);
  });
  return { version: 48, templateId: INTERVIEW_TEMPLATE_ID, candidateId: String(candidate.id), name: `Интервью на продуктивность — ${name}`, cells };
}
