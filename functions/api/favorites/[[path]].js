// Cloudflare Pages Function —— 收藏游戏(仅已认证合作方)
//   GET  /api/favorites/mine   → 我收藏的游戏列表
//   GET  /api/favorites/ids    → 我收藏的游戏 id 列表(详情页判断按钮状态)
//   POST /api/favorites/toggle → { game_id } 收藏/取消,返回 { faved }
const COOKIE = "sry_session";
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const bad = (e, s = 400) => json({ ok: false, error: e }, s);

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64urlDec = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
async function readSession(env, request) {
  try {
    const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
    if (!m) return null;
    const [body, sig] = m[1].split(".");
    if (!body || !sig || (await hmacHex(env.SESSION_SECRET, body)) !== sig) return null;
    const p = JSON.parse(b64urlDec(body));
    if (!p.exp || Date.now() > p.exp || !p.aid) return null;
    return p;
  } catch { return null; }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  try {
    if (!env.DB || !env.SESSION_SECRET) return bad("env_missing", 500);
    const s = await readSession(env, request);
    if (!s) return bad("not_logged_in", 401);
    const acc = await env.DB.prepare("SELECT id, role, status FROM accounts WHERE id = ?").bind(s.aid).first();
    if (!acc) return bad("not_logged_in", 401);
    if (acc.role !== "partner") return bad("partner_only", 403);
    if (acc.status !== "verified") return bad("not_verified", 403);

    if (request.method === "GET" && path === "ids") {
      const { results } = await env.DB.prepare("SELECT game_id FROM favorites WHERE account_id = ?").bind(acc.id).all();
      return json({ ok: true, ids: (results || []).map((r) => r.game_id) });
    }

    if (request.method === "GET" && path === "mine") {
      const { results } = await env.DB.prepare(
        `SELECT g.id, g.slug, g.t_en, g.t_zh, g.t_ko, g.cover, g.developer, g.stage, g.featured, f.created_at
         FROM favorites f JOIN games g ON g.id = f.game_id
         WHERE f.account_id = ? AND g.status = 'approved' AND g.visible = 1
         ORDER BY f.id DESC LIMIT 100`
      ).bind(acc.id).all();
      return json({ ok: true, rows: results || [] });
    }

    if (request.method === "POST" && path === "toggle") {
      const { game_id } = await request.json().catch(() => ({}));
      const gid = parseInt(game_id, 10);
      if (!gid) return bad("invalid_id");
      const g = await env.DB.prepare("SELECT id FROM games WHERE id = ? AND status = 'approved'").bind(gid).first();
      if (!g) return bad("not_found", 404);
      const ex = await env.DB.prepare("SELECT id FROM favorites WHERE account_id = ? AND game_id = ?").bind(acc.id, gid).first();
      if (ex) {
        await env.DB.prepare("DELETE FROM favorites WHERE id = ?").bind(ex.id).run();
        return json({ ok: true, faved: false });
      }
      await env.DB.prepare("INSERT INTO favorites (account_id, game_id) VALUES (?, ?)").bind(acc.id, gid).run();
      return json({ ok: true, faved: true });
    }
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
