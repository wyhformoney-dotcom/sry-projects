// Cloudflare Pages Function —— 路由 /api/partners(公开)
// 返回所有已认证(verified)的合作方公开资料,供 Partners 列表页展示。
// 不包含联系邮箱、认证材料等非公开字段。

export async function onRequestGet(context) {
  const env = context.env || {};
  const J = (o, s = 200) => new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
  if (!env.DB) return J({ error: "db_not_bound" }, 500);

  try {
    const { results } = await env.DB.prepare(
      `SELECT p.account_id AS id, p.name_zh, p.name_en, p.name_ko, p.logo,
              p.kinds, p.region, p.intro_en, p.intro_zh, p.intro_ko,
              p.steam_url, p.website, p.sort
       FROM partner_profiles p
       JOIN accounts a ON a.id = p.account_id
       WHERE a.status = 'verified' AND a.role = 'partner'
       ORDER BY p.sort ASC, p.account_id DESC
       LIMIT 300`
    ).all();

    const parse = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
    const rows = (results || []).map((r) => ({
      id: r.id,
      name_en: r.name_en || "", name_zh: r.name_zh || "", name_ko: r.name_ko || "",
      logo: r.logo || "",
      kinds: parse(r.kinds),
      region: r.region || "",
      intro_en: r.intro_en || "", intro_zh: r.intro_zh || "", intro_ko: r.intro_ko || "",
      steam_url: r.steam_url || "",
      website: r.website || "",
    }));

    return new Response(JSON.stringify(rows), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return J({ error: "exception", detail: String((e && e.message) || e) }, 500);
  }
}
