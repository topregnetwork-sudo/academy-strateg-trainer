import { normalizeOfflineCity, parseOfflineTestDate } from './offline-photo-batching.js';

const clean = value => String(value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е')
  .replace(/[^а-яa-z0-9]+/g, ' ').trim();
const digits = value => String(value || '').replace(/\D/g, '');

export function offlineDateCandidates(text) {
  const normalized = String(text || '').replace(/(\d)\s*([./-])\s*(?=\d)/g, '$1$2');
  const matches = normalized.match(/(?:20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]20\d{2})/g) || [];
  return [...new Set(matches.map(parseOfflineTestDate).filter(Boolean))];
}

export function offlineDateEvidence(text) {
  const dates = offlineDateCandidates(text);
  return dates.length === 1 ? dates[0] : null;
}

export function offlineCityCandidates(text) {
  const matches = String(text || '').toLocaleLowerCase('ru').match(/(?<![а-яa-z])(?:минск(?:е)?|челябинск(?:е)?|minsk|chelyabinsk)(?![а-яa-z])/g) || [];
  return [...new Set(matches.map(normalizeOfflineCity).filter(Boolean))];
}

export function offlineCityEvidence(text) {
  const cities = offlineCityCandidates(text);
  return cities.length === 1 ? cities[0] : null;
}

export function identifyOfflineCandidate(text, candidates) {
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = rawLines.map(clean).filter(Boolean);
  // Graphs and scored tests contain long columns of numbers. Only treat a
  // number as a phone when its own line is labelled as a phone or starts with +.
  const phoneLines = rawLines.filter(line => /(?:тел(?:ефон)?|phone|моб(?:ильный)?)/iu.test(line) || /^\s*\+/.test(line));
  const observedPhones = [...new Set((phoneLines.join('\n').match(/\+?\d[\d \t\-()]{8,20}\d/g) || [])
    .map(digits).filter(phone => phone.length >= 9 && phone.length <= 15))];
  if (observedPhones.length > 1) return null;
  const possible = (candidates || []).filter(candidate => {
    const name = clean(candidate.fullName).split(' ').filter(Boolean);
    if (name.length < 2) return false;
    const nameMatched = lines.some(line => {
      const tokens = new Set(line.split(' '));
      return name.length >= 3 ? name.every(token => tokens.has(token)) : name.every(token => tokens.has(token));
    });
    if (!nameMatched) return false;
    const phone = digits(candidate.phone);
    if (observedPhones.length && phone && !observedPhones.some(observed => observed === phone)) return false;
    return true;
  });
  return possible.length === 1 ? possible[0] : null;
}
