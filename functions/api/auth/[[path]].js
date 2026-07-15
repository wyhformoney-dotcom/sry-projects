// Cloudflare Pages Function —— 账号系统:邮箱验证码登录
// 一个文件承包 /api/auth/ 下全部接口:
//   POST /api/auth/send-code  { email }          → 发 6 位验证码到邮箱
//   POST /api/auth/verify     { email, code }    → 校验验证码;老用户直接登录,新用户进入待选身份状态
//   POST /api/auth/register   { role }           → 新用户选身份(developer/partner),创建账号
//   GET  /api/auth/me                            → 查询当前登录状态
//   POST /api/auth/logout                        → 退出登录
// 依赖绑定/变量:env.DB(D1)、env.RESEND_API_KEY、env.SESSION_SECRET

const CODE_TTL_MIN = 10;        // 验证码有效期(分钟)
const SEND_COOLDOWN_S = 60;     // 同一邮箱两次发码最小间隔(秒)
const SEND_HOURLY_MAX = 5;      // 同一邮箱每小时最多发码次数
const SESSION_DAYS = 30;        // 登录状态保持天数
const COOKIE = "sry_session";
const FROM = "SRY Game Hub <noreply@srygamehub.com>";

/* ---------------- 工具 ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const bad = (error, status = 400) => json({ ok: false, error }, status);

const normEmail = (s) => String(s || "").trim().toLowerCase();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

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

const b64url = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

/* ---------------- 会话(签名 Cookie) ---------------- */
async function makeSession(env, payload) {
  const body = b64url.enc(JSON.stringify(payload));
  const sig = await hmacHex(env.SESSION_SECRET, body);
  return body + "." + sig;
}

async function readSession(env, request) {
  try {
    const cookie = request.headers.get("cookie") || "";
    const m = cookie.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
    if (!m) return null;
    const [body, sig] = m[1].split(".");
    if (!body || !sig) return null;
    if ((await hmacHex(env.SESSION_SECRET, body)) !== sig) return null;
    const p = JSON.parse(b64url.dec(body));
    if (!p.exp || Date.now() > p.exp) return null;
    return p; // { aid, email, exp }  aid=0 表示邮箱已验证但尚未选身份建账号
  } catch { return null; }
}

const cookieHeader = (token, maxAgeSec) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

/* ---------------- 发信 ---------------- */
async function sendCodeEmail(env, email, code) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `${code} is your SRY Game Hub verification code`,
      text:
        `Your verification code is: ${code}\n\n` +
        `It expires in ${CODE_TTL_MIN} minutes. If you didn't request this, you can safely ignore this email.\n\n` +
        `SRY Game Hub · srygamehub.com`,
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px 8px;color:#111">` +
        `<div style="font-weight:900;font-size:15px;margin-bottom:18px">▪ SRY GAME HUB</div>` +
        `<p style="font-size:14px;margin:0 0 10px">Your verification code:</p>` +
        `<div style="font-size:32px;font-weight:900;letter-spacing:8px;background:#0c0d0a;color:#c6f24e;` +
        `padding:16px 0;text-align:center;border-radius:8px">${code}</div>` +
        `<p style="font-size:12px;color:#666;margin:14px 0 0">This code expires in ${CODE_TTL_MIN} minutes. ` +
        `If you didn't request it, you can safely ignore this email.</p>` +
        `<p style="font-size:11px;color:#999;margin:18px 0 0">SRY Game Hub · srygamehub.com</p></div>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Resend " + res.status + " " + detail.slice(0, 200));
  }
}

/* ---------------- 各接口 ---------------- */
async function handleSendCode(env, request) {
  const { email: raw } = await request.json().catch(() => ({}));
  const email = normEmail(raw);
  if (!isEmail(email)) return bad("invalid_email");

  // 顺手清理过期验证码
  await env.DB.prepare("DELETE FROM login_codes WHERE expires_at < datetime('now','-1 day')").run();

  // 频控:60 秒冷却 + 每小时上限
  const recent = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > datetime('now', ?) THEN 1 ELSE 0 END) AS in_cooldown,
       SUM(CASE WHEN created_at > datetime('now','-1 hour') THEN 1 ELSE 0 END) AS in_hour
     FROM login_codes WHERE email = ?`
  ).bind(`-${SEND_COOLDOWN_S} seconds`, email).first();
  if ((recent?.in_cooldown || 0) > 0) return bad("cooldown", 429);
  if ((recent?.in_hour || 0) >= SEND_HOURLY_MAX) return bad("hourly_limit", 429);

  // 生成并存储(只存哈希)
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  const code = String(n).padStart(6, "0");
  const hash = await sha256hex(email + ":" + code);

  // 让旧的未用验证码作废,始终只有最新一条有效
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0").bind(email).run();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code, expires_at) VALUES (?, ?, datetime('now', ?))`
  ).bind(email, hash, `+${CODE_TTL_MIN} minutes`).run();

  await sendCodeEmail(env, email, code);
  return json({ ok: true });
}

async function handleVerify(env, request) {
  const { email: raw, code } = await request.json().catch(() => ({}));
  const email = normEmail(raw);
  if (!isEmail(email) || !/^\d{6}$/.test(String(code || ""))) return bad("invalid_input");

  const hash = await sha256hex(email + ":" + code);
  const row = await env.DB.prepare(
    `SELECT id FROM login_codes
     WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`
  ).bind(email, hash).first();

  if (!row) {
    await new Promise((r) => setTimeout(r, 400)); // 轻微延迟,增加暴力尝试成本
    return bad("wrong_or_expired_code", 401);
  }
  await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE email = ?").bind(email).run();

  const account = await env.DB.prepare(
    "SELECT id, role, status FROM accounts WHERE email = ?"
  ).bind(email).first();

  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = await makeSession(env, { aid: account ? account.id : 0, email, exp });
  const headers = { "set-cookie": cookieHeader(token, SESSION_DAYS * 86400) };

  if (!account) return json({ ok: true, needsRole: true }, 200, headers);
  return json({ ok: true, needsRole: false, role: account.role, status: account.status }, 200, headers);
}

async function handleRegister(env, request) {
  const s = await readSession(env, request);
  if (!s) return bad("not_logged_in", 401);
  if (s.aid !== 0) return bad("already_registered");

  const { role } = await request.json().catch(() => ({}));
  if (role !== "developer" && role !== "partner") return bad("invalid_role");

  // 并发/重复保护:若邮箱已有账号,直接沿用
  let account = await env.DB.prepare("SELECT id, role, status FROM accounts WHERE email = ?").bind(s.email).first();
  if (!account) {
    const r = await env.DB.prepare(
      "INSERT INTO accounts (email, role, status) VALUES (?, ?, 'pending')"
    ).bind(s.email, role).run();
    account = { id: r.meta.last_row_id, role, status: "pending" };
  }

  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = await makeSession(env, { aid: account.id, email: s.email, exp });
  return json(
    { ok: true, role: account.role, status: account.status },
    200,
    { "set-cookie": cookieHeader(token, SESSION_DAYS * 86400) }
  );
}

async function handleMe(env, request) {
  const s = await readSession(env, request);
  if (!s) return json({ ok: true, loggedIn: false });
  if (s.aid === 0) return json({ ok: true, loggedIn: true, needsRole: true, email: s.email });

  const account = await env.DB.prepare(
    `SELECT a.id, a.email, a.role, a.status,
            CASE a.role
              WHEN 'developer' THEN (SELECT COUNT(*) FROM developer_profiles p WHERE p.account_id = a.id)
              ELSE (SELECT COUNT(*) FROM partner_profiles p WHERE p.account_id = a.id)
            END AS has_profile
     FROM accounts a WHERE a.id = ?`
  ).bind(s.aid).first();
  if (!account) return json({ ok: true, loggedIn: false });

  return json({
    ok: true, loggedIn: true, needsRole: false,
    email: account.email, role: account.role, status: account.status,
    hasProfile: !!account.has_profile,
  });
}

const handleLogout = () =>
  json({ ok: true }, 200, { "set-cookie": cookieHeader("x", 0) });

/* ---------------- 路由 ---------------- */
export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const method = request.method;

  try {
    if (!env.DB) return bad("db_not_bound", 500);
    if (!env.SESSION_SECRET) return bad("session_secret_missing", 500);

    if (method === "POST" && path === "send-code") return await handleSendCode(env, request);
    if (method === "POST" && path === "verify") return await handleVerify(env, request);
    if (method === "POST" && path === "register") return await handleRegister(env, request);
    if (method === "GET" && path === "me") return await handleMe(env, request);
    if (method === "POST" && path === "logout") return handleLogout();

    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
