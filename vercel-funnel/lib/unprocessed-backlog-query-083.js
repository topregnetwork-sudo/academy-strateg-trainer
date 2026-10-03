export async function latestOutgoingMessage083(sql, candidateId, kinds) {
  if (!Array.isArray(kinds) || kinds.some(kind => typeof kind !== 'string')) {
    throw new TypeError('Outgoing message kinds must be strings');
  }
  return (await sql`
    SELECT kind,text,created_at FROM messages
    WHERE candidate_id=${Number(candidateId)} AND direction='out'
      AND kind IN (SELECT jsonb_array_elements_text(${JSON.stringify(kinds)}::jsonb))
    ORDER BY created_at DESC,id DESC LIMIT 1
  `).rows[0] || null;
}
