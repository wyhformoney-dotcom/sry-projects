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
            p.name_zh, p.name_en, p.name_ko, p.logo, p.kinds, p.region, p.intro, p.intro_en, p.intro_zh, p.intro_ko, p.contact_public,
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
  const where = ["1=1"];
  const binds = [];
  if (status === "feature") {
    where.push("g.feature_state = 'pending'");
  } else if (["pending", "approved", "rejected"].includes(status)) {
    where.push("g.status = ?"); binds.push(status);
  }
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.slug, g.feishu_id, g.visible, g.featured, g.feature_state, g.feature_note,
            g.deep_coop, g.demo_url, g.demo_note, g.t_en, g.t_zh, g.t_ko, g.d_en, g.d_zh, g.d_ko,
            g.full_en, g.full_zh, g.full_ko, g.studio_en, g.studio_zh, g.studio_ko, g.stage,
            g.genres, g.needs, g.platforms, g.region, g.cover, g.screenshots,
            g.video, g.steam_url, g.status, g.review_note, g.created_at,
            g.contact AS legacy_contact, a.email AS login_email,
            dp.studio_name, dp.contact_email AS dev_contact
     FROM games g
     LEFT JOIN accounts a ON a.id = g.claimed_by
     LEFT JOIN developer_profiles dp ON dp.account_id = g.claimed_by
     WHERE ${where.join(" AND ")}
     ORDER BY g.featured DESC, g.sort ASC, g.id DESC LIMIT 200`
  ).bind(...binds).all();

  const rows = (results || []).map((r) => {
    for (const k of ["genres", "needs", "platforms", "screenshots"]) {
      try { r[k] = JSON.parse(r[k] || "[]"); } catch { r[k] = []; }
    }
    return r;
  });

  const { results: cnt } = await env.DB.prepare(
    "SELECT status, COUNT(*) AS c FROM games GROUP BY status"
  ).all();
  const counts = {};
  (cnt || []).forEach((x) => { counts[x.status] = x.c; });
  const fc = await env.DB.prepare("SELECT COUNT(*) AS c FROM games WHERE feature_state='pending'").first();
  counts.feature = (fc && fc.c) || 0;
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

/* ---------- 从飞书同步游戏库 ---------- */
const F_GENRE={"动作":"Action","冒险":"Adventure","角色扮演":"RPG","策略":"Strategy","模拟":"Simulation","解谜":"Puzzle","平台":"Platformer","射击":"Shooter","生存":"Survival","恐怖":"Horror","Roguelite":"Roguelite","银河恶魔城":"Metroidvania","类魂":"Souls-like","视觉小说":"Visual Novel","卡牌":"Card Game","开放世界":"Open World","叙事":"Narrative","喜剧":"Comedy","合作":"Co-op","多人":"Multiplayer"};
const F_NEED={"寻找发行":"Seeking Publisher","寻找联合发行":"Seeking Publisher Partner","寻找投资":"Seeking Investment"};
const F_PLATFORM={"PC":"PC","主机":"Console","移动端":"Mobile"};
const F_REGION={"全球":"Global","中国":"China","海外":"Overseas"};
const F_STAGE={"开发中":"In Development","Demo":"Demo","Playtest":"Playtest","EA":"Early Access","发布":"Released"};
const F_VIEW="veww4ZRIvj";

function fTxt(v){
  if(v==null) return "";
  if(typeof v==="string") return v;
  if(typeof v==="number") return String(v);
  if(Array.isArray(v)) return v.map(x=> typeof x==="string"? x : (x&&(x.text||x.name))||"").join("");
  if(typeof v==="object") return v.text||v.name||v.link||v.value||"";
  return String(v);
}
function fArr(v){
  if(v==null) return [];
  if(Array.isArray(v)) return v.map(x=> typeof x==="string"? x : (x&&(x.text||x.name))||"").filter(Boolean);
  if(typeof v==="string") return v? [v] : [];
  return [];
}
const fMp=(d)=>(x)=> d[x]||x;
const fSlug=(t)=>{
  const base=String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
  return (base||"game")+"-"+crypto.randomUUID().slice(0,6);
};

async function handleImportFeishu(env) {
  const {FEISHU_APP_ID,FEISHU_APP_SECRET,FEISHU_APP_TOKEN,FEISHU_TABLE_ID}=env;
  if(!FEISHU_APP_ID||!FEISHU_APP_SECRET||!FEISHU_APP_TOKEN||!FEISHU_TABLE_ID) return bad("feishu_env_missing",500);

  const tr=await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({app_id:FEISHU_APP_ID,app_secret:FEISHU_APP_SECRET})
  });
  const td=await tr.json();
  if(!td.tenant_access_token) return bad("feishu_token_failed",500);
  const token=td.tenant_access_token;

  let items=[],pageToken="";
  do{
    let url=`https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records?page_size=100&view_id=${encodeURIComponent(F_VIEW)}`;
    if(pageToken) url+=`&page_token=${encodeURIComponent(pageToken)}`;
    const rr=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const rd=await rr.json();
    if(rd.code!==0) return bad("feishu_records_failed",500);
    items=items.concat((rd.data&&rd.data.items)||[]);
    pageToken=(rd.data&&rd.data.has_more)? rd.data.page_token : "";
  }while(pageToken);

  let n=0;
  for(let i=0;i<items.length;i++){
    const f=items[i].fields||{}, rid=items[i].record_id;
    const g=(k)=>fTxt(f[k]);
    if(!g("游戏名_EN") && !g("游戏名_中文")) continue;
    await env.DB.prepare(
      `INSERT INTO games (feishu_id, slug, t_en, t_zh, t_ko, d_en, d_zh, d_ko,
                          full_en, full_zh, full_ko, studio_en, studio_zh, studio_ko,
                          developer, stage, genres, needs, platforms, region,
                          cover, screenshots, studio_logo, video, contact,
                          visible, sort, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
       ON CONFLICT(feishu_id) DO UPDATE SET
         t_en=excluded.t_en, t_zh=excluded.t_zh, t_ko=excluded.t_ko,
         d_en=excluded.d_en, d_zh=excluded.d_zh, d_ko=excluded.d_ko,
         full_en=excluded.full_en, full_zh=excluded.full_zh, full_ko=excluded.full_ko,
         studio_en=excluded.studio_en, studio_zh=excluded.studio_zh, studio_ko=excluded.studio_ko,
         developer=excluded.developer, stage=excluded.stage, genres=excluded.genres,
         needs=excluded.needs, platforms=excluded.platforms, region=excluded.region,
         cover=excluded.cover, screenshots=excluded.screenshots, studio_logo=excluded.studio_logo,
         video=excluded.video, contact=excluded.contact, visible=excluded.visible`
    ).bind(
      rid, fSlug(g("游戏名_EN")||g("游戏名_中文")),
      g("游戏名_EN"), g("游戏名_中文"), g("游戏名_韩文"),
      g("简介_EN"), g("简介_中文"), g("简介_韩文"),
      g("完整简介_EN"), g("完整简介_中文"), g("完整简介_韩文"),
      g("工作室简介_EN"), g("工作室简介_中文"), g("工作室简介_韩文"),
      g("开发商"), F_STAGE[g("进展")]||g("进展")||"Demo",
      JSON.stringify(fArr(f["类型"]).map(fMp(F_GENRE))),
      JSON.stringify(fArr(f["需求"]).map(fMp(F_NEED))),
      JSON.stringify(fArr(f["平台"]).map(fMp(F_PLATFORM))),
      F_REGION[g("目标市场")]||g("目标市场"),
      g("封面链接"),
      JSON.stringify(g("截图链接").split(/\r?\n/).map(x=>x.trim()).filter(Boolean)),
      g("工作室Logo"), g("预告片链接"), g("联系链接"),
      g("是否上架")!=="否" ? 1 : 0,
      i+1
    ).run();
    n++;
  }
  return json({ ok:true, imported:n, total:items.length });
}

async function handleIntroSave(env, request) {
  const { id, intro_en, intro_zh, intro_ko } = await request.json().catch(() => ({}));
  const aid = parseInt(id, 10);
  if (!aid) return bad("invalid_id");
  const T = (v) => String(v || "").trim().slice(0, 600);
  await env.DB.prepare(
    `UPDATE partner_profiles SET intro_en=?, intro_zh=?, intro_ko=?, updated_at=datetime('now') WHERE account_id=?`
  ).bind(T(intro_en), T(intro_zh), T(intro_ko), aid).run();
  return json({ ok: true });
}

async function handleAccountsList(env, request) {
  const url = new URL(request.url);
  const role = url.searchParams.get("role") || "all";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
  const where = ["1=1"]; const binds = [];
  if (role === "developer" || role === "partner") { where.push("a.role = ?"); binds.push(role); }
  if (q) { where.push("a.email LIKE ?"); binds.push(`%${q}%`); }
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.email, a.role, a.status, a.created_at,
            dp.studio_name, pp.name_en, pp.name_zh,
            (SELECT COUNT(*) FROM games g WHERE g.claimed_by = a.id) AS games_cnt
     FROM accounts a
     LEFT JOIN developer_profiles dp ON dp.account_id = a.id
     LEFT JOIN partner_profiles pp ON pp.account_id = a.id
     WHERE ${where.join(" AND ")}
     ORDER BY a.id DESC LIMIT 300`
  ).bind(...binds).all();
  const { results: cnt } = await env.DB.prepare(
    "SELECT role, COUNT(*) AS c FROM accounts GROUP BY role"
  ).all();
  const counts = {}; (cnt || []).forEach((x) => { counts[x.role] = x.c; });
  return json({ ok: true, rows: results || [], counts });
}

async function handleAccountStatus(env, request) {
  const { id, action } = await request.json().catch(() => ({}));
  const aid = parseInt(id, 10);
  if (!aid) return bad("invalid_id");
  if (action !== "suspend" && action !== "restore") return bad("invalid_action");
  const account = await env.DB.prepare("SELECT id, role FROM accounts WHERE id = ?").bind(aid).first();
  if (!account) return bad("not_found", 404);
  const newStatus = action === "suspend" ? "suspended" : "verified";
  await env.DB.prepare("UPDATE accounts SET status = ? WHERE id = ?").bind(newStatus, aid).run();
  return json({ ok: true, status: newStatus });
}

/* ---------- 老游戏一键归户:按 contact 邮箱建开发者账号并挂载游戏 ---------- */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());

async function handleClaimLegacy(env, request) {
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const { results } = await env.DB.prepare(
    `SELECT id, t_en, t_zh, contact, developer, studio_logo
     FROM games WHERE claimed_by IS NULL AND contact IS NOT NULL AND contact != ''`
  ).all();

  let linked = 0, accountsCreated = 0;
  const skipped = [];
  const byEmail = new Map();

  for (const g of results || []) {
    const email = String(g.contact || "").trim().toLowerCase();
    const title = g.t_en || g.t_zh || ("#" + g.id);
    if (!isEmail(email)) { skipped.push({ id: g.id, title, contact: g.contact }); continue; }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(g);
  }

  if (dry) {
    return json({
      ok: true, dry: true,
      wouldLink: [...byEmail.values()].reduce((n, arr) => n + arr.length, 0),
      emails: byEmail.size, skipped,
    });
  }

  for (const [email, games] of byEmail) {
    // 账号:存在则复用(仅当是开发者),否则新建并激活
    let acc = await env.DB.prepare("SELECT id, role FROM accounts WHERE email = ?").bind(email).first();
    if (!acc) {
      const r = await env.DB.prepare(
        "INSERT INTO accounts (email, role, status) VALUES (?, 'developer', 'verified')"
      ).bind(email).run();
      acc = { id: r.meta.last_row_id, role: "developer" };
      accountsCreated++;
    } else if (acc.role !== "developer") {
      games.forEach((g) => skipped.push({ id: g.id, title: g.t_en || g.t_zh, contact: email, reason: "该邮箱已是合作方账号" }));
      continue;
    }

    // 工作室资料:没有则用游戏上的开发商名/Logo 建一份
    const dp = await env.DB.prepare(
      "SELECT account_id, studio_name FROM developer_profiles WHERE account_id = ?"
    ).bind(acc.id).first();
    if (!dp) {
      const g0 = games.find((g) => g.developer) || games[0];
      await env.DB.prepare(
        `INSERT INTO developer_profiles (account_id, studio_name, logo, contact_email, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).bind(acc.id, String(g0.developer || "").slice(0, 120), g0.studio_logo || "preset:solo", email).run();
    }

    for (const g of games) {
      await env.DB.prepare("UPDATE games SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL")
        .bind(acc.id, g.id).run();
      linked++;
    }
  }

  return json({ ok: true, linked, accountsCreated, emails: byEmail.size, skipped });
}

async function handleFeatureSet(env, request) {
  const { id, action, note } = await request.json().catch(() => ({}));
  const gid = parseInt(id, 10);
  if (!gid) return bad("invalid_id");
  const cleanNote = String(note || "").trim().slice(0, 500);
  if (action === "feature") {
    await env.DB.prepare("UPDATE games SET featured=1, feature_state='featured', feature_note=NULL WHERE id=?").bind(gid).run();
  } else if (action === "unfeature") {
    await env.DB.prepare("UPDATE games SET featured=0, feature_state='none', feature_note=NULL WHERE id=?").bind(gid).run();
  } else if (action === "reject") {
    if (!cleanNote) return bad("note_required");
    await env.DB.prepare("UPDATE games SET featured=0, feature_state='rejected', feature_note=? WHERE id=?").bind(cleanNote, gid).run();
  } else return bad("invalid_action");
  return json({ ok: true });
}

async function handleGameI18n(env, request) {
  const b = await request.json().catch(() => ({}));
  const gid = parseInt(b.id, 10);
  if (!gid) return bad("invalid_id");
  const T = (v, n) => String(v || "").trim().slice(0, n);
  await env.DB.prepare(
    `UPDATE games SET t_en=?, t_zh=?, t_ko=?, d_en=?, d_zh=?, d_ko=?,
       full_en=?, full_zh=?, full_ko=?, studio_en=?, studio_zh=?, studio_ko=? WHERE id=?`
  ).bind(
    T(b.t_en,120), T(b.t_zh,120), T(b.t_ko,120),
    T(b.d_en,300), T(b.d_zh,300), T(b.d_ko,300),
    T(b.full_en,2000), T(b.full_zh,2000), T(b.full_ko,2000),
    T(b.studio_en,1000), T(b.studio_zh,1000), T(b.studio_ko,1000), gid
  ).run();
  return json({ ok: true });
}

async function handleGamesOrder(env, request) {
  const { ids } = await request.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.length) return bad("invalid_ids");
  const list = ids.map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 500);
  const stmts = list.map((id, i) =>
    env.DB.prepare("UPDATE games SET sort = ? WHERE id = ?").bind(i + 1, id)
  );
  await env.DB.batch(stmts);
  return json({ ok: true, count: list.length });
}

async function handleContactSet(env, request) {
  const b = await request.json().catch(() => ({}));
  const type = String(b.type || "");
  const id = parseInt(b.id, 10);
  const email = String(b.email || "").trim().toLowerCase();
  if (!id) return bad("invalid_id");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad("invalid_email");

  if (type === "partner") {
    await env.DB.prepare(
      "UPDATE partner_profiles SET contact_email=?, contact_public=?, updated_at=datetime('now') WHERE account_id=?"
    ).bind(email, b.public === false ? 0 : 1, id).run();
    return json({ ok: true });
  }

  if (type === "game") {
    const g = await env.DB.prepare("SELECT id, claimed_by FROM games WHERE id = ?").bind(id).first();
    if (!g) return bad("not_found", 404);
    if (g.claimed_by) {
      // 已归户:写开发者资料(没有资料行则建一行)
      const acc = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?").bind(g.claimed_by).first();
      await env.DB.prepare(
        `INSERT INTO developer_profiles (account_id, studio_name, contact_email, updated_at)
         VALUES (?, '', ?, datetime('now'))
         ON CONFLICT(account_id) DO UPDATE SET contact_email=excluded.contact_email, updated_at=datetime('now')`
      ).bind(g.claimed_by, email || (acc && acc.email) || "").run();
    }
    // 同时更新游戏自身的 contact(未归户的老游戏靠它)
    await env.DB.prepare("UPDATE games SET contact=? WHERE id=?").bind(email, id).run();
    return json({ ok: true, claimed: !!g.claimed_by });
  }
  return bad("invalid_type");
}

/* ---------- 管理员新增游戏(按联系邮箱自动建号并挂载) ---------- */
const A_STAGES = ["In Development","Demo","Playtest","Early Access","Released"];
const A_MARKETS = ["Global","China","Overseas"];
const aSlug = (t) => {
  const base = String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (base || "game") + "-" + crypto.randomUUID().slice(0, 6);
};

async function handleGameCreate(env, request) {
  const b = await request.json().catch(() => ({}));
  const T = (v, n) => String(v || "").trim().slice(0, n);
  const email = T(b.contact, 200).toLowerCase();
  const t_en = T(b.t_en, 120), t_zh = T(b.t_zh, 120), t_ko = T(b.t_ko, 120);
  if (!t_en && !t_zh && !t_ko) return bad("title_required");
  if (email && !isEmail(email)) return bad("invalid_email");

  // 按邮箱建号 / 复用
  let ownerId = null;
  if (email) {
    let acc = await env.DB.prepare("SELECT id, role FROM accounts WHERE email = ?").bind(email).first();
    if (!acc) {
      const r = await env.DB.prepare(
        "INSERT INTO accounts (email, role, status) VALUES (?, 'developer', 'verified')"
      ).bind(email).run();
      acc = { id: r.meta.last_row_id, role: "developer" };
    }
    if (acc.role === "developer") {
      ownerId = acc.id;
      const dp = await env.DB.prepare("SELECT account_id FROM developer_profiles WHERE account_id = ?").bind(ownerId).first();
      if (!dp) {
        await env.DB.prepare(
          `INSERT INTO developer_profiles (account_id, studio_name, logo, contact_email, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(ownerId, T(b.developer, 120), T(b.studio_logo, 500) || "preset:solo", email).run();
      }
    }
  }

  const arrJson = (v) => JSON.stringify(Array.isArray(v) ? v.map(String).slice(0, 20) : []);
  const res = await env.DB.prepare(
    `INSERT INTO games (slug, t_en, t_zh, t_ko, d_en, d_zh, d_ko, full_en, full_zh, full_ko,
                        developer, studio_logo, stage, genres, needs, platforms, region,
                        cover, screenshots, video, steam_url, contact, claimed_by,
                        visible, status, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, datetime('now'))`
  ).bind(
    aSlug(t_en || t_zh || t_ko), t_en, t_zh, t_ko,
    T(b.d_en, 300), T(b.d_zh, 300), T(b.d_ko, 300),
    T(b.full_en, 2000), T(b.full_zh, 2000), T(b.full_ko, 2000),
    T(b.developer, 120), T(b.studio_logo, 500),
    A_STAGES.includes(b.stage) ? b.stage : "Demo",
    arrJson(b.genres), arrJson(b.needs), arrJson(b.platforms),
    A_MARKETS.includes(b.region) ? b.region : "Global",
    T(b.cover, 500), arrJson(b.screenshots), T(b.video, 400), T(b.steam_url, 400),
    email, ownerId, b.visible === false ? 0 : 1
  ).run();
  return json({ ok: true, id: res.meta.last_row_id, ownerCreated: !!ownerId });
}

/* ---------- 删除 ---------- */
async function handleGameDelete(env, request) {
  const { id } = await request.json().catch(() => ({}));
  const gid = parseInt(id, 10);
  if (!gid) return bad("invalid_id");
  await env.DB.prepare("DELETE FROM favorites WHERE game_id = ?").bind(gid).run().catch(() => {});
  await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(gid).run();
  return json({ ok: true });
}

async function handlePartnerDelete(env, request) {
  const { id, mode } = await request.json().catch(() => ({}));
  const aid = parseInt(id, 10);
  if (!aid) return bad("invalid_id");
  const acc = await env.DB.prepare("SELECT id, role FROM accounts WHERE id = ?").bind(aid).first();
  if (!acc || acc.role !== "partner") return bad("not_found", 404);
  await env.DB.prepare("DELETE FROM partner_profiles WHERE account_id = ?").bind(aid).run();
  if (mode === "account") {
    await env.DB.prepare("DELETE FROM contact_views WHERE viewer_id = ? OR (target_type='partner' AND target_id = ?)").bind(aid, aid).run();
    await env.DB.prepare("DELETE FROM favorites WHERE account_id = ?").bind(aid).run().catch(() => {});
    await env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(aid).run();
    return json({ ok: true, deleted: "account" });
  }
  await env.DB.prepare("UPDATE accounts SET status='pending' WHERE id = ?").bind(aid).run();
  return json({ ok: true, deleted: "profile" });
}

/* ---------- 管理员用:Steam 一键解析(图片存 R2) ---------- */
const A_ASSET_HOST = "https://assets.srygamehub.com";
const A_GENRE_MAP = { "Action":"Action", "Adventure":"Adventure", "RPG":"RPG", "Strategy":"Strategy",
  "Simulation":"Simulation", "Massively Multiplayer":"Multiplayer" };

const aStrip = (h) => String(h || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<li[^>]*>/gi, "\n· ")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, "\n\n").trim();

async function aSteamApp(appid, l) {
  const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=${l}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const d = await r.json().catch(() => null);
  const node = d && d[appid];
  return node && node.success ? node.data : null;
}

async function aSaveImg(env, url, tag) {
  if (!env.R2) return url;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "image/jpeg";
    const ext = ct.includes("png") ? "png" : "jpg";
    const key = `steam/admin-${tag}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await env.R2.put(key, r.body, { httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000" } });
    return `${A_ASSET_HOST}/${key}`;
  } catch { return ""; }
}

async function handleAdminSteamFetch(env, request) {
  const { url } = await request.json().catch(() => ({}));
  const m = String(url || "").match(/store\.steampowered\.com\/app\/(\d+)/i);
  if (!m) return bad("steam_invalid");
  const appid = m[1];

  const [en, zh, ko] = await Promise.all([
    aSteamApp(appid, "english"), aSteamApp(appid, "schinese"), aSteamApp(appid, "koreana"),
  ]);
  if (!en) return bad("steam_fetch_failed", 502);

  const shotUrls = (en.screenshots || []).slice(0, 5).map((x) => x.path_full).filter(Boolean);
  const [cover, ...shots] = await Promise.all([
    en.header_image ? aSaveImg(env, en.header_image, "cover") : Promise.resolve(""),
    ...shotUrls.map((u, i) => aSaveImg(env, u, "shot" + i)),
  ]);

  let video = "";
  if (Array.isArray(en.movies) && en.movies[0]) {
    const mv = en.movies[0];
    video = (mv.mp4 && (mv.mp4.max || mv.mp4["480"])) || "";
    if (video.startsWith("http://")) video = "https://" + video.slice(7);
  }

  return json({
    ok: true,
    t_en: String(en.name || "").slice(0, 120),
    t_zh: zh && zh.name && zh.name !== en.name ? String(zh.name).slice(0, 120) : "",
    t_ko: ko && ko.name && ko.name !== en.name ? String(ko.name).slice(0, 120) : "",
    d_en: aStrip(en.short_description).slice(0, 300),
    d_zh: zh ? aStrip(zh.short_description).slice(0, 300) : "",
    d_ko: ko ? aStrip(ko.short_description).slice(0, 300) : "",
    full_en: aStrip(en.about_the_game || en.detailed_description).slice(0, 2000),
    full_zh: zh ? aStrip(zh.about_the_game || zh.detailed_description).slice(0, 2000) : "",
    full_ko: ko ? aStrip(ko.about_the_game || ko.detailed_description).slice(0, 2000) : "",
    developer: String((en.developers && en.developers[0]) || "").slice(0, 120),
    cover, screenshots: shots.filter(Boolean), video,
    genres: [...new Set((en.genres || []).map((g) => A_GENRE_MAP[g.description]).filter(Boolean))],
    platforms: ["PC"],
    stage: en.release_date && en.release_date.coming_soon ? "In Development" : "Released",
    steam_url: `https://store.steampowered.com/app/${appid}/`,
  });
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
    if (method === "POST" && path === "intro") return await handleIntroSave(env, request);
    if (method === "GET" && path === "games") return await handleGamesList(env, request);
    if (method === "POST" && path === "import-feishu") return await handleImportFeishu(env);
    if (method === "POST" && path === "claim-legacy") return await handleClaimLegacy(env, request);
    if (method === "POST" && path === "feature-set") return await handleFeatureSet(env, request);
    if (method === "POST" && path === "game-i18n") return await handleGameI18n(env, request);
    if (method === "POST" && path === "games-order") return await handleGamesOrder(env, request);
    if (method === "POST" && path === "contact-set") return await handleContactSet(env, request);
    if (method === "POST" && path === "game-create") return await handleGameCreate(env, request);
    if (method === "POST" && path === "steam-fetch") return await handleAdminSteamFetch(env, request);
    if (method === "POST" && path === "game-delete") return await handleGameDelete(env, request);
    if (method === "POST" && path === "partner-delete") return await handlePartnerDelete(env, request);
    if (method === "GET" && path === "accounts") return await handleAccountsList(env, request);
    if (method === "POST" && path === "account-status") return await handleAccountStatus(env, request);
    if (method === "POST" && path === "review-game") return await handleReviewGame(env, request);
    return bad("not_found", 404);
  } catch (e) {
    return bad("server_error: " + String(e.message || e).slice(0, 300), 500);
  }
}
