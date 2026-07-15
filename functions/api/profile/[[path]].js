// Cloudflare Pages Function —— 账号资料:读取/保存 + 认证材料上传(R2)
//   GET  /api/profile/me       → 当前账号的资料(用于回显编辑)
//   POST /api/profile/save     → 保存资料(按身份写入 developer_profiles / partner_profiles)
//   POST /api/profile/upload   → 图片上传到 R2(multipart, 字段: file + kind[proof|logo]),返回公开 URL
// 依赖:env.DB、env.R2、env.SESSION_SECRET;图片域名 assets.srygamehub.com

const COOKIE = "sry_session";
const ASSET_HOST = "https://assets.srygamehub.com";
const MAX_UPLOAD = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/* ---------- 基础工具(与 auth 保持一致) ---------- */
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
    return p; // { aid, email, exp }
  } catch { return null; }
}

/* ---------- 字段规则 ---------- */
const S = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const isUrl = (v) => v === "" || /^https?:\/\/\S+$/i.test(v);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const inSet = (v, set) => set.includes(v);
const arrOf = (v, set, maxLen) => {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map((x) => String(x)))].filter((x) => set.includes(x));
  if (out.length === 0 || out.length > maxLen) return null;
  return out;
};

const GENRES = ["Action","Adventure","RPG","Strategy","Simulation","Puzzle","Platformer","Shooter","Survival","Horror","Roguelite","Metroidvania","Souls-like","Visual Novel","Card Game","Open World","Narrative","Comedy","Co-op","Multiplayer"];
const MARKETS = ["Global","China","Overseas"];
const KINDS = ["publishing","investment"];
const REGIONS = ["China","South Korea","Japan","Southeast Asia","North America","Europe","Other"];
const DEV_PROOF = ["steamworks","project_file","license","other"];
const PARTNER_PROOF = ["website","steam","steamworks","other"];

/* ---------- 各接口 ---------- */
async function handleMe(env, s) {
  const account = await env.DB.prepare("SELECT id, email, role, status FROM accounts WHERE id = ?")
    .bind(s.aid).first();
  if (!account) return bad("no_account", 401);

  let profile = null;
  if (account.role === "developer") {
    profile = await env.DB.prepare(
      "SELECT studio_name, contact_email, proof_type, proof_image FROM developer_profiles WHERE account_id = ?"
    ).bind(s.aid).first();
  } else {
    profile = await env.DB.prepare(
      `SELECT name_zh, name_en, logo, kinds, region, intro, genres, markets,
              steam_url, website, contact_email, proof_type, proof_image
       FROM partner_profiles WHERE account_id = ?`
    ).bind(s.aid).first();
    if (profile) {
      for (const k of ["kinds", "genres", "markets"]) {
        try { profile[k] = JSON.parse(profile[k] || "[]"); } catch { profile[k] = []; }
      }
    }
  }
  return json({ ok: true, email: account.email, role: account.role, status: account.status, profile });
}

async function handleSave(env, s, request) {
  const account = await env.DB.prepare("SELECT id, role, status FROM accounts WHERE id = ?")
    .bind(s.aid).first();
  if (!account) return bad("no_account", 401);

  const b = await request.json().catch(() => ({}));

  if (account.role === "developer") {
    const studio_name = S(b.studio_name, 120);
    const contact_email = S(b.contact_email, 200).toLowerCase();
    const proof_type = S(b.proof_type, 30);
    const proof_image = S(b.proof_image, 500);
    if (!studio_name) return bad("studio_name_required");
    if (!isEmail(contact_email)) return bad("contact_email_invalid");
    if (!inSet(proof_type, DEV_PROOF)) return bad("proof_type_invalid");
    if (!proof_image) return bad("proof_image_required");

    await env.DB.prepare(
      `INSERT INTO developer_profiles (account_id, studio_name, contact_email, proof_type, proof_image, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         studio_name=excluded.studio_name, contact_email=excluded.contact_email,
         proof_type=excluded.proof_type, proof_image=excluded.proof_image, updated_at=datetime('now')`
    ).bind(s.aid, studio_name, contact_email, proof_type, proof_image).run();
  } else {
    const name_en = S(b.name_en, 120);
    const name_zh = S(b.name_zh, 120);
    const logo = S(b.logo, 500);
    const kinds = arrOf(b.kinds, KINDS, 2);
    const region = S(b.region, 40);
    const intro = S(b.intro, 600);
    const genres = Array.isArray(b.genres) && b.genres.length ? arrOf(b.genres, GENRES, 20) : [];
    const markets = arrOf(b.markets, MARKETS, 3);
    const steam_url = S(b.steam_url, 400);
    const website = S(b.website, 400);
    const contact_email = S(b.contact_email, 200).toLowerCase();
    const proof_type = S(b.proof_type, 30);
    const proof_image = S(b.proof_image, 500);

    if (!name_en && !name_zh) return bad("name_required");
    if (!kinds) return bad("kinds_required");
    if (!inSet(region, REGIONS)) return bad("region_invalid");
    if (!intro) return bad("intro_required");
    if (genres === null) return bad("genres_invalid");
    if (!markets) return bad("markets_required");
    if (!isUrl(steam_url) || !isUrl(website)) return bad("url_invalid");
    if (!isEmail(contact_email)) return bad("contact_email_invalid");
    if (!inSet(proof_type, PARTNER_PROOF)) return bad("proof_type_invalid");
    if (!proof_image) return bad("proof_image_required");

    await env.DB.prepare(
      `INSERT INTO partner_profiles (account_id, name_zh, name_en, logo, kinds, region, intro, genres, markets,
                                     steam_url, website, contact_email, proof_type, proof_image, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         name_zh=excluded.name_zh, name_en=excluded.name_en, logo=excluded.logo, kinds=excluded.kinds,
         region=excluded.region, intro=excluded.intro, genres=excluded.genres, markets=excluded.markets,
         steam_url=excluded.steam_url, website=excluded.website, contact_email=excluded.contact_email,
         proof_type=excluded.proof_type, proof_image=excluded.proof_image, updated_at=datetime('now')`
    ).bind(
      s.aid, name_zh, name_en, logo, JSON.stringify(kinds), region, intro,
      JSON.stringify(genres), JSON.stringify(markets), steam_url, website,
      contact_email, proof_type, proof_image
    ).run();
  }

  // 被驳回后重新提交 → 状态拉回待审核
  if (account.status === "rejected") {
    await env.DB.prepare("UPDATE accounts SET status='pending' WHERE id = ?").bind(s.aid).run();
  }
  return json({ ok: true });
}

async function handleUpload(env, s, request) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad("bad_form");
  const file = form.get("file");
  const kind = String(form.get("kind") || "");
  if (!file || typeof file === "string") return bad("file_required");
  if (kind !== "proof" && kind !== "logo") return bad("kind_invalid");

  const ext = ALLOWED_IMG[file.type];
  if (!ext) return bad("type_not_allowed"); // 仅 jpg/png/webp
  if (file.size > MAX_UPLOAD) return bad("too_large"); // ≤5MB

  // 随机文件名:不可猜测,认证材料不会被枚举到
  const key = `${kind}/${s.aid}-${crypto.randomUUID()}.${ext}`;
  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000" },
  });
  return json({ ok: true, url: `${ASSET_HOST}/${key}` });
}

/* ---------- 路由 ---------- */
export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const method = request.method;

  try {
    if (!env.DB || !env.R2 || !env.SESSION_SECRET) return bad("env_missing", 500);
    const s = await readSession(env, request);
    if (!s) return bad("not_logged_in", 401);

    if (method === "GET" && path === "me") return await handleMe(env, s);
    if (method === "POST" && path === "save") return await handleSave(env, s, request);
    if (method === "POST" && path === "upload") return await handleUpload(env, s, request);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
