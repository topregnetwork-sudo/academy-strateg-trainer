const RETRIES = 3;
const isConcurrentUpdate = error => error?.code === '40001' || /tuple concurrently updated/i.test(String(error?.message || ''));

const pause = attempt => new Promise(resolve => setTimeout(resolve, attempt * 10));

async function updateWithRetry(run) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try { return await run(); }
    catch (error) {
      if (!isConcurrentUpdate(error)) throw error;
      lastError = error;
      if (attempt < RETRIES) await pause(attempt);
    }
  }
  throw lastError;
}

export async function claimFunnelTask(sql, id, leaseToken) {
  try {
    const row = (await sql`UPDATE funnel_tasks
      SET state='running',lease_token=${leaseToken},updated_at=NOW()
      WHERE id=${id}
        AND (state IN ('pending','attention') OR (state='running' AND updated_at<NOW()-INTERVAL '2 minutes'))
      RETURNING id`).rows[0];
    return Boolean(row);
  } catch (error) {
    // Concurrent retries may both have observed an eligible task. The losing
    // request is a normal busy result, not a failed task execution.
    if (isConcurrentUpdate(error)) return false;
    throw error;
  }
}

export async function finishFunnelTask(sql, id, leaseToken, result) {
  const row = (await updateWithRetry(() => sql`UPDATE funnel_tasks
    SET state=${result.done ? 'done' : 'pending'},error=NULL,lease_token=NULL,updated_at=NOW()
    WHERE id=${id} AND state='running' AND lease_token=${leaseToken}
    RETURNING id`)).rows[0];
  return Boolean(row);
}

export async function failFunnelTask(sql, id, leaseToken, error) {
  const message = String(error?.message || error).slice(0, 500);
  const row = (await updateWithRetry(() => sql`UPDATE funnel_tasks
    SET state='attention',error=${message},lease_token=NULL,updated_at=NOW()
    WHERE id=${id} AND state='running' AND lease_token=${leaseToken}
    RETURNING id`)).rows[0];
  return Boolean(row);
}
