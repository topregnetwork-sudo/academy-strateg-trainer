import crypto from 'node:crypto';

export function offlineTaskId(kind, value) {
  const hex = crypto.createHash('sha256').update(`offline-photo-001:${kind}:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
