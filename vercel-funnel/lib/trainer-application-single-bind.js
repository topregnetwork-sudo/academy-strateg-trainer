export async function claimTrainerApplication(input, store) {
  const code = String(input?.code || '');
  const chatId = String(input?.chatId || '');
  if (!/^[a-zA-Z0-9]{20}$/.test(code) || !chatId) return { kind: 'missing' };

  return store.withApplicationLock(code, async context => {
    const app = context.app;
    if (!app) return { kind: 'missing' };

    if (app.candidate_id) {
      const candidate = await context.getCandidate(app.candidate_id);
      if (!candidate || String(candidate.chat_id) !== chatId) {
        return { kind: 'claimed_elsewhere' };
      }
      return { kind: 'same_chat', app, candidate };
    }

    const candidate = await context.upsertCandidate(app, input);
    const bound = await context.bindApplication(app.id, candidate.id);
    if (!bound) throw new Error('Trainer application claim lost while the application row was locked');
    return { kind: 'first_bind', app: { ...app, candidate_id: candidate.id }, candidate };
  });
}
