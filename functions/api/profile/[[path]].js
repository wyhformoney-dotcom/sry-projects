// Cloudflare Pages Function —— 账号资料:读取/保存 + 认证材料上传(R2) + 企业邮箱验证
//   GET  /api/profile/me               → 当前账号的资料(用于回显编辑)
//   POST /api/profile/save             → 保存资料(按身份写入对应表)
//   POST /api/profile/upload           → 图片上传到 R2(multipart: file + kind[proof|logo])
//   POST /api/profile/send-work-code   → 向企业邮箱发验证码 { email }
//   POST /api/profile/verify-work-code → 校验并给账号打"邮箱已验证"标记 { email, code }
// 依赖:env.DB、env.R2、env.RESEND_API_KEY、env.SESSION_SECRET

const COOKIE = "sry_session";
const ASSET_HOST = "https://assets.srygamehub.com";
const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED_IMG = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CODE_TTL_MIN = 10;
const SEND_COOLDOWN_S = 60;
const SEND_HOURLY_MAX = 5;
const FROM = "SRY Game Hub <noreply@srygamehub.com>";

/* ---------- 基础工具 ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
const bad = (error, status = 400) => json({ ok: false, error }, status);

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
const PARTNER_PROOF = ["work_email","steamworks","other"];
const isRegion = (v) => /^[A-Z]{2}$/.test(v); // ISO 3166-1 alpha-2 国家/地区代码

/* ---------- 发信(与登录验证码同模板) ---------- */
async function sendCodeEmail(env, email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [email],
      subject: `${code} is your SRY Game Hub verification code`,
      text: `Your verification code is: ${code}\n\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't request this, you can safely ignore this email.\n\nSRY Game Hub · srygamehub.com`,
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px 8px;color:#111">` +
        `<div style="font-weight:900;font-size:15px;margin-bottom:18px">▪ SRY GAME HUB</div>` +
        `<p style="font-size:14px;margin:0 0 10px">Your verification code:</p>` +
        `<div style="font-size:32px;font-weight:900;letter-spacing:8px;background:#0c0d0a;color:#c6f24e;padding:16px 0;text-align:center;border-radius:8px">${code}</div>` +
        `<p style="font-size:12px;color:#666;margin:14px 0 0">This code expires in ${CODE_TTL_MIN} minutes. If you didn't request it, you can safely ignore this email.</p>` +
        `<p style="font-size:11px;color:#999;margin:18px 0 0">SRY Game Hub · srygamehub.com</p></div>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Resend " + res.status + " " + detail.slice(0, 200));
  }
}

/* ---------- 各接口 ---------- */
async function handleMe(env, s) {
  const account = await env.DB.prepare("SELECT id, email, role, status FROM accounts WHERE id = ?")
    .bind(s.aid).first();
  if (!account) return bad("no_account", 401);

  let profile = null;
  if (account.role === "developer") {
    profile = await env.DB.prepare(
      "SELECT studio_name, contact_email, intro, logo FROM developer_profiles WHERE account_id = ?"
    ).bind(s.aid).first();
  } else {
    profile = await env.DB.prepare(
      `SELECT name_zh, name_en, name_ko, logo, kinds, region, intro, genres, markets,
              steam_url, website, contact_email, proof_type, proof_image, verified_email
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
    // 工作室信息:随时可改,保存即生效,不走审核
    const studio_name = S(b.studio_name, 120);
    const contact_email = S(b.contact_email, 200).toLowerCase();
    const intro = S(b.intro, 200);   // 选填
    const logo = S(b.logo, 500);     // 选填
    if (!studio_name) return bad("studio_name_required");
    if (!isEmail(contact_email)) return bad("contact_email_invalid");

    await env.DB.prepare(
      `INSERT INTO developer_profiles (account_id, studio_name, contact_email, intro, logo, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         studio_name=excluded.studio_name, contact_email=excluded.contact_email,
         intro=excluded.intro, logo=excluded.logo, updated_at=datetime('now')`
    ).bind(s.aid, studio_name, contact_email, intro, logo).run();
    return json({ ok: true });
  } else {
    const name_en = S(b.name_en, 120);
    const name_zh = S(b.name_zh, 120);
    const name_ko = S(b.name_ko, 120);
    const logo = S(b.logo, 500);
    const kinds = arrOf(b.kinds, KINDS, 2);
    const region = S(b.region, 2).toUpperCase();
    const intro = S(b.intro, 600);
    const genres = Array.isArray(b.genres) && b.genres.length ? arrOf(b.genres, GENRES, 20) : [];
    const markets = arrOf(b.markets, MARKETS, 3);
    const steam_url = S(b.steam_url, 400);
    const website = S(b.website, 400);
    const contact_email = S(b.contact_email, 200).toLowerCase();
    const proof_type = S(b.proof_type, 30);
    const proof_image = S(b.proof_image, 500);

    if (!name_en) return bad("name_required");
    if (!logo) return bad("logo_required");
    if (!kinds) return bad("kinds_required");
    if (!isRegion(region)) return bad("region_invalid");
    if (!intro) return bad("intro_required");
    if (genres === null) return bad("genres_invalid");
    if (!markets) return bad("markets_required");
    if (!isUrl(steam_url) || !isUrl(website)) return bad("url_invalid");
    if (!isEmail(contact_email)) return bad("contact_email_invalid");
    if (!inSet(proof_type, PARTNER_PROOF)) return bad("proof_type_invalid");

    // 验证方式:企业邮箱 → 必须已完成验证;其他 → 必须有材料图
    if (proof_type === "work_email") {
      const row = await env.DB.prepare(
        "SELECT verified_email FROM partner_profiles WHERE account_id = ?"
      ).bind(s.aid).first();
      if (!row || !row.verified_email) return bad("work_email_not_verified");
    } else if (!proof_image) {
      return bad("proof_image_required");
    }

    await env.DB.prepare(
      `INSERT INTO partner_profiles (account_id, name_zh, name_en, name_ko, logo, kinds, region, intro, genres, markets,
                                     steam_url, website, contact_email, proof_type, proof_image, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         name_zh=excluded.name_zh, name_en=excluded.name_en, name_ko=excluded.name_ko, logo=excluded.logo,
         kinds=excluded.kinds, region=excluded.region, intro=excluded.intro, genres=excluded.genres,
         markets=excluded.markets, steam_url=excluded.steam_url, website=excluded.website,
         contact_email=excluded.contact_email, proof_type=excluded.proof_type, proof_image=excluded.proof_image,
         updated_at=datetime('now')`
    ).bind(
      s.aid, name_zh, name_en, name_ko, logo, JSON.stringify(kinds), region, intro,
      JSON.stringify(genres), JSON.stringify(markets), steam_url, website,
      contact_email, proof_type, proof_image
    ).run();
  }

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
  if (!ext) return bad("type_not_allowed");
  if (file.size > MAX_UPLOAD) return bad("too_large");

  const key = `${kind}/${s.aid}-${crypto.randomUUID()}.${ext}`;
  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000" },
  });
  return json({ ok: true, url: `${ASSET_HOST}/${key}` });
}

async function handleSendWorkCode(env, s, request) {
  const { email: raw } = await request.json().catch(() => ({}));
  const email = String(raw || "").trim().toLowerCase();
  if (!isEmail(email)) return bad("invalid_email");

  const recent = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > datetime('now', ?) THEN 1 ELSE 0 END) AS in_cooldown,
       SUM(CASE WHEN created_at > datetime('now','-1 hour') THEN 1 ELSE 0 END) AS in_hour
     FROM login_codes WHERE email = ?`
  ).bind(`-${SEND_COOLDOWN_S} seconds`, email).first();
  if ((recent?.in_cooldown || 0) > 0) return bad("cooldown", 429);
  if ((recent?.in_hour || 0) >= SEND_HOURLY_MAX) return bad("hourly_limit", 429);

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  const code = String(n).padStart(6, "0");
  const hash = await sha256hex(email + ":" + code);

  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0").bind(email).run();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code, expires_at) VALUES (?, ?, datetime('now', ?))`
  ).bind(email, hash, `+${CODE_TTL_MIN} minutes`).run();

  await sendCodeEmail(env, email, code);
  return json({ ok: true });
}

async function handleVerifyWorkCode(env, s, request) {
  const { email: raw, code } = await request.json().catch(() => ({}));
  const email = String(raw || "").trim().toLowerCase();
  if (!isEmail(email) || !/^\d{6}$/.test(String(code || ""))) return bad("invalid_input");

  const hash = await sha256hex(email + ":" + code);
  const row = await env.DB.prepare(
    `SELECT id FROM login_codes
     WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`
  ).bind(email, hash).first();
  if (!row) {
    await new Promise((r) => setTimeout(r, 400));
    return bad("wrong_or_expired_code", 401);
  }
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ?").bind(email).run();

  // 打标记:写入 partner_profiles.verified_email(行不存在则先建壳)
  await env.DB.prepare(
    `INSERT INTO partner_profiles (account_id, verified_email, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(account_id) DO UPDATE SET verified_email=excluded.verified_email, updated_at=datetime('now')`
  ).bind(s.aid, email).run();

  return json({ ok: true, verified_email: email });
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
    if (method === "POST" && path === "send-work-code") return await handleSendWorkCode(env, s, request);
    if (method === "POST" && path === "verify-work-code") return await handleVerifyWorkCode(env, s, request);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
