export const slots={
  'mon-0800':'Понедельник, 08:00 МСК',
  'tue-0800':'Вторник, 08:00 МСК',
  'wed-0800':'Среда, 08:00 МСК',
  'thu-1800':'Четверг, 18:00 МСК',
  'fri-1800':'Пятница, 18:00 МСК',
};

const schedule={
  'mon-0800':[1,8],
  'tue-0800':[2,8],
  'wed-0800':[3,8],
  'thu-1800':[4,18],
  'fri-1800':[5,18],
};

export const isPrimarySlotAllowed=slotId=>Object.prototype.hasOwnProperty.call(slots,String(slotId||''));

export function nextInterview(slotId,now=new Date()){
  const [weekday,hour]=schedule[slotId]||schedule['mon-0800'];
  const moscow=new Date(now.getTime()+3*3600000);
  let days=(weekday-moscow.getUTCDay()+7)%7;
  if(days===0&&moscow.getUTCHours()>=hour)days=7;
  return new Date(Date.UTC(moscow.getUTCFullYear(),moscow.getUTCMonth(),moscow.getUTCDate()+days,hour-3)).toISOString();
}
