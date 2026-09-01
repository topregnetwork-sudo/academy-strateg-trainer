export const CLOSED_CANDIDATE_STATUSES = new Set([
  'test_1_incomplete_removed',
  'rejected',
  'cancelled',
  'selection_closed',
  'academy_contact'
]);

const TEST_KEYWORD = /^\s*[«"']?тест(?:\s*[-–—]?\s*1)?[»"']?[.!]?\s*$/iu;

export function isCandidateTestKeyword(text) {
  return TEST_KEYWORD.test(String(text || ''));
}

export function isClosedCandidateStatus(status) {
  return CLOSED_CANDIDATE_STATUSES.has(String(status || ''));
}
