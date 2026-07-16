// Cloudflare Pages Function —— 游戏提交(开发者)
//   GET  /api/games-submit/mine    → 我提交的游戏及审核状态
//   POST /api/games-submit/create  → 提交新游戏(入库为待审核,不上架)
//   POST /api/games-submit/upload  → 封面/截图上传 R2(multipart: file + kind[cover|shot])
// 依赖:env.DB、env.R2、env.SESSION_SECRET

const COOKIE = "sry_session";
const ASSET_HOST = "https://assets.srygamehub.com";
const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED_IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

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
    if (!p.exp || Date.now() > p.exp || !p.aid) return null;
    return p;
  } catch { return null; }
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

  // 开发商展示名取自工作室信息
  const dp = await env.DB.prepare(
    "SELECT studio_name FROM developer_profiles WHERE account_id = ?"
  ).bind(s.aid).first();
  const developer = (dp && dp.studio_name) || "";

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
