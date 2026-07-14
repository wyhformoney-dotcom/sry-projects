// 临时测试函数:验证 D1 + R2 绑定是否打通
// 路由:https://srygamehub.com/api/health
// 验证通过后请从 GitHub 删除本文件

export async function onRequestGet(context) {
  const { env } = context;
  const result = { d1: null, r2: null };

  // 测 D1:列出所有表
  try {
    if (!env.DB) throw new Error("未找到绑定 DB(检查变量名是否为大写 DB)");
    const { results } = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    result.d1 = { ok: true, tables: results.map(r => r.name) };
  } catch (e) {
    result.d1 = { ok: false, error: String(e.message || e) };
  }

  // 测 R2:写入一个小文件再读回、删除
  try {
    if (!env.R2) throw new Error("未找到绑定 R2(检查变量名是否为大写 R2)");
    const key = "_health-check.txt";
    await env.R2.put(key, "ok " + new Date().toISOString());
    const obj = await env.R2.get(key);
    const text = obj ? await obj.text() : null;
    await env.R2.delete(key);
    result.r2 = { ok: !!text, readback: text };
  } catch (e) {
    result.r2 = { ok: false, error: String(e.message || e) };
  }

  const allOk = result.d1?.ok && result.r2?.ok;
  return new Response(JSON.stringify({ status: allOk ? "全部通过" : "有问题", ...result }, null, 2), {
    status: allOk ? 200 : 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
