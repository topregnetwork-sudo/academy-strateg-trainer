export const GOALS_URL='https://academy-strateg-trainer.vercel.app/goals.html';
export const PDF_URL='https://academy-strateg-trainer.vercel.app/academy-strateg-goals.pdf';
export function withGoals(text){return text.includes(GOALS_URL)?text:text+'\n\nИзучить Цели Академии Стратег: '+GOALS_URL;}
export function withGoalsHtml(text){return text.includes(GOALS_URL)?text:text+`\n\n<a href="${GOALS_URL}">Изучить Цели Академии Стратег</a>\n<a href="${PDF_URL}">Скачать PDF</a>`;}
export function withGoalsKeyboard(keyboard){return {inline_keyboard:[...keyboard.inline_keyboard,[{text:'Изучить Цели Академии',url:GOALS_URL},{text:'Скачать PDF',url:PDF_URL}]]};}
