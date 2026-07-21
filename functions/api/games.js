// Cloudflare Pages Function —— 路由 /api/games(D1 版)
// 游戏库已切换到 D1 数据库(sry-db 的 games 表)。
// 数据来源:1) 审核后台"从飞书同步"导入的老数据 2) 开发者提交并审核通过的新游戏。
// 输出结构与旧飞书版完全一致,前端 index.html / game.html 无需任何改动。
// 排序:sort 升序(同步时按飞书"网站排序"视图顺序写入),新审核通过的游戏 sort=0 排在最前。

export async function onRequestGet(context) {
  const env = context.env || {};
  const J = (o, s = 200) => new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
  if (!env.DB) return J({ error: "db_not_bound" }, 500);

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, claimed_by, slug, t_en, t_zh, t_ko, d_en, d_zh, d_ko, full_en, full_zh, full_ko,
              studio_en, studio_zh, studio_ko, developer, stage,
              genres, needs, platforms, region, cover, screenshots,
              studio_logo, video, contact, steam_url, sort
       FROM games
       WHERE visible = 1 AND status = 'approved' AND (t_en != '' OR t_zh != '')
       ORDER BY sort ASC, id DESC
       LIMIT 500`
    ).all();

    const parse = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

    const games = (results || []).map((r) => ({
      t_en: r.t_en || "", t_zh: r.t_zh || "", t_ko: r.t_ko || "",
      d_en: r.d_en || "", d_zh: r.d_zh || "", d_ko: r.d_ko || "",
      stage: r.stage || "Demo",
      genres: parse(r.genres),
      needs: parse(r.needs),
      platforms: parse(r.platforms),
      region: r.region || "",
      cover: r.cover || "",
      order: r.sort ?? 999,
      visible: true,
      full_en: r.full_en || "", full_zh: r.full_zh || "", full_ko: r.full_ko || "",
      developer: r.developer || "",
      studioLogo: r.studio_logo || "",
      studio_en: r.studio_en || "", studio_zh: r.studio_zh || "", studio_ko: r.studio_ko || "",
      video: r.video || "",
      screenshots: parse(r.screenshots),
      contact: r.contact || "",
      steam_url: r.steam_url || "",
      slug: r.slug || "",
      id: r.id,
      has_owner: !!r.claimed_by,
    }));

    return new Response(JSON.stringify(games), {
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
