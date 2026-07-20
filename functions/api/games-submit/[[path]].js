// Cloudflare Pages Function —— 游戏提交(开发者)
//   GET  /api/games-submit/mine    → 我提交的游戏及审核状态
//   POST /api/games-submit/create  → 提交新游戏(入库为待审核,不上架)
//   POST /api/games-submit/upload  → 封面/截图上传 R2(multipart: file + kind[cover|shot])
// 依赖:env.DB、env.R2、env.SESSION_SECRET

const COOKIE = "sry_session";
const ASSET_HOST = "https://assets.srygamehub.com";
const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED_IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CODE_TTL_MIN = 10, SEND_COOLDOWN_S = 60, SEND_HOURLY_MAX = 5, SESSION_DAYS = 30;
const FROM = "SRY Game Hub <noreply@srygamehub.com>";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
const bad = (error, status = 400) => json({ ok: false, error }, status);

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64urlEnc = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
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

async function sendCodeEmail(env, email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [email],
      subject: `${code} is your SRY Game Hub verification code`,
      text: `Your verification code is: ${code}\n\nIt expires in ${CODE_TTL_MIN} minutes.\n\nSRY Game Hub · srygamehub.com`,
      html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px 8px;color:#111"><div style="font-weight:900;font-size:15px;margin-bottom:18px">▪ SRY GAME HUB</div><p style="font-size:14px;margin:0 0 10px">Your verification code:</p><div style="font-size:32px;font-weight:900;letter-spacing:8px;background:#0c0d0a;color:#c6f24e;padding:16px 0;text-align:center;border-radius:8px">${code}</div><p style="font-size:12px;color:#666;margin:14px 0 0">Expires in ${CODE_TTL_MIN} minutes.</p></div>`,
    }),
  });
  if (!res.ok) throw new Error("Resend " + res.status);
}

const S = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const isUrl = (v) => v === "" || /^https?:\/\/\S+$/i.test(v);
const inSet = (v, set) => set.includes(v);
const arrOf = (v, set, maxLen) => {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map((x) => String(x)))].filter((x) => set.includes(x));
  if (out.length === 0 || out.length > maxLen) return null;
  return out;
};

const GENRES = ["Action","Adventure","RPG","Strategy","Simulation","Puzzle","Platformer","Shooter","Survival","Horror","Roguelite","Metroidvania","Souls-like","Visual Novel","Card Game","Open World","Narrative","Comedy","Co-op","Multiplayer"];
const STAGES = ["In Development","Demo","Playtest","Early Access","Released"];
const PLATFORMS = ["PC","Console","Mobile"];
const MARKETS = ["Global","China","Overseas"];
const NEEDS = ["Seeking Publisher","Seeking Publisher Partner","Seeking Investment"];

const slugify = (t) => {
  const base = String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const rand = crypto.randomUUID().slice(0, 6);
  return (base || "game") + "-" + rand;
};

async function handleSendCode(env, request) {
  const { email: raw } = await request.json().catch(() => ({}));
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad("invalid_email");
  await env.DB.prepare("DELETE FROM login_codes WHERE expires_at < datetime('now','-1 day')").run();
  const recent = await env.DB.prepare(
    `SELECT SUM(CASE WHEN created_at > datetime('now', ?) THEN 1 ELSE 0 END) AS cd,
            SUM(CASE WHEN created_at > datetime('now','-1 hour') THEN 1 ELSE 0 END) AS hr
     FROM login_codes WHERE email = ?`
  ).bind(`-${SEND_COOLDOWN_S} seconds`, email).first();
  if ((recent?.cd || 0) > 0) return bad("cooldown", 429);
  if ((recent?.hr || 0) >= SEND_HOURLY_MAX) return bad("hourly_limit", 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const hash = await sha256hex(email + ":" + code);
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0").bind(email).run();
  await env.DB.prepare("INSERT INTO login_codes (email, code, expires_at) VALUES (?, ?, datetime('now', ?))")
    .bind(email, hash, `+${CODE_TTL_MIN} minutes`).run();
  await sendCodeEmail(env, email, code);
  return json({ ok: true });
}

async function handleVerify(env, request) {
  const { email: raw, code } = await request.json().catch(() => ({}));
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !/^\d{6}$/.test(String(code || ""))) return bad("invalid_input");
  const hash = await sha256hex(email + ":" + code);
  const row = await env.DB.prepare(
    `SELECT id FROM login_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
  ).bind(email, hash).first();
  if (!row) { await new Promise((r) => setTimeout(r, 400)); return bad("wrong_or_expired_code", 401); }
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ?").bind(email).run();

  // 找账号;不存在→建 developer(直接激活);存在且为 partner→拒绝走这个入口
  let account = await env.DB.prepare("SELECT id, role FROM accounts WHERE email = ?").bind(email).first();
  if (!account) {
    const r = await env.DB.prepare("INSERT INTO accounts (email, role, status) VALUES (?, 'developer', 'verified')").bind(email).run();
    account = { id: r.meta.last_row_id, role: "developer" };
  } else if (account.role !== "developer") {
    return bad("not_a_developer", 403);
  }
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = b64urlEnc(JSON.stringify({ aid: account.id, email, exp }));
  const token = body + "." + (await hmacHex(env.SESSION_SECRET, body));
  const dp = await env.DB.prepare("SELECT studio_name FROM developer_profiles WHERE account_id = ?").bind(account.id).first();
  return json({ ok: true, studio_name: (dp && dp.studio_name) || "" }, 200,
    { "set-cookie": `sry_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` });
}

async function requireDeveloper(env, s) {
  const account = await env.DB.prepare(
    "SELECT id, role FROM accounts WHERE id = ?"
  ).bind(s.aid).first();
  if (!account) return null;
  if (account.role !== "developer") return null;
  return account;
}

async function handleMine(env, s) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, t_en, t_zh, t_ko, cover, status, review_note, created_at
     FROM games WHERE claimed_by = ? ORDER BY id DESC LIMIT 100`
  ).bind(s.aid).all();
  return json({ ok: true, rows: results || [] });
}

async function handleCreate(env, s, request) {
  const b = await request.json().catch(() => ({}));

  const t_en = S(b.t_en, 120), t_zh = S(b.t_zh, 120), t_ko = S(b.t_ko, 120);
  const d_en = S(b.d_en, 160);
  const full_en = S(b.full_en, 2000);
  const stage = S(b.stage, 30);
  const genres = arrOf(b.genres, GENRES, 20);
  const platforms = arrOf(b.platforms, PLATFORMS, 3);
  const region = S(b.region, 20);
  const needs = arrOf(b.needs, NEEDS, 3);
  const steam_url = S(b.steam_url, 400);
  const video = S(b.video, 400);
  const cover = S(b.cover, 500);
  const screenshots = Array.isArray(b.screenshots)
    ? b.screenshots.map((x) => S(x, 500)).filter(Boolean).slice(0, 5) : [];

  if (!t_en && !t_zh && !t_ko) return bad("title_required");
  if (!d_en) return bad("pitch_required");
  if (!full_en) return bad("desc_required");
  if (!inSet(stage, STAGES)) return bad("stage_required");
  if (!genres) return bad("genres_required");
  if (!platforms) return bad("platforms_required");
  if (!inSet(region, MARKETS)) return bad("market_required");
  if (!needs) return bad("needs_required");
  if (!isUrl(steam_url) || !isUrl(video)) return bad("url_invalid");
  if (!cover) return bad("cover_required");
  if (!screenshots.length) return bad("shots_required");

  // 开发商展示名取自工作室信息
  const studioInput = S(b.studio_name, 120);
  let dp = await env.DB.prepare("SELECT studio_name FROM developer_profiles WHERE account_id = ?").bind(s.aid).first();
  if (studioInput && (!dp || !dp.studio_name)) {
    await env.DB.prepare(
      `INSERT INTO developer_profiles (account_id, studio_name, contact_email, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET studio_name=excluded.studio_name, updated_at=datetime('now')`
    ).bind(s.aid, studioInput, s.email).run();
    dp = { studio_name: studioInput };
  }
  const developer = studioInput || (dp && dp.studio_name) || "";

  await env.DB.prepare(
    `INSERT INTO games (slug, t_en, t_zh, t_ko, d_en, full_en, developer, stage,
                        genres, needs, platforms, region, cover, screenshots, video, steam_url,
                        claimed_by, visible, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', datetime('now'))`
  ).bind(
    slugify(t_en || t_zh || t_ko), t_en, t_zh, t_ko, d_en, full_en, developer, stage,
    JSON.stringify(genres), JSON.stringify(needs), JSON.stringify(platforms), region,
    cover, JSON.stringify(screenshots), video, steam_url, s.aid
  ).run();

  return json({ ok: true });
}

async function handleUpload(env, s, request) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad("bad_form");
  const file = form.get("file");
  const kind = String(form.get("kind") || "");
  if (!file || typeof file === "string") return bad("file_required");
  if (kind !== "cover" && kind !== "shot") return bad("kind_invalid");
  const ext = ALLOWED_IMG[file.type];
  if (!ext) return bad("type_not_allowed");
  if (file.size > MAX_UPLOAD) return bad("too_large");

  const key = `${kind}/${s.aid}-${crypto.randomUUID()}.${ext}`;
  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000" },
  });
  return json({ ok: true, url: `${ASSET_HOST}/${key}` });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const method = request.method;

  try {
    if (!env.DB || !env.R2 || !env.SESSION_SECRET) return bad("env_missing", 500);
    if (method === "POST" && path === "send-code") return await handleSendCode(env, request);
    if (method === "POST" && path === "verify") return await handleVerify(env, request);

    const s = await readSession(env, request);
    if (!s) return bad("not_logged_in", 401);
    const dev = await requireDeveloper(env, s);
    if (!dev) return bad("developer_only", 403);

    if (method === "GET" && path === "mine") return await handleMine(env, s);
    if (method === "POST" && path === "create") return await handleCreate(env, s, request);
    if (method === "POST" && path === "upload") return await handleUpload(env, s, request);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
