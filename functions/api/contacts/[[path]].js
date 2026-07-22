// Cloudflare Pages Function —— 联系方式解锁(配额制)
//   POST /api/contacts/reveal  → 解锁一个联系方式 { type:'developer'|'partner', game_id?|target_id? }
//   GET  /api/contacts/mine    → 我已解锁的列表 + 本月额度
// 规则:
//   - 合作方(已认证)解锁开发者;开发者解锁合作方(已认证)
//   - 每自然月每账号最多解锁 MONTHLY_QUOTA 个"不同的人";重复查看同一人不扣额度
//   - 解锁单位是账号(人),不是游戏:解锁某开发者后,其所有游戏的联系方式都可见
// 依赖:env.DB、env.SESSION_SECRET

const COOKIE = "sry_session";
const MONTHLY_QUOTA = 5; // ← 想调整每月额度改这里
const FALLBACK_EMAIL = "wangyanhui@sryinteractive.com";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
const bad = (error, status = 400, extra = {}) => json({ ok: false, error, ...extra }, status);

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64urlDec = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

async function readSession(env, request) {
  try {
    const cookie = request.headers.get("cookie") || "";
    const m = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
    if (!m) return null;
    const [body, sig] = m[1].split(".");
    if (!body || !sig) return null;
    if ((await hmacHex(env.SESSION_SECRET, body)) !== sig) return null;
    const p = JSON.parse(b64urlDec(body));
    if (!p.exp || Date.now() > p.exp || !p.aid) return null;
    return p;
  } catch { return null; }
}

const ym = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

async function usedThisMonth(env, viewerId) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM contact_views WHERE viewer_id = ? AND ym = ?"
  ).bind(viewerId, ym()).first();
  return (r && r.c) || 0;
}

async function handleReveal(env, s, request) {
  const b = await request.json().catch(() => ({}));
  const type = String(b.type || "");
  if (type !== "developer" && type !== "partner") return bad("invalid_type");

  const viewer = await env.DB.prepare(
    "SELECT id, role, status FROM accounts WHERE id = ?"
  ).bind(s.aid).first();
  if (!viewer) return bad("not_logged_in", 401);

  let targetId = 0, contact = "", name = "";

  if (type === "developer") {
    // 合作方(已认证)解锁开发者:通过 game_id 定位
    if (viewer.role !== "partner") return bad("partner_only", 403);
    if (viewer.status !== "verified") return bad("not_verified", 403);
    const gid = parseInt(b.game_id, 10);
    if (!gid) return bad("invalid_id");
    const game = await env.DB.prepare(
      "SELECT id, claimed_by, developer FROM games WHERE id = ? AND status = 'approved'"
    ).bind(gid).first();
    if (!game) return bad("not_found", 404);
    targetId = game.claimed_by || 0;
    let dp = null, acc = null;
    if (targetId) {
      dp = await env.DB.prepare(
        "SELECT studio_name, contact_email FROM developer_profiles WHERE account_id = ?"
      ).bind(targetId).first();
      acc = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?").bind(targetId).first();
    }
    contact = (dp && dp.contact_email) || (acc && acc.email) || "";
    name = (dp && dp.studio_name) || game.developer || "";
    if (!contact) {
      const usedNow = await usedThisMonth(env, viewer.id);
      return json({ ok: true, contact: FALLBACK_EMAIL, name, fallback: true, used: usedNow, quota: MONTHLY_QUOTA });
    }
  } else {
    // 合作方看自己的联系方式:直接放行(不扣额度)
    const selfId = parseInt(b.target_id, 10);
    if (viewer.role === "partner" && selfId === viewer.id) {
      const me = await env.DB.prepare(
        "SELECT contact_email, name_en, name_zh FROM partner_profiles WHERE account_id = ?"
      ).bind(viewer.id).first();
      if (!me || !me.contact_email) return bad("no_contact", 404);
      const usedNow = await usedThisMonth(env, viewer.id);
      return json({ ok: true, contact: me.contact_email, name: me.name_en || me.name_zh || "",
                    self: true, used: usedNow, quota: MONTHLY_QUOTA });
    }
    // 开发者解锁合作方(已认证)
    if (viewer.role !== "developer") return bad("developer_only", 403);
    const approved = await env.DB.prepare(
      "SELECT 1 FROM games WHERE claimed_by = ? AND status = 'approved' LIMIT 1"
    ).bind(viewer.id).first();
    if (!approved) return bad("no_approved_game", 403);
    targetId = parseInt(b.target_id, 10);
    if (!targetId) return bad("invalid_id");
    const tp = await env.DB.prepare(
      `SELECT a.status, p.contact_email, p.name_en, p.name_zh
       FROM accounts a JOIN partner_profiles p ON p.account_id = a.id
       WHERE a.id = ? AND a.role = 'partner'`
    ).bind(targetId).first();
    if (!tp || tp.status !== "verified") return bad("not_found", 404);
    contact = tp.contact_email || "";
    name = tp.name_en || tp.name_zh || "";
    if (!contact) {
      const usedNow = await usedThisMonth(env, viewer.id);
      return json({ ok: true, contact: FALLBACK_EMAIL, name, fallback: true, used: usedNow, quota: MONTHLY_QUOTA });
    }
  }

  // 已解锁过 → 免费返回
  const existed = await env.DB.prepare(
    "SELECT id FROM contact_views WHERE viewer_id = ? AND target_type = ? AND target_id = ?"
  ).bind(viewer.id, type, targetId).first();
  const used = await usedThisMonth(env, viewer.id);
  if (existed) return json({ ok: true, contact, name, already: true, used, quota: MONTHLY_QUOTA });

  // 额度检查
  if (used >= MONTHLY_QUOTA) return bad("quota_exceeded", 429, { used, quota: MONTHLY_QUOTA });

  await env.DB.prepare(
    "INSERT INTO contact_views (viewer_id, target_type, target_id, ym) VALUES (?, ?, ?, ?)"
  ).bind(viewer.id, type, targetId, ym()).run();

  return json({ ok: true, contact, name, already: false, used: used + 1, quota: MONTHLY_QUOTA });
}

async function handleMine(env, s) {
  const viewer = await env.DB.prepare(
    "SELECT id, role FROM accounts WHERE id = ?"
  ).bind(s.aid).first();
  if (!viewer) return bad("not_logged_in", 401);

  const { results } = await env.DB.prepare(
    `SELECT cv.target_type, cv.target_id, cv.viewed_at,
            dp.studio_name, dp.contact_email AS dev_contact, da.email AS dev_email,
            pp.name_en, pp.name_zh, pp.contact_email AS par_contact
     FROM contact_views cv
     LEFT JOIN developer_profiles dp ON cv.target_type = 'developer' AND dp.account_id = cv.target_id
     LEFT JOIN accounts da           ON cv.target_type = 'developer' AND da.id = cv.target_id
     LEFT JOIN partner_profiles pp   ON cv.target_type = 'partner'   AND pp.account_id = cv.target_id
     WHERE cv.viewer_id = ?
     ORDER BY cv.id DESC LIMIT 100`
  ).bind(viewer.id).all();

  const rows = (results || []).map((r) => ({
    type: r.target_type,
    name: r.target_type === "developer" ? (r.studio_name || "") : (r.name_en || r.name_zh || ""),
    contact: r.target_type === "developer" ? (r.dev_contact || r.dev_email || "") : (r.par_contact || ""),
    viewed_at: r.viewed_at,
  }));
  const used = await usedThisMonth(env, viewer.id);
  return json({ ok: true, rows, used, quota: MONTHLY_QUOTA, role: viewer.role });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const method = request.method;
  try {
    if (!env.DB || !env.SESSION_SECRET) return bad("env_missing", 500);
    const s = await readSession(env, request);
    if (!s) return bad("not_logged_in", 401);
    if (method === "POST" && path === "reveal") return await handleReveal(env, s, request);
    if (method === "GET" && path === "mine") return await handleMine(env, s);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
