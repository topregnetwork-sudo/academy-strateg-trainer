const CITY_ALIASES = new Map([
  ['минск', 'Минск'], ['минске', 'Минск'], ['minsk', 'Минск'],
  ['челябинск', 'Челябинск'], ['челябинске', 'Челябинск'], ['chelyabinsk', 'Челябинск']
]);

export function normalizeOfflineCity(value) {
  const city = String(value || '').trim().replace(/\s+/g, ' ');
  if (!city || /^(?:не указан|не указано|город не указан|unknown|n\/a|[-—])$/i.test(city)) return null;
  return CITY_ALIASES.get(city.toLocaleLowerCase('ru')) || city;
}

export function parseOfflineTestDate(value) {
  const text = String(value || '');
  const iso = text.match(/(?:^|\D)(20\d{2})[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])(?:\D|$)/);
  const local = text.match(/(?:^|\D)(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})(?:\D|$)/);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] :
    local ? [Number(local[3]), Number(local[2]), Number(local[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function resolveOfflineEvent({ photoDate, captionDate, candidateEventDate, photoCity, captionCity, candidateEventCity }) {
  const dates = [photoDate, captionDate, candidateEventDate].map(parseOfflineTestDate).filter(Boolean);
  const cities = [photoCity, captionCity, candidateEventCity].map(normalizeOfflineCity).filter(Boolean);
  if (!dates.length || !cities.length || new Set(dates).size !== 1 || new Set(cities).size !== 1) return null;
  return { date: dates[0], city: cities[0], key: `${dates[0]}|${cities[0]}` };
}

const nameTokens = value => String(value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е')
  .replace(/[^а-яa-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
const phoneDigits = value => String(value || '').replace(/\D/g, '');

export function matchOfflineCandidate({ handwrittenName, handwrittenPhone, candidates }) {
  const observedName = nameTokens(handwrittenName), observedPhone = phoneDigits(handwrittenPhone);
  if (!Array.isArray(candidates) || (!observedName.length && observedPhone.length < 9)) return null;
  const possible = candidates.filter(candidate => {
    const names = nameTokens(candidate.fullName || `${candidate.lastName || ''} ${candidate.firstName || ''}`);
    const phone = phoneDigits(candidate.phone);
    if (observedPhone.length >= 9 && phone && phone !== observedPhone) return false;
    const phoneAgree = observedPhone.length >= 9 && phone && phone === observedPhone;
    const nameAgree = observedName.length >= 2 && observedName.slice(0, 2).every(token => names.includes(token));
    return phoneAgree ? (!observedName.length || nameAgree) : nameAgree && observedName.length >= 3 && observedName.every(token => names.includes(token));
  });
  return possible.length === 1 ? possible[0] : null;
}

export function shouldPublishOfflineBrief({ latestPhotoAt, now = new Date(), quietMinutes = 60, cutoffHourMoscow = 21 }) {
  if (!latestPhotoAt) return false;
  const latest = new Date(latestPhotoAt), current = new Date(now);
  if (Number.isNaN(latest.getTime()) || Number.isNaN(current.getTime()) || current < latest) return false;
  if (current.getTime() - latest.getTime() >= quietMinutes * 60000) return true;
  const moscow = new Date(current.getTime() + 3 * 3600000);
  return moscow.getUTCHours() >= cutoffHourMoscow;
}

export function renderOfflineBrief({ date, city, candidates }) {
  const event = resolveOfflineEvent({ photoDate: date, photoCity: city });
  if (!event || !Array.isArray(candidates) || !candidates.length) throw new Error('A verified event and candidate folders are required');
  const [year, month, day] = event.date.split('-');
  const heading = `Прошедшие офлайн-тестирование ${day}.${month}.${year}, ${event.city}. Фото можно посмотреть по ссылке напротив имени.`;
  const pairs = [...candidates].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((candidate,index) => {
    const name = String(candidate.name || '').trim();
    const url = String(candidate.folderUrl || '').trim();
    if (!name || !/^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(url))
      throw new Error('Only verified candidate names and direct Drive folder URLs may enter the brief');
    return `${index+1}. ${name}\n${url}`;
  });
  return `${heading}\n\n${pairs.join('\n\u00a0\n')}`;
}
