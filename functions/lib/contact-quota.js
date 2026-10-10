export const PARTNER_MONTHLY_QUOTA = 10;
export const quotaForRole = role => role === 'partner' ? PARTNER_MONTHLY_QUOTA : 5;
export const monthKey = () => new Date().toISOString().slice(0, 7);
export async function usedThisMonth(env, accountId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM contact_views WHERE viewer_id = ? AND ym = ?')
    .bind(accountId, monthKey()).first();
  return row?.c || 0;
}
