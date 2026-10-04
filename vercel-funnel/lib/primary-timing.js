export const PRIMARY_REMINDER_BEFORE_MINUTES = 30;
export const PRIMARY_ENTRY_CUTOFF_AFTER_MINUTES = 10;
export const PRIMARY_NO_ENTRY_AFTER_MINUTES = 11;

export function primaryTaskDueAt(interviewAt, kind) {
  const start = Date.parse(interviewAt);
  if (!Number.isFinite(start)) throw new Error('Invalid primary interview time');
  const offset = kind === 'reminder'
    ? -PRIMARY_REMINDER_BEFORE_MINUTES
    : kind === 'no_show'
      ? PRIMARY_NO_ENTRY_AFTER_MINUTES
      : NaN;
  if (!Number.isFinite(offset)) throw new Error('Unknown primary task kind');
  return new Date(start + offset * 60000);
}
