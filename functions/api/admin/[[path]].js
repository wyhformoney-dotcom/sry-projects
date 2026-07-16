// Cloudflare Pages Function —— 审核后台(仅管理员)
//   GET  /api/admin/partners?status=pending|verified|rejected|all → 合作方账号列表(含完整资料)
//   POST /api/admin/review { id, action: "approve"|"reject", note? } → 通过/驳回
// 权限:正常登录 + 登录邮箱在 env.ADMIN_EMAILS 名单内(逗号分隔)
// 依赖:env.DB、env.SESSION_SECRET、env.ADMIN_EMAILS

const COOKIE = "sry_session";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
const bad = (error, status = 400) => json({ ok: false, error }, status);

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
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

const isAdmin = (env, s) =>
  !!s && (env.ADMIN_EMAILS || "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
    .includes((s.email || "").toLowerCase());

async function handleList(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const where = ["a.role = 'partner'"];
  const binds = [];
  if (["pending", "verified", "rejected", "suspended"].includes(status)) {
    where.push("a.status = ?"); binds.push(status);
  }
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.email AS login_email, a.status, a.created_at,
            p.name_zh, p.name_en, p.name_ko, p.logo, p.kinds, p.region, p.intro,
            p.genres, p.markets, p.steam_url, p.website, p.contact_email,
            p.proof_type, p.proof_image, p.verified_email, p.review_note, p.updated_at
     FROM accounts a
     LEFT JOIN partner_profiles p ON p.account_id = a.id
     WHERE ${where.join(" AND ")}
     ORDER BY a.created_at DESC LIMIT 200`
  ).bind(...binds).all();

  const rows = (results || []).map((r) => {
    for (const k of ["kinds", "genres", "markets"]) {
      try { r[k] = JSON.parse(r[k] || "[]"); } catch { r[k] = []; }
    }
    return r;
  });

  // 各状态数量(给页签角标)
  const { results: cnt } = await env.DB.prepare(
    "SELECT status, COUNT(*) AS c FROM accounts WHERE role='partner' GROUP BY status"
  ).all();
  const counts = {};
  (cnt || []).forEach((x) => { counts[x.status] = x.c; });

  return json({ ok: true, rows, counts });
}

async function handleReview(env, request) {
  const { id, action, note } = await request.json().catch(() => ({}));
  const aid = parseInt(id, 10);
  if (!aid) return bad("invalid_id");
  if (action !== "approve" && action !== "reject") return bad("invalid_action");
  if (action === "reject" && !String(note || "").trim()) return bad("note_required");

  const account = await env.DB.prepare(
    "SELECT id FROM accounts WHERE id = ? AND role = 'partner'"
  ).bind(aid).first();
  if (!account) return bad("not_found", 404);

  await env.DB.prepare("UPDATE accounts SET status = ? WHERE id = ?")
    .bind(action === "approve" ? "verified" : "rejected", aid).run();

  const cleanNote = String(note || "").trim().slice(0, 500);
  if (cleanNote || action === "reject") {
    await env.DB.prepare(
      `INSERT INTO partner_profiles (account_id, review_note, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET review_note=excluded.review_note, updated_at=datetime('now')`
    ).bind(aid, cleanNote).run();
  }
  return json({ ok: true });
}

async function handleGamesList(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const where = ["g.claimed_by IS NOT NULL"];
  const binds = [];
  if (["pending", "approved", "rejected"].includes(status)) {
    where.push("g.status = ?"); binds.push(status);
  }
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.t_en, g.t_zh, g.t_ko, g.d_en, g.full_en, g.stage,
            g.genres, g.needs, g.platforms, g.region, g.cover, g.screenshots,
            g.video, g.steam_url, g.status, g.review_note, g.created_at,
            a.email AS login_email, dp.studio_name
     FROM games g
     LEFT JOIN accounts a ON a.id = g.claimed_by
     LEFT JOIN developer_profiles dp ON dp.account_id = g.claimed_by
     WHERE ${where.join(" AND ")}
     ORDER BY g.id DESC LIMIT 200`
  ).bind(...binds).all();

  const rows = (results || []).map((r) => {
    for (const k of ["genres", "needs", "platforms", "screenshots"]) {
      try { r[k] = JSON.parse(r[k] || "[]"); } catch { r[k] = []; }
    }
    return r;
  });

  const { results: cnt } = await env.DB.prepare(
    "SELECT status, COUNT(*) AS c FROM games WHERE claimed_by IS NOT NULL GROUP BY status"
  ).all();
  const counts = {};
  (cnt || []).forEach((x) => { counts[x.status] = x.c; });
  return json({ ok: true, rows, counts });
}

async function handleReviewGame(env, request) {
  const { id, action, note } = await request.json().catch(() => ({}));
  const gid = parseInt(id, 10);
  if (!gid) return bad("invalid_id");
  if (action !== "approve" && action !== "reject") return bad("invalid_action");
  if (action === "reject" && !String(note || "").trim()) return bad("note_required");

  const game = await env.DB.prepare(
    "SELECT id FROM games WHERE id = ? AND claimed_by IS NOT NULL"
  ).bind(gid).first();
  if (!game) return bad("not_found", 404);

  const cleanNote = String(note || "").trim().slice(0, 500);
  if (action === "approve") {
    await env.DB.prepare(
      "UPDATE games SET status='approved', visible=1, review_note=? WHERE id = ?"
    ).bind(cleanNote, gid).run();
  } else {
    await env.DB.prepare(
      "UPDATE games SET status='rejected', visible=0, review_note=? WHERE id = ?"
    ).bind(cleanNote, gid).run();
  }
  return json({ ok: true });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const method = request.method;

  try {
    if (!env.DB || !env.SESSION_SECRET) return bad("env_missing", 500);
    const s = await readSession(env, request);
    if (!s) return bad("not_logged_in", 401);
    if (!isAdmin(env, s)) return bad("forbidden", 403);

    if (method === "GET" && path === "partners") return await handleList(env, request);
    if (method === "POST" && path === "review") return await handleReview(env, request);
    if (method === "GET" && path === "games") return await handleGamesList(env, request);
    if (method === "POST" && path === "review-game") return await handleReviewGame(env, request);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
